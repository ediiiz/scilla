import {
  auditSkills,
  readLock,
  UNAUDITED_REASONS,
  type AuditReport,
  type AuditTarget,
  type Risk,
  type SkillAudit,
  type Unaudited,
} from "@scilla/core";
import { scopeFor, type Io } from "./io.ts";
import { Reporter, table, where } from "./report.ts";

/** Ratings that make an attended install ask before going ahead. */
const RISKY: ReadonlySet<Risk> = new Set(["medium", "high", "critical"]);

/** Columns every table shows; providers beyond these get a column only when they rated something. */
const BASE_COLUMNS = ["Gen", "Socket", "Snyk"];

const NOT_RATED = "--";

const EMPTY_REPORT: AuditReport = { audits: new Map(), unaudited: new Map() };

/** Start fetching ratings; it never rejects, so an audit can't fail a command. */
export const startAudit = (io: Io, skills: readonly AuditTarget[], enabled: boolean) =>
  auditSkills(skills, { enabled, fetch: io.fetch, env: io.env }).catch(() => EMPTY_REPORT);

const columnsFor = (audits: readonly SkillAudit[]) => {
  const extra = audits.flatMap((audit) => audit.providers.map((provider) => provider.label));

  return [...new Set([...BASE_COLUMNS, ...extra])];
};

const cell = (audit: SkillAudit | undefined, label: string) => {
  const provider = audit?.providers.find((candidate) => candidate.label === label);

  if (provider === undefined) {
    return NOT_RATED;
  }

  const alerts = provider.alerts ?? 0;

  return alerts > 0 ? `${provider.risk} (${alerts} alerts)` : provider.risk;
};

/** The "Security risk assessments" table for `names`: one row each, `--` where there's no rating. */
export const auditTable = (names: readonly string[], audits: ReadonlyMap<string, SkillAudit>) => {
  const rated = names.flatMap((name) => {
    const audit = audits.get(name);

    return audit === undefined ? [] : [audit];
  });

  const columns = columnsFor(rated);
  const row = (name: string) => [name, ...columns.map((label) => cell(audits.get(name), label))];
  const details = [...new Set(rated.map((audit) => audit.detailsUrl))];

  return [
    "Security risk assessments",
    ...table([["Skill", ...columns], ...names.map((name) => row(name))]),
    ...details.map((url) => `  Details: ${url}`),
  ];
};

/** "Not audited: a, b (not from GitHub); c (…)", or undefined when every skill was audited. */
export const unauditedLine = (unaudited: ReadonlyMap<string, Unaudited>) => {
  const groups = Map.groupBy(unaudited.keys(), (name) => unaudited.get(name) ?? "no-data");

  const parts = [...groups].map(
    ([reason, names]) => `${names.toSorted().join(", ")} (${UNAUDITED_REASONS[reason]})`,
  );

  return parts.length === 0 ? undefined : `Not audited: ${parts.join("; ")}.`;
};

const worstOf = (audit: SkillAudit | undefined) => audit?.worst;

/**
 * Before an install: print the ticked skills' ratings and, when one is rated medium or worse, ask
 * on a terminal whether to go ahead. Unattended runs only warn. Resolves false when the Consumer
 * says no.
 */
export const reviewAudit = async (
  io: Io,
  reporter: Reporter,
  pending: Promise<AuditReport>,
  ticked: readonly string[],
  attended: boolean,
) => {
  const { audits } = await pending;
  const rated = ticked.filter((name) => audits.has(name));

  if (rated.length === 0) {
    return true;
  }

  for (const line of auditTable(rated, audits)) {
    reporter.line(line);
  }

  if (rated.length < ticked.length) {
    reporter.line(`  ${ticked.length - rated.length} other skill(s) not audited.`);
  }

  const risky = rated.flatMap((name) => {
    const worst = worstOf(audits.get(name));

    return worst !== undefined && RISKY.has(worst) ? [`${name} (${worst})`] : [];
  });

  if (risky.length === 0) {
    return true;
  }

  const summary = `Rated medium risk or higher: ${risky.join(", ")}`;

  if (!attended) {
    reporter.warn(summary);

    return true;
  }

  const answer = await io.ask(`${summary}. Proceed with installation? [y/N] `);

  return /^y(es)?$/i.test(answer.trim());
};

/** `scilla audit [-g]`: ratings for every skill in the lock. */
export const audit = async (io: Io, global: boolean, enabled: boolean) => {
  const lock = await readLock(scopeFor(io, global));
  const reporter = new Reporter(io);

  const targets = Object.entries(lock.skills)
    .map(([name, entry]): AuditTarget => ({ name, kind: entry.kind, url: entry.url }))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  if (targets.length === 0) {
    reporter.line(`Nothing installed ${where(global)}.`);

    return;
  }

  const report = await io.tui.withProgress(
    "Checking security ratings",
    () => startAudit(io, targets, enabled),
    io.stderr,
  );

  if (report.audits.size > 0) {
    for (const line of auditTable(
      targets.map((target) => target.name),
      report.audits,
    )) {
      reporter.line(line);
    }
  }

  const missing = unauditedLine(report.unaudited);

  if (missing !== undefined) {
    reporter.line(missing);
  }
};
