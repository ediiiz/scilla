import { afterEach, describe, expect, test } from "bun:test";
import type { Agent, AuditReport } from "@scilla/core";
import { act } from "react";
import type { PickResult } from "./confirm-model.ts";
import { SkillPicker } from "./SkillPicker.tsx";
import { plan } from "./test-fixtures.ts";
import { mountScreen, reporter, unmountAll } from "./test-render.ts";

afterEach(unmountAll);

const mount = async (
  fixture: ReturnType<typeof plan>,
  height = 30,
  audit?: Promise<AuditReport>,
) => {
  const { reported, done } = reporter<ReadonlySet<string> | undefined>();

  const screen = await mountScreen(
    <SkillPicker plan={fixture} audit={audit} onDone={(result) => done(result?.selected)} />,
    100,
    height,
  );

  return { ...screen, outcome: reported };
};

const basic = plan(
  [
    { name: "alpha", selected: true },
    { name: "beta", optional: true, executables: ["scripts/run.sh"] },
    { name: "gamma", via: ["acme/tools"], status: "new" },
    { name: "delta", via: ["acme/tools", "deep/nested"], status: "installed", selected: true },
    {
      name: "omega",
      via: ["other/repo"],
      status: "conflict",
      note: "already installed from https://x.test/y.git",
    },
  ],
  ["could not fetch broken/repo"],
  ["old-skill"],
);

describe("SkillPicker rendering", () => {
  test("shows header, groups, badges, detail pane, warnings and key help", async () => {
    const { frame } = await mount(basic);
    const text = frame();

    expect(text).toContain("Acme Skills");
    expect(text).toContain("Skills for building rockets.");
    expect(text).toContain("2/4 selected");
    expect(text).toContain("Own Skills");
    expect(text).toContain("acme/tools");
    expect(text).toContain("[x] alpha");
    expect(text).toContain("[ ] beta optional ⚠ runs code");
    expect(text).toContain("gamma new");
    expect(text).toContain("delta installed  ‹ deep/nested");
    expect(text).toContain("[-] omega conflict");
    expect(text).toContain("already installed from https://x.test/y.git");
    expect(text).toContain("url     https://github.com/acme/skil");
    expect(text).toContain("commit  0123456");
    expect(text).toContain("could not fetch broken/repo");
    expect(text).toContain("will be removed: old-skill");
    expect(text).toContain("space toggle");
  });

  test("the detail pane follows focus and lists executables", async () => {
    const { frame, press } = await mount(basic);

    await press("j");

    expect(frame()).toContain("path    skills/beta");
    expect(frame()).toContain("scripts/run.sh");
  });

  test("the detail pane names at most 5 executables, then +N more", async () => {
    const executables = Array.from({ length: 40 }, (_, index) => `bin/tool-${index}.sh`);
    const { frame } = await mount(plan([{ name: "big", executables }]), 40);
    const text = frame();

    expect(text).toContain("bin/tool-4.sh");
    expect(text).not.toContain("bin/tool-5.sh");
    expect(text).toContain("+35 more");
  });
});

