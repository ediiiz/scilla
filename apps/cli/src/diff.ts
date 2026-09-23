import {
  diffSkill,
  riskyFiles,
  ScillaError,
  type AuditTarget,
  type SkillAudit,
  type SkillDiff,
  type SkillUpdate,
} from "@scilla/core";
import type { DiffCommand } from "./args.ts";
import { startAudit } from "./audit.ts";
import type { Io } from "./io.ts";
import { paint, Reporter, shortCommit, wantsStyle, type Style } from "./report.ts";
import { gather, type Gathered } from "./updates.ts";

/** One skill update with its file diff and its ratings before and after. */
export interface Reviewed {
  readonly update: SkillUpdate;
  /** The Collection it belongs to, as `outdated` titles it. */
  readonly section: string;
  /** Undefined when the earlier version couldn't be read; `problem` says why. */
  readonly diff: SkillDiff | undefined;
  readonly problem: string | undefined;
  readonly was: SkillAudit | undefined;
  readonly now: SkillAudit | undefined;
}

const diffOf = async (gathered: Gathered, update: SkillUpdate) => {
  try {
    const diff = await diffSkill(await gathered.beforeDir(update), update.after?.dir);

    return { diff, problem: undefined };
  } catch (cause) {
    if (cause instanceof ScillaError) {
      return { diff: undefined, problem: cause.message };
    }

    throw cause;
  }
};

const targetsOf = (updates: readonly SkillUpdate[], side: "before" | "after") =>
  updates.flatMap((update): AuditTarget[] => {
    const origin = update[side];

    return origin === undefined ? [] : [{ name: update.name, kind: origin.kind, url: origin.url }];
  });

/** Diff each update that changes files (moves don't) and fetch ratings for both versions. */
export const reviewUpdates = async (
  io: Io,
  gathered: Gathered,
  audit: boolean,
  wanted: (update: SkillUpdate) => boolean,
) => {
  const picked = gathered.sections.flatMap((section) =>
    section.updates.flatMap((update) =>
      update.change !== "moved" && wanted(update) ? [{ update, section: section.title }] : [],
    ),
  );

  const updates = picked.map(({ update }) => update);

  const [diffs, was, now] = await Promise.all([
    Promise.all(updates.map((update) => diffOf(gathered, update))),
    startAudit(io, targetsOf(updates, "before"), audit),
    startAudit(io, targetsOf(updates, "after"), audit),
  ]);

  return picked.map(({ update, section }, index): Reviewed => ({
    update,
    section,
    diff: diffs[index]?.diff,
    problem: diffs[index]?.problem,
    was: was.audits.get(update.name),
    now: now.audits.get(update.name),
  }));
};

const riskOf = (audit: SkillAudit | undefined, label: string) =>
  audit?.providers.find((provider) => provider.label === label)?.risk ?? "--";

/** `Gen safe → medium · Snyk -- → low`, or undefined when neither version has ratings. */
export const ratingChange = (was: SkillAudit | undefined, now: SkillAudit | undefined) => {
  const labels = [
    ...new Set(
      [...(now?.providers ?? []), ...(was?.providers ?? [])].map((provider) => provider.label),
    ),
  ];

  if (labels.length === 0) {
    return undefined;
  }

  return labels
    .map((label) => `${label} ${riskOf(was, label)} → ${riskOf(now, label)}`)
    .join(" · ");
};

const FILE_MARKS = { added: "A", removed: "D", modified: "M" } as const;

/** `M SKILL.md, A logo.png (binary)`: every file that differs. */
export const fileSummary = (diff: SkillDiff) =>
  diff.files
    .map((file) => `${FILE_MARKS[file.change]} ${file.path}${file.binary ? " (binary)" : ""}`)
    .join(", ");

/** `scripts/run.sh (added), bin/x (modified)`, or undefined when no new or changed file can run code. */
export const riskySummary = (diff: SkillDiff) => {
  const risky = riskyFiles(diff);

  return risky.length === 0
    ? undefined
    : risky.map((file) => `${file.path} (${file.change})`).join(", ");
};

