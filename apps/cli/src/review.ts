import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  acceptReview,
  commitProposal,
  detectProvider,
  Fetcher,
  findReference,
  openPullRequest,
  originUrl,
  parseRemote,
  pushProposal,
  referenceStatuses,
  REVIEW_FILE,
  reviewState,
  ScillaError,
  type ReferenceStatus,
} from "@scilla/core";
import type { ProposeCommand } from "./args.ts";
import {
  commitMove,
  fileSummary,
  ratingChange,
  reviewUpdates,
  riskySummary,
  type Reviewed,
} from "./diff.ts";
import type { Io } from "./io.ts";
import { Reporter, shortCommit } from "./report.ts";
import { gatherCollection } from "./updates.ts";

/** `scilla review accept [reference]`: record upstream commits as reviewed in scilla-review.json. */
export const accept = async (io: Io, reference: string | undefined) => {
  const reporter = new Reporter(io);
  const fetcher = new Fetcher(io.cacheDir);

  const statuses = await io.tui.withProgress(
    "Checking upstream",
    () => referenceStatuses(io.cwd, fetcher, io.home),
    io.stderr,
  );

  const chosen = reference === undefined ? statuses : [findReference(statuses, reference)];

  for (const status of chosen) {
    if (status.problem !== undefined) {
      reporter.warn(`Reference "${status.key}" left as it was: ${status.problem}`);
    }
  }

  const accepted = await acceptReview(io.cwd, statuses, chosen);

  if (accepted.length === 0) {
    reporter.line("Nothing to accept: every Reference is at its reviewed commit.");

    return;
  }

  for (const { key, from, to } of accepted) {
    reporter.line(
      `Reviewed ${key}: ${from === undefined ? "floating" : shortCommit(from)} → ${shortCommit(to)}`,
    );
  }

  reporter.line(`Commit ${REVIEW_FILE} to release these commits to Consumers.`);
};

/** A PR title in the repo's Conventional Commits style. */
const proposalTitle = (outdated: readonly ReferenceStatus[]) =>
  outdated.length === 1
    ? `chore(review): bump the reviewed commit of ${outdated[0]?.key ?? ""}`
    : `chore(review): bump the reviewed commits of ${outdated.length} References`;

const moveOf = (status: ReferenceStatus) =>
  `${shortCommit(status.reviewed ?? "")} → ${shortCommit(status.upstream ?? "")}`;

/** GitHub refuses bodies over 65536 characters; leave room for the table and notes. */
const BODY_LIMIT = 60_000;

/** A single skill's diff never takes more than this, so one huge skill can't crowd out the rest. */
const PATCH_LIMIT = 20_000;

const cell = (text: string) => text.replaceAll("|", "\\|");

/** A fence longer than any run of backticks in `text`, so the text can't close it early. */
const fenceFor = (text: string) => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));

  return "`".repeat(longest + 1);
};

const skillTable = (reviewed: readonly Reviewed[]) => [
  "| Skill | Change | Files |",
  "| --- | --- | --- |",
  ...reviewed.map(
    ({ update, diff, problem }) =>
      `| \`${cell(update.name)}\` | ${update.change} | ${cell(diff === undefined ? (problem ?? "") : fileSummary(diff))} |`,
  ),
];

const notes = (reviewed: readonly Reviewed[]) =>
  reviewed.flatMap(({ update, diff, was, now }) => {
    const risky = diff === undefined ? undefined : riskySummary(diff);
    const ratings = ratingChange(was, now);

    return [
      ...(risky === undefined
        ? []
        : [`- ⚠ **Can run code, new or changed** in \`${update.name}\`: ${risky}`]),
      ...(ratings === undefined ? [] : [`- **Ratings** of \`${update.name}\`: ${ratings}`]),
    ];
  });

/** Collapsed diffs, as many as fit in `budget` characters; returns the text and whether all fit. */
const diffBlocks = (reviewed: readonly Reviewed[], budget: number) => {
  let left = budget;
  let complete = true;

  const blocks = reviewed.flatMap(({ update, diff }) => {
    const patch = diff?.patch ?? "";
    const fence = fenceFor(patch);

    const block = [
      `<details><summary>Diff of <code>${update.name}</code> (${commitMove(update)})</summary>`,
      "",
      `${fence}diff`,
      patch.trimEnd(),
      fence,
      "",
      "</details>",
      "",
    ].join("\n");

    if (patch === "" || patch.length > PATCH_LIMIT || block.length > left) {
      complete = complete && patch === "";

      return patch === "" ? [] : [`_The diff of \`${update.name}\` is too long to show here._`, ""];
    }

    left -= block.length;

    return [block];
  });

  return { text: blocks.join("\n"), complete };
};

