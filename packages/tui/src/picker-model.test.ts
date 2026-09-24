import { describe, expect, test } from "bun:test";
import {
  badgesFor,
  focusedUntickable,
  groupChoices,
  initialPickerState,
  moveTarget,
  noticeLines,
  originLines,
  pickerIntent,
  pickerKeyOutcome,
  reducePicker,
  rowLook,
  selectionSummary,
  shortCommit,
} from "./picker-model.ts";
import { choice, plan, skill } from "./test-fixtures.ts";

describe("groupChoices", () => {
  test("groups by the first Reference, Own Skills first, with deeper labels as the trail", () => {
    const groups = groupChoices([
      choice({ name: "a", via: ["x/one"] }),
      choice({ name: "b" }),
      choice({ name: "c", via: ["x/one", "y/two", "z/three"] }),
      choice({ name: "d", via: ["w/four"] }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["Own Skills", "x/one", "w/four"]);
    expect(groups[1]?.rows.map((row) => row.choice.skill.name)).toEqual(["a", "c"]);
    expect(groups[1]?.rows[1]?.trail).toEqual(["y/two", "z/three"]);
  });

  test("leaves out an empty Own Skills group", () => {
    expect(
      groupChoices([choice({ name: "a", via: ["x/one"] })]).map((group) => group.label),
    ).toEqual(["x/one"]);
  });
});

describe("picker state", () => {
  const fixture = plan([
    { name: "a", selected: true },
    { name: "b" },
    { name: "c", status: "conflict", selected: true },
  ]);

  test("pre-ticks selected choices but never conflicts", () => {
    const state = initialPickerState(fixture);

    expect([...state.selected]).toEqual(["a"]);
    expect(selectionSummary(state)).toBe("1/2 selected");
  });

  test("focus follows the CheckboxGroup, within bounds", () => {
    const state = initialPickerState(fixture);

    expect(reducePicker(state, { kind: "focus", index: 1 }).focus).toBe(1);
    expect(reducePicker(state, { kind: "focus", index: 9 })).toBe(state);
  });

  test("select keeps only selectable names", () => {
    const state = reducePicker(initialPickerState(fixture), {
      kind: "select",
      names: ["b", "c", "zzz"],
    });

    expect(state.selected).toEqual(new Set(["b"]));
  });

  test("toggle-all ticks every selectable row, then clears", () => {
    const all = reducePicker(initialPickerState(fixture), { kind: "toggle-all" });

    expect(all.selected).toEqual(new Set(["a", "b"]));
    expect(reducePicker(all, { kind: "toggle-all" }).selected).toEqual(new Set());
  });

  test("moves land on conflict rows too, and stop at either end", () => {
    const rows = initialPickerState(
      plan([{ name: "a" }, { name: "x", status: "conflict" }, { name: "b" }]),
    );

    expect(moveTarget(rows, "next")?.choice.skill.name).toBe("x");
    expect(moveTarget(rows, "previous")?.choice.skill.name).toBe("a");
    expect(moveTarget(rows, "last")?.choice.skill.name).toBe("b");
    expect(moveTarget(rows, "first")?.choice.skill.name).toBe("a");
    expect(
      moveTarget(reducePicker(rows, { kind: "focus", index: 2 }), "next")?.choice.skill.name,
    ).toBe("b");
    expect(moveTarget(initialPickerState(plan([])), "next")).toBeUndefined();
  });

  test("the preview opens and closes over the focused row, keeping focus and ticks", () => {
    const state = reducePicker(initialPickerState(fixture), { kind: "focus", index: 1 });

    const open = reducePicker(reducePicker(state, { kind: "refuse" }), {
      kind: "preview",
      open: true,
    });

    expect(state.previewing).toBe(false);
    expect(open.previewing).toBe(true);
    expect(open.focus).toBe(1);
    expect(open.selected).toBe(state.selected);

    const closed = reducePicker(open, { kind: "preview", open: false });

    expect(closed.previewing).toBe(false);
    expect(closed.focus).toBe(1);

    const empty = initialPickerState(plan([]));

    expect(reducePicker(empty, { kind: "preview", open: true })).toBe(empty);
  });

  test("initial focus is the first row, conflict or not", () => {
    expect(initialPickerState(plan([{ name: "x", status: "conflict" }, { name: "a" }])).focus).toBe(
      0,
    );
    expect(initialPickerState(plan([])).focus).toBe(0);
  });

  test("refusing a conflict row hints with its note until the next action", () => {
    const state = initialPickerState(
      plan([
        { name: "x", status: "conflict", note: "already installed from elsewhere" },
        { name: "y", status: "conflict" },
        { name: "a" },
      ]),
    );

    expect(focusedUntickable(state)).toBe(true);

    const refused = reducePicker(state, { kind: "refuse" });

    expect(refused.hint).toBe("can't select: already installed from elsewhere");
    expect(refused.selected).toEqual(new Set());
    expect(reducePicker(refused, { kind: "focus", index: 1 }).hint).toBeUndefined();
    expect(reducePicker(refused, { kind: "toggle-all" }).hint).toBeUndefined();

    const unnoted = reducePicker(reducePicker(state, { kind: "focus", index: 1 }), {
      kind: "refuse",
    });

    expect(unnoted.hint).toBe("can't select: a skill with this name is already installed");

    const plain = reducePicker(state, { kind: "focus", index: 2 });

    expect(focusedUntickable(plain)).toBe(false);
    expect(reducePicker(plain, { kind: "refuse" })).toBe(plain);
  });
});

describe("the changes preview", () => {
  const state = initialPickerState(
    plan([
      { name: "same", status: "installed", selected: true },
      { name: "moved", status: "installed", selected: true, changed: true },
    ]),
  );

  test("d opens the preview on the changes of a changed skill", () => {
    const opened = reducePicker(reducePicker(state, { kind: "focus", index: 1 }), {
      kind: "preview",
      open: true,
      diff: true,
    });

    expect(opened).toMatchObject({ previewing: true, diffing: true, hint: undefined });
    expect(reducePicker(opened, { kind: "preview", open: false })).toMatchObject({
      previewing: false,
      diffing: false,
    });
  });

  test("d on a skill without changes only hints", () => {
    expect(reducePicker(state, { kind: "preview", open: true, diff: true })).toMatchObject({
      previewing: false,
      hint: "no changes since the lock to show",
    });
    expect(reducePicker(state, { kind: "preview", open: true })).toMatchObject({
      previewing: true,
      diffing: false,
    });
  });
});

describe("pickerIntent", () => {
  test("maps the keys the picker handles itself", () => {
    expect(pickerIntent("j", false)).toEqual({ kind: "move", target: "next" });
    expect(pickerIntent("k", false)).toEqual({ kind: "move", target: "previous" });
    expect(pickerIntent("end", false)).toEqual({ kind: "move", target: "last" });
    expect(pickerIntent("a", false)).toEqual({ kind: "toggle-all" });
    expect(pickerIntent("return", false)).toEqual({ kind: "confirm" });
    expect(pickerIntent("escape", false)).toEqual({ kind: "cancel" });
    expect(pickerIntent("c", true)).toEqual({ kind: "cancel" });
    expect(pickerIntent("p", false)).toEqual({ kind: "preview", open: true });
    expect(pickerIntent("right", false)).toEqual({ kind: "preview", open: true });
    expect(pickerIntent("l", false)).toEqual({ kind: "preview", open: true });
    expect(pickerIntent("d", false)).toEqual({ kind: "preview", open: true, diff: true });
    expect(pickerIntent("space", false)).toBeUndefined();
    expect(pickerIntent("down", false)).toBeUndefined();
  });
});

describe("pickerKeyOutcome", () => {
  const state = initialPickerState(
    plan([
      { name: "x", status: "conflict" },
      { name: "a", selected: true },
    ]),
  );

  test("decides the picker's own keys and passes the rest on", () => {
    expect(pickerKeyOutcome(state, "space", false)).toEqual({
      kind: "act",
      action: { kind: "refuse" },
    });
    expect(pickerKeyOutcome(state, "a", false)).toEqual({
      kind: "act",
      action: { kind: "toggle-all" },
    });
    expect(pickerKeyOutcome(state, "p", false)).toEqual({
      kind: "act",
      action: { kind: "preview", open: true },
    });
    expect(pickerKeyOutcome(state, "return", false)).toEqual({ kind: "confirm" });
    expect(pickerKeyOutcome(state, "q", false)).toEqual({ kind: "cancel" });
    expect(pickerKeyOutcome(state, "j", false)).toEqual({ kind: "pass" });
    expect(pickerKeyOutcome(state, "down", false)).toEqual({ kind: "pass" });

    const plain = reducePicker(state, { kind: "focus", index: 1 });

    expect(pickerKeyOutcome(plain, "space", false)).toEqual({ kind: "pass" });
  });

  test("the open preview owns every key but Ctrl+C", () => {
    const previewing = reducePicker(state, { kind: "preview", open: true });

    expect(pickerKeyOutcome(previewing, "q", false)).toEqual({ kind: "pass" });
    expect(pickerKeyOutcome(previewing, "escape", false)).toEqual({ kind: "pass" });
    expect(pickerKeyOutcome(previewing, "space", false)).toEqual({ kind: "pass" });
    expect(pickerKeyOutcome(previewing, "c", true)).toEqual({ kind: "cancel" });
  });

  test("an open dialog owns every key", () => {
    const asking = reducePicker(state, { kind: "dialog", dialog: "risk" });

    expect(pickerKeyOutcome(asking, "space", false)).toEqual({ kind: "dialog" });
    expect(pickerKeyOutcome(asking, "return", false)).toEqual({ kind: "dialog" });
    expect(reducePicker(asking, { kind: "dialog", dialog: undefined }).dialog).toBeUndefined();
  });
});

const label = (changed: boolean) =>
  badgesFor(choice({ name: "a", status: "installed", changed })).map((badge) => badge.label);

describe("display helpers", () => {
  test("badges", () => {
    const labels = badgesFor(
      choice({ name: "a", optional: true, status: "new", executables: ["x.sh"] }),
    ).map((badge) => badge.label);

    expect(labels).toEqual(["optional", "new", "⚠ runs code"]);
    expect(
      badgesFor(choice({ name: "b", status: "conflict" })).map((badge) => badge.label),
    ).toEqual(["conflict"]);
  });

  test("an installed skill that changed upstream says changed instead of installed", () => {
    expect(label(true)).toEqual(["changed"]);
    expect(label(false)).toEqual(["installed"]);
  });

  test("origin lines shorten hashes but keep `local`", () => {
    expect(shortCommit("local")).toBe("local");
    expect(originLines({ ...skill({ name: "a" }), path: "" })).toContain("path    .");
  });

  test("notices list warnings, then removals", () => {
    expect(noticeLines(plan([], ["w1"], ["x", "y"]))).toEqual(["w1", "will be removed: x, y"]);
    expect(noticeLines(plan([]))).toEqual([]);
  });
});

describe("rowLook", () => {
  test("ticked, focused and conflict rows", () => {
    const [row] = initialPickerState(plan([{ name: "a" }])).rows;

    const [conflict] = initialPickerState(
      plan([{ name: "b", status: "conflict", note: "clash" }]),
    ).rows;

    if (row === undefined || conflict === undefined) {
      throw new Error("expected rows");
    }

    expect(rowLook(row, true, true)).toEqual({
      box: "[x]",
      nameTone: "accent",
      subtitle: "Does a things.",
      subtitleTone: "muted",
    });
    expect(rowLook(row, false, false).box).toBe("[ ]");
    expect(rowLook(conflict, false, false)).toEqual({
      box: "[-]",
      nameTone: "muted",
      subtitle: "clash",
      subtitleTone: "warn",
    });
  });
});
