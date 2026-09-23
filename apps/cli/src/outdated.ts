import { changesSkills, reviewState, type ReferenceStatus, type SkillUpdate } from "@scilla/core";
import { commitOrNone } from "./diff.ts";
import type { Io } from "./io.ts";
import { Reporter, shortCommit, table } from "./report.ts";
import { gather, type Gathered, type Section } from "./updates.ts";

/** `scilla outdated` exits with this when an update (or a review) would change skills. */
const OUTDATED_EXIT = 10;

const CHANGE_LABELS: Readonly<Record<SkillUpdate["change"], string>> = {
  changed: "changed",
  new: "new",
  removed: "removed",
  moved: "moved (same files)",
};

const skillRow = (update: SkillUpdate) => [
  update.name,
  CHANGE_LABELS[update.change],
  commitOrNone(update.before?.commit),
  commitOrNone(update.after?.commit),
];

const printInstalled = (reporter: Reporter, section: Section) => {
  const { before, after } = section.commits ?? { before: "", after: "" };

  if (section.updates.length === 0) {
    reporter.line(`${section.title} at ${shortCommit(after)}: up to date`);

    return;
  }

  reporter.line(`${section.title}  ${shortCommit(before)} → ${shortCommit(after)}`);

  for (const line of table([
    ["Skill", "Change", "Installed", "Upstream"],
    ...section.updates.map(skillRow),
  ])) {
    reporter.line(line);
  }
};

const referenceRow = (status: ReferenceStatus) => [
  status.key,
  reviewState(status),
  commitOrNone(status.reviewed),
  commitOrNone(status.upstream),
];

const printReferences = (reporter: Reporter, gathered: Gathered, title: string) => {
  if (gathered.statuses.length === 0) {
    reporter.line(`${title} has no fetched References to review.`);

    return;
  }

  reporter.line(`${title}: each Reference against its reviewed commit`);

  for (const line of table([
    ["Reference", "State", "Reviewed", "Upstream"],
    ...gathered.statuses.map(referenceRow),
  ])) {
    reporter.line(line);
  }

  for (const status of gathered.statuses) {
    if (status.problem !== undefined) {
      reporter.warn(`Reference "${status.key}": ${status.problem}`);
    }
  }
};

const printReleasable = (
  reporter: Reporter,
  gathered: Gathered,
  updates: readonly SkillUpdate[],
) => {
  if (updates.length === 0) {
    return;
  }

  const rows = updates.map((update) => {
    const [name = "", change = "", before = "", after = ""] = skillRow(update);

    return [name, change, gathered.referenceOf(update) ?? "Own Skills", before, after];
  });

  reporter.line("Skills a review would release:");

  for (const line of table([["Skill", "Change", "Reference", "Reviewed", "Upstream"], ...rows])) {
    reporter.line(line);
  }
};

const printReviewed = (reporter: Reporter, gathered: Gathered) => {
  const [section] = gathered.sections;

  printReferences(reporter, gathered, section?.title ?? "This Collection");
  printReleasable(reporter, gathered, section?.updates ?? []);
};

/**
 * `scilla outdated [-g]`: what `update` would change for each installed Collection or, inside a
 * Collection, each Reference against its reviewed commit. Exits 10 when anything would change.
 */
export const outdated = async (io: Io, global: boolean) => {
  const gathered = await gather(io, global, undefined);
  const reporter = new Reporter(io);

  if (gathered.curator) {
    printReviewed(reporter, gathered);

    const behind = gathered.statuses.some((status) => reviewState(status) === "outdated");

    reporter.line(
      behind
        ? "Read the changes with scilla diff, then release them with scilla review accept."
        : "Every reviewed Reference is at its reviewed commit.",
    );

    return behind ? OUTDATED_EXIT : 0;
  }

  if (gathered.sections.length === 0) {
    reporter.line("No Collections installed.");

    return 0;
  }

  for (const section of gathered.sections) {
    printInstalled(reporter, section);
  }

  const behind = gathered.sections.some((section) => changesSkills(section.updates));

  reporter.line(
    behind
      ? "Read the changes with scilla diff, then install them with scilla update."
      : "Everything is up to date.",
  );

  return behind ? OUTDATED_EXIT : 0;
};
