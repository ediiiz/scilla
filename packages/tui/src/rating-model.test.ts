import { describe, expect, test } from "bun:test";
import type { AuditReport, SkillAudit } from "@scilla/core";
import { initialPickerState } from "./picker-model.ts";
import { headerStatus, ratingLines, rowBadges } from "./rating-model.ts";
import { choice, plan } from "./test-fixtures.ts";

const audit = (
  worst: SkillAudit["worst"],
  providers: SkillAudit["providers"] = [],
): SkillAudit => ({
  providers,
  worst,
  detailsUrl: "https://skills.sh/acme/skills",
});

const report: AuditReport = {
  audits: new Map([
    ["calm", audit("low")],
    ["tense", audit("medium")],
    ["scary", audit("critical")],
    ["blank", audit(undefined)],
    [
      "full",
      audit("high", [
        { id: "ath", label: "Gen", risk: "safe" },
        { id: "socket", label: "Socket", risk: "high", alerts: 3 },
        { id: "zeroleaks", label: "ZeroLeaks", risk: "medium", score: 40 },
      ]),
    ],
  ]),
  unaudited: new Map([["elsewhere", "not-github"]]),
};

const labels = (name: string, ratings: Parameters<typeof rowBadges>[1]) =>
  rowBadges(choice({ name, status: "new" }), ratings);

describe("rowBadges", () => {
  test("adds the worst rating in its colour after the other badges", () => {
    expect(labels("calm", report)).toEqual([
      { label: "new", tone: "accent" },
      { label: "low", tone: "good" },
    ]);
    expect(labels("tense", report).at(-1)).toEqual({ label: "medium", tone: "warn" });
    expect(labels("scary", report).at(-1)).toEqual({ label: "critical", tone: "danger" });
    expect(labels("full", report).at(-1)).toEqual({ label: "high", tone: "danger" });
  });

  test("adds nothing while loading, without ratings, or for an unaudited skill", () => {
    const plain: ReturnType<typeof rowBadges> = [{ label: "new", tone: "accent" }];

    expect(labels("calm", "pending")).toEqual(plain);
    expect(labels("calm", undefined)).toEqual(plain);
    expect(labels("elsewhere", report)).toEqual(plain);
    expect(labels("blank", report)).toEqual(plain);
  });
});

describe("headerStatus", () => {
  test("notes the ratings only while they load", () => {
    const state = initialPickerState(plan([{ name: "a", selected: true }, { name: "b" }]));

    expect(headerStatus(state, "pending")).toBe("checking ratings…  1/2 selected");
    expect(headerStatus(state, report)).toBe("1/2 selected");
    expect(headerStatus(state, undefined)).toBe("1/2 selected");
  });
});

describe("ratingLines", () => {
  test("lists each provider with its alerts and score, then the details URL", () => {
    expect(ratingLines(report, "full")).toEqual([
      { text: "security ratings", tone: "muted" },
      { text: "  Gen        safe", tone: "good" },
      { text: "  Socket     high · 3 alerts", tone: "danger" },
      { text: "  ZeroLeaks  medium · score 40", tone: "warn" },
      { text: "details", tone: "muted" },
      { text: "  https://skills.sh/acme/skills", tone: "muted" },
    ]);
  });

  test("says why a skill wasn't audited, never that it's safe", () => {
    expect(ratingLines(report, "elsewhere")).toEqual([
      { text: "not audited (not from GitHub)", tone: "muted" },
    ]);
    expect(ratingLines(report, "unknown")).toEqual([{ text: "not audited", tone: "muted" }]);
  });

  test("shows a note while loading and nothing without ratings", () => {
    expect(ratingLines("pending", "full")).toEqual([{ text: "checking ratings…", tone: "muted" }]);
    expect(ratingLines(undefined, "full")).toEqual([]);
  });
});