describe("SkillPicker keys", () => {
  test("move, toggle and confirm", async () => {
    const { outcome, press } = await mount(basic);

    await press("ARROW_DOWN", " ", "k", " ", "RETURN");

    expect(outcome.value).toEqual(new Set(["beta", "delta"]));
  });

  test("toggle-all ticks every selectable row, then clears them", async () => {
    const { outcome, frame, press } = await mount(basic);

    await press("a");

    expect(frame()).toContain("4/4 selected");

    await press("a", "RETURN");

    expect(outcome.value).toEqual(new Set());
  });

  test("conflict rows can be focused and show their origin and note", async () => {
    const { frame, press } = await mount(basic);

    await press("END");

    expect(frame()).toContain("› [-] omega");
    expect(frame()).toContain("path    skills/omega");
    expect(frame()).toContain("commit  0123456");
    expect(frame()).toContain("url     https://github.com/acme/skil");

    await press("k", "j");

    expect(frame()).toContain("› [-] omega");

    await press("HOME", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN", "ARROW_DOWN");

    expect(frame()).toContain("› [-] omega");
  });

  test("the detail pane shows a conflict's executables and note", async () => {
    const clash = plan([
      { name: "alpha" },
      {
        name: "omega",
        status: "conflict",
        note: "already installed from x/y",
        executables: ["bin/omega"],
      },
    ]);

    const { frame, press } = await mount(clash);

    await press("j");

    const text = frame();

    expect(text).toContain("› [-] omega");
    expect(text).toContain("path    skills/omega");
    // Once as the row's subtitle, once in the detail pane.
    expect(text.split("already installed from x/y")).toHaveLength(3);
    expect(text).toContain("contains files that can run code");
    expect(text).toContain("bin/omega");
  });

  test("space on a conflict row hints instead of ticking it", async () => {
    const { outcome, frame, press } = await mount(basic);

    await press("END", " ");

    expect(frame()).toContain("› [-] omega");
    expect(frame()).toContain("can't select: already installed from https://x.test/y.git");
    expect(frame()).toContain("2/4 selected");

    await press("k");

    expect(frame()).toContain("space toggle");

    await press("RETURN");

    expect(outcome.value).toEqual(new Set(["alpha", "delta"]));
  });

  test("toggle-all and confirm leave conflict rows out", async () => {
    const { outcome, frame, press } = await mount(basic);

    await press("END", "a");

    expect(frame()).toContain("4/4 selected");
    expect(frame()).toContain("[-] omega");

    await press("RETURN");

    expect(outcome.value).toEqual(new Set(["alpha", "beta", "gamma", "delta"]));
  });

  test("escape and q cancel", async () => {
    const first = await mount(basic);

    await first.press("ESCAPE");

    expect(first.outcome.value).toBeUndefined();

    unmountAll();

    const second = await mount(basic);

    await second.press("q");

    expect(second.outcome.value).toBeUndefined();
  });

  test("the list scrolls to follow focus", async () => {
    const many = plan(
      Array.from({ length: 30 }, (_, index) => ({
        name: `skill-${String(index).padStart(2, "0")}`,
      })),
    );

    const { frame, press, waitFor } = await mount(many, 16);

    expect(frame()).not.toContain("skill-29");

    // Focus reaches the list a tick after the key, and the scroll follows in an effect after that
    // render; under load that takes more than the passes `press` waits for, so wait on the frame.
    await press("END");
    await waitFor("› [ ] skill-29");

    expect(frame()).toContain("› [ ] skill-29");
    expect(frame()).not.toContain("skill-00");

    await press("HOME");
    await waitFor("› [ ] skill-00");

    expect(frame()).toContain("› [ ] skill-00");
  });
});

const rated = plan([{ name: "alpha", selected: true }, { name: "beta" }, { name: "gamma" }]);

const REPORT: AuditReport = {
  audits: new Map([
    [
      "alpha",
      {
        providers: [
          { id: "ath", label: "Gen", risk: "safe" },
          { id: "socket", label: "Socket", risk: "low", alerts: 1 },
        ],
        worst: "low",
        detailsUrl: "https://skills.sh/acme/skills",
      },
    ],
    [
      "beta",
      {
        providers: [{ id: "snyk", label: "Snyk", risk: "critical", score: 12 }],
        worst: "critical",
        detailsUrl: "https://skills.sh/acme/skills",
      },
    ],
  ]),
  unaudited: new Map([["gamma", "no-data"]]),
};

/** A row with no badge after its name: only spaces up to the detail pane's border. */
const unbadged = (name: string) => new RegExp(`\\] ${name} +│`);

/** An audit the test settles by hand, inside `act` so React sees the update. */
const pendingAudit = () => {
  const { promise, resolve, reject } = Promise.withResolvers<AuditReport>();

  return {
    promise,
    resolve: (report: AuditReport) => act(async () => resolve(report)),
    reject: () => act(async () => reject(new Error("offline"))),
  };
};

describe("SkillPicker ratings", () => {
  test("without an audit there is no rating status or badge", async () => {
    const { frame } = await mount(rated);

    expect(frame()).not.toContain("checking ratings");
    expect(frame()).toMatch(unbadged("alpha"));
  });

  test("while pending, the header says so and rows have no badge", async () => {
    const audit = pendingAudit();
    const { frame } = await mount(rated, 30, audit.promise);

    expect(frame()).toContain("checking ratings…  1/3 selected");
    expect(frame()).not.toContain("alpha low");
  });

  test("when resolved, rows get badges and the detail pane lists each provider", async () => {
    const audit = pendingAudit();
    const { frame, press, waitFor } = await mount(rated, 30, audit.promise);

    await audit.resolve(REPORT);
    await waitFor("alpha low");

    const text = frame();

    expect(text).not.toContain("checking ratings");
    expect(text).toContain("[x] alpha low");
    expect(text).toContain("[ ] beta critical");
    expect(text).toMatch(unbadged("gamma"));
    expect(text).toContain("security ratings");
    expect(text).toContain("Gen     safe");
    expect(text).toContain("Socket  low · 1 alert");
    expect(text).toContain("details");
    expect(text).toContain("  https://skills.sh/acme/skills");

    await press("j");

    expect(frame()).toContain("Snyk  critical · score 12");
  });

  test("an unaudited skill says why, never safe", async () => {
    const { frame, press, waitFor } = await mount(rated, 30, Promise.resolve(REPORT));

    await waitFor("alpha low");
    await press("END");

    expect(frame()).toMatch(unbadged("gamma"));
    expect(frame()).toContain("not audited (no ratings yet)");
    expect(frame()).not.toContain("safe");
  });

  test("a rejected audit just clears the loading state", async () => {
    const audit = pendingAudit();
    const { frame, waitFor } = await mount(rated, 30, audit.promise);

    await audit.reject();
    // More than the two spaces after "checking ratings…": the note is gone.
    await waitFor("   1/3 selected");

    expect(frame()).not.toContain("checking ratings");
    expect(frame()).not.toContain("not audited");
    expect(frame()).toMatch(unbadged("alpha"));
  });

  test("the preview header lists the providers too", async () => {
    const { frame, press, waitFor } = await mount(rated, 30, Promise.resolve(REPORT));

    await waitFor("alpha low");
    await press("j", "p");
    await waitFor("beta  recommended");

    expect(frame()).toContain("Snyk  critical · score 12");
    expect(frame()).toContain("  https://skills.sh/acme/skills");
  });
});

/** A picker that reports its whole result, for the dialogs Enter can open. */
const CLAUDE: Agent = { folder: ".claude", name: "Claude Code" };

const CURSOR: Agent = { folder: ".cursor", name: "Cursor" };

const confirming = async (audit?: Promise<AuditReport>, askLinks?: readonly Agent[]) => {
  const { reported, done } = reporter<PickResult | undefined>();

  const screen = await mountScreen(
    <SkillPicker plan={rated} audit={audit} askLinks={askLinks} onDone={done} />,
    100,
    30,
  );

  return { ...screen, outcome: reported };
};

describe("SkillPicker confirmation", () => {
  test("a risky tick asks before finishing; n goes back, y installs", async () => {
    const { frame, press, waitFor, outcome } = await confirming(Promise.resolve(REPORT));

    await waitFor("alpha low");
    await press("j", " ", "RETURN");

    expect(frame()).toContain("Rated medium risk or higher");
    expect(frame()).toContain("beta  critical");
    expect(frame()).not.toContain("alpha  low");

    await press(" ", "n");

    expect(frame()).not.toContain("Rated medium risk or higher");
    expect(outcome.value).toBe("pending");

    await press("RETURN", "y");

    expect(outcome.value).toEqual({ selected: new Set(["alpha", "beta"]) });
  });

  test("nothing risky and nothing to ask finishes on Enter", async () => {
    const { press, waitFor, outcome } = await confirming(Promise.resolve(REPORT));

    await waitFor("alpha low");
    await press("RETURN");

    expect(outcome.value).toEqual({ selected: new Set(["alpha"]) });
  });

  test("Enter before the ratings arrive waits for them, then goes on when none is risky", async () => {
    const audit = pendingAudit();
    const { frame, press, waitFor, outcome } = await confirming(audit.promise);

    await press("RETURN");

    expect(frame()).toContain("Still checking the security ratings");

    await audit.resolve(REPORT);
    await waitFor("alpha low");

    expect(outcome.value).toEqual({ selected: new Set(["alpha"]) });
  });

  test("asks about linking into a missing agent folder and returns the answer", async () => {
    const declined = await confirming(undefined, [CLAUDE]);

    await declined.press("RETURN");

    expect(declined.frame()).toContain("Link the skills into it, so Claude Code finds them");

    await declined.press("n");

    expect(declined.outcome.value).toEqual({
      selected: new Set(["alpha"]),
      agentLinks: { ".claude": false },
    });

    const accepted = await confirming(Promise.resolve(REPORT), [CLAUDE]);

    await accepted.waitFor("alpha low");
    await accepted.press("j", " ", "RETURN", "y");

    expect(accepted.frame()).toContain("Link the skills into it, so Claude Code finds them");

    await accepted.press("ESCAPE");

    expect(accepted.frame()).not.toContain("Link the skills");

    await accepted.press("RETURN", "y", "y");

    expect(accepted.outcome.value).toEqual({
      selected: new Set(["alpha", "beta"]),
      agentLinks: { ".claude": true },
    });
  });

  test("with several agents, a checklist records each answer", async () => {
    const { frame, press, outcome } = await confirming(undefined, [CLAUDE, CURSOR]);

    await press("RETURN");

    expect(frame()).toContain("› [x] .claude/skills  Claude Code");
    expect(frame()).toContain("  [x] .cursor/skills  Cursor");

    await press("j", " ");

    expect(frame()).toContain("› [ ] .cursor/skills  Cursor");

    await press("y");

    expect(outcome.value).toEqual({
      selected: new Set(["alpha"]),
      agentLinks: { ".claude": true, ".cursor": false },
    });
  });

  test("n answers no for every agent", async () => {
    const { press, outcome } = await confirming(undefined, [CLAUDE, CURSOR]);

    await press("RETURN", "n");

    expect(outcome.value).toEqual({
      selected: new Set(["alpha"]),
      agentLinks: { ".claude": false, ".cursor": false },
    });
  });
});