/** A short commit, or `--` for a version that doesn't exist. */
export const commitOrNone = (value: string | undefined) =>
  value === undefined ? "--" : shortCommit(value);

/** `abc1234 → def5678`, with `--` for a side that doesn't exist. */
export const commitMove = (update: SkillUpdate) => {
  return `${commitOrNone(update.before?.commit)} → ${commitOrNone(update.after?.commit)}`;
};

const patchStyle = (line: string): Style | undefined => {
  if (line.startsWith("diff --git") || line.startsWith("+++") || line.startsWith("---")) {
    return "bold";
  }

  if (line.startsWith("@@")) {
    return "heading";
  }

  if (line.startsWith("+")) {
    return "added";
  }

  return line.startsWith("-") ? "removed" : undefined;
};

type Painter = ReturnType<typeof paint>;

/** `url path` of the version shown: upstream's, or the installed one for a removed skill. */
const originText = (update: SkillUpdate) => {
  const origin = update.after ?? update.before;

  if (origin === undefined) {
    return "";
  }

  return origin.path === "" ? origin.url : `${origin.url} ${origin.path}`;
};

/** The lines under a skill's heading: origin, ratings, and files that can run code. */
const detailLines = (style: Painter, reviewed: Reviewed) => {
  const ratings = ratingChange(reviewed.was, reviewed.now);
  const risky = reviewed.diff === undefined ? undefined : riskySummary(reviewed.diff);

  return [
    `  from     ${originText(reviewed.update)}`,
    ...(ratings === undefined ? [] : [`  ratings  ${ratings}`]),
    ...(risky === undefined ? [] : [style(`  ⚠ can run code, new or changed: ${risky}`, "warn")]),
  ];
};

const patchLines = (style: Painter, diff: SkillDiff) =>
  diff.patch
    .split("\n")
    .slice(0, -1)
    .map((line) => {
      const lineStyle = patchStyle(line);

      return lineStyle === undefined ? line : style(line, lineStyle);
    });

const printReviewed = (reporter: Reporter, style: Painter, reviewed: Reviewed) => {
  const { update, diff } = reviewed;
  const heading = `${update.name}  ${update.change}  ${commitMove(update)}  (${reviewed.section})`;

  for (const line of [style(heading, "heading"), ...detailLines(style, reviewed)]) {
    reporter.line(line);
  }

  if (diff === undefined) {
    reporter.warn(`Can't diff ${update.name}: ${reviewed.problem ?? "its files can't be read"}`);

    return;
  }

  for (const line of [`  files    ${fileSummary(diff)}`, "", ...patchLines(style, diff)]) {
    reporter.line(line);
  }
};

/**
 * What `diff` shows for `target`: a Collection (by name or key) or a root Reference key takes all
 * its skills, anything else is a skill name.
 */
const wantedBy = (gathered: Gathered, target: string | undefined) => (update: SkillUpdate) =>
  target === undefined ||
  gathered.narrowed ||
  update.name === target ||
  gathered.referenceOf(update) === target;

/**
 * `scilla diff [collection|skill] [-g] [--raw]`: per skill, what an update (or, inside a
 * Collection, a review) would change: files, ratings, and git's unified diff.
 */
export const diff = async (io: Io, command: DiffCommand) => {
  const gathered = await gather(io, command.global, command.target);
  const reporter = new Reporter(io);

  const reviewed = await reviewUpdates(
    io,
    gathered,
    command.audit,
    wantedBy(gathered, command.target),
  );

  const style = paint(wantsStyle(io, command.raw));

  if (
    command.target !== undefined &&
    reviewed.length === 0 &&
    !gathered.known.has(command.target)
  ) {
    throw new ScillaError(
      `Nothing called "${command.target}" to diff: no Collection, Reference or skill has that name.`,
    );
  }

  if (reviewed.length === 0) {
    reporter.line(
      command.target === undefined ? "No changes." : `No changes for ${command.target}.`,
    );

    return;
  }

  for (const [index, entry] of reviewed.entries()) {
    if (index > 0) {
      reporter.line();
    }

    printReviewed(reporter, style, entry);
  }
};