const referenceSection = (key: string, reviewed: readonly Reviewed[]) => [
  `### \`${key}\``,
  "",
  ...(reviewed.length === 0
    ? ["No skill's files changed; only the commit moved."]
    : skillTable(reviewed)),
  "",
  ...notes(reviewed),
];

/**
 * The PR body: the References and their commits, then per Reference its skill changes, anything
 * that can run code, ratings, and the diffs (capped, with a pointer to `scilla diff`).
 */
const proposalBody = (
  outdated: readonly ReferenceStatus[],
  reviewed: readonly Reviewed[],
  referenceOf: (entry: Reviewed) => string | undefined,
) => {
  const summary = [
    "## Reviewed updates",
    "",
    `Merging this bumps \`${REVIEW_FILE}\`, which releases these upstream commits to the Collection's Consumers. Read the changes before you merge.`,
    "",
    "| Reference | Reviewed → upstream |",
    "| --- | --- |",
    ...outdated.map((status) => `| \`${cell(status.key)}\` | ${moveOf(status)} |`),
    "",
    ...outdated.flatMap((status) =>
      referenceSection(
        status.key,
        reviewed.filter((entry) => referenceOf(entry) === status.key),
      ),
    ),
  ].join("\n");

  const diffs = diffBlocks(reviewed, BODY_LIMIT - summary.length);

  const footer = diffs.complete
    ? "Run `scilla diff` in a checkout of this Collection to read the changes locally."
    : "Some diffs are left out to keep this short. Run `scilla diff` in a checkout of this Collection to read them all.";

  return [summary, "", "### Diffs", "", diffs.text, "---", "", footer, ""].join("\n");
};

const commitBody = (outdated: readonly ReferenceStatus[]) =>
  outdated.map((status) => `- ${status.key}: ${moveOf(status)}`).join("\n");

const writeOut = async (io: Io, command: ProposeCommand, title: string, body: string) => {
  if (command.titleFile === undefined && command.bodyFile === undefined) {
    io.stdout.write(`${title}\n\n${body}`);

    return;
  }

  await Promise.all([
    command.titleFile === undefined
      ? io.stdout.write(`${title}\n`)
      : writeFile(resolve(io.cwd, command.titleFile), `${title}\n`),
    command.bodyFile === undefined
      ? io.stdout.write(body)
      : writeFile(resolve(io.cwd, command.bodyFile), body),
  ]);
};

/** Where `--open` sends the pull request; worked out before anything is committed. */
const forgeFor = async (io: Io, command: ProposeCommand) => {
  const remote = parseRemote(await originUrl(io.cwd));
  const provider = detectProvider(remote, command.provider, io.env);

  if (provider === undefined) {
    throw new ScillaError(
      `Can't tell which forge hosts ${remote.host}; pass --provider github|gitea|forgejo|gitlab.`,
    );
  }

  return { remote, provider };
};

/**
 * `scilla review propose`: commit the upstream commits of the outdated References as reviewed on
 * `scilla/review-updates`, and write a PR title and body; `--open` pushes it and opens the PR.
 */
export const propose = async (io: Io, command: ProposeCommand) => {
  const gathered = await gatherCollection(io);
  const outdated = gathered.statuses.filter((status) => reviewState(status) === "outdated");

  if (outdated.length === 0) {
    io.stderr.write("Nothing to propose: every reviewed Reference is at its reviewed commit.\n");

    return;
  }

  const keys = new Set(outdated.map((status) => status.key));

  const reviewed = await reviewUpdates(io, gathered, command.audit, (update) =>
    keys.has(gathered.referenceOf(update) ?? ""),
  );

  const forge = command.open ? await forgeFor(io, command) : undefined;
  const title = proposalTitle(outdated);
  const body = proposalBody(outdated, reviewed, (entry) => gathered.referenceOf(entry.update));

  const proposal = await commitProposal(io.cwd, gathered.statuses, outdated, () => ({
    subject: title,
    body: commitBody(outdated),
  }));

  io.stderr.write(
    `Committed ${shortCommit(proposal.commit)} on ${proposal.branch} (from ${proposal.base}).\n`,
  );
  await writeOut(io, command, title, body);

  if (forge === undefined) {
    io.stderr.write(`Push it with: git push --force origin ${proposal.branch}\n`);

    return;
  }

  await pushProposal(io.cwd, proposal.branch);

  const request = { title, body, head: proposal.branch, base: proposal.base };
  const opened = await openPullRequest(forge.provider, forge.remote, request, io);

  io.stderr.write(`${opened.updated ? "Updated" : "Opened"} ${opened.url}\n`);
};
