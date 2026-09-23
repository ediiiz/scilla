import type { Choice, Plan, ResolvedSkill } from "@scilla/core";

/** Group label for the root Collection's Own Skills (an empty `via`). */
const OWN_SKILLS = "Own Skills";

export interface PickerRow {
  readonly choice: Choice;
  /** Reference labels below the group's, shown dimmed on the row. */
  readonly trail: readonly string[];
  /** Conflict rows can be focused (to read the note) but never ticked. */
  readonly selectable: boolean;
}

export interface PickerGroup {
  readonly label: string;
  readonly rows: readonly PickerRow[];
}

export interface PickerState {
  readonly groups: readonly PickerGroup[];
  /** Every row in display order; `focus` indexes into it. */
  readonly rows: readonly PickerRow[];
  readonly focus: number;
  readonly selected: ReadonlySet<string>;
  /** A one-line hint after Space on a row that can't be ticked; cleared by the next action. */
  readonly hint: string | undefined;
  /** Whether the focused row's full-screen preview is open; focus and ticks stay as they are. */
  readonly previewing: boolean;
  /** The preview opened on the skill's changes since the lock (`d`) rather than its SKILL.md. */
  readonly diffing: boolean;
}

/**
 * What the picker does with a change. Roving focus (arrows, Home/End) and Space toggling belong to
 * the tuiparts CheckboxGroup, which reports back through `focus` and `select`; `refuse` is Space on
 * a row that can't be ticked, which the picker keeps from the CheckboxGroup.
 */
export type PickerAction =
  | { readonly kind: "focus"; readonly index: number }
  | { readonly kind: "select"; readonly names: readonly string[] }
  | { readonly kind: "toggle-all" }
  | { readonly kind: "refuse" }
  | { readonly kind: "preview"; readonly open: boolean; readonly diff?: boolean };

export type MoveTarget = "next" | "previous" | "first" | "last";

/** Keys the picker handles itself, on top of the CheckboxGroup's own. */
export type PickerIntent =
  | { readonly kind: "move"; readonly target: MoveTarget }
  | { readonly kind: "toggle-all" }
  | { readonly kind: "preview"; readonly open: true; readonly diff?: boolean }
  | { readonly kind: "confirm" }
  | { readonly kind: "cancel" };

/** `good` and `danger` colour security ratings; see `rating-model.ts`. */
export type Tone = "accent" | "muted" | "warn" | "good" | "danger";

export interface Badge {
  readonly label: string;
  readonly tone: Tone;
}

/** Group choices by the first Reference they came through; Own Skills first, the rest in Traversal order. */
export const groupChoices = (choices: readonly Choice[]): PickerGroup[] => {
  const groups = new Map<string, PickerRow[]>([[OWN_SKILLS, []]]);

  for (const choice of choices) {
    const [head, ...trail] = choice.skill.via;
    const label = head ?? OWN_SKILLS;
    const row: PickerRow = { choice, trail, selectable: choice.status !== "conflict" };
    const rows = groups.get(label);

    if (rows === undefined) {
      groups.set(label, [row]);
    } else {
      rows.push(row);
    }
  }

  return [...groups].flatMap(([label, rows]) => (rows.length === 0 ? [] : [{ label, rows }]));
};

export const initialPickerState = (plan: Plan): PickerState => {
  const groups = groupChoices(plan.choices);
  const rows = groups.flatMap((group) => group.rows);
  const selected = new Set<string>();

  for (const row of rows) {
    if (row.selectable && row.choice.selected) {
      selected.add(row.choice.skill.name);
    }
  }

  // The CheckboxGroup's tab stop starts on the first row, conflict or not.
  return { groups, rows, focus: 0, selected, hint: undefined, previewing: false, diffing: false };
};

const selectableNames = (state: PickerState) =>
  state.rows.flatMap((row) => (row.selectable ? [row.choice.skill.name] : []));

/** Tick every selectable row, or clear them all when they're all ticked already. */
const toggleAll = (state: PickerState): PickerState => {
  const names = selectableNames(state);
  const allTicked = names.every((name) => state.selected.has(name));

  return { ...state, selected: new Set(allTicked ? [] : names), hint: undefined };
};

/** Whether the focused row is one Space must not tick. */
export const focusedUntickable = (state: PickerState) =>
  state.rows[state.focus]?.selectable === false;

/** Why a conflict row can't be ticked: its note, or the usual reason. */
export const clashNote = (choice: Choice) =>
  choice.note ?? "a skill with this name is already installed";

const refusal = (row: PickerRow) => `can't select: ${clashNote(row.choice)}`;

const NO_CHANGES = "no changes since the lock to show";

/** Open or close the preview; `d` opens it on the changes, only for a skill that has some. */
const preview = (state: PickerState, open: boolean, diff: boolean): PickerState => {
  if (state.rows.length === 0) {
    return state;
  }

  if (open && diff && state.rows[state.focus]?.choice.changed !== true) {
    return { ...state, hint: NO_CHANGES };
  }

  return { ...state, previewing: open, diffing: open && diff, hint: undefined };
};

export const reducePicker = (state: PickerState, action: PickerAction): PickerState => {
  switch (action.kind) {
    case "focus": {
      return action.index >= 0 && action.index < state.rows.length
        ? { ...state, focus: action.index, hint: undefined }
        : state;
    }

    case "select": {
      const allowed = new Set(selectableNames(state));

      return {
        ...state,
        selected: new Set(action.names.values().filter((name) => allowed.has(name))),
        hint: undefined,
      };
    }

    case "refuse": {
      const row = state.rows[state.focus];

      return row === undefined || row.selectable ? state : { ...state, hint: refusal(row) };
    }

    case "preview": {
      return preview(state, action.open, action.diff === true);
    }

    default: {
      return toggleAll(state);
    }
  }
};

const clampRow = (state: PickerState, index: number) =>
  state.rows[Math.min(Math.max(index, 0), state.rows.length - 1)];

/** The row a move lands on, conflicts included; it stays put at either end. */
export const moveTarget = (state: PickerState, target: MoveTarget): PickerRow | undefined => {
  switch (target) {
    case "next": {
      return clampRow(state, state.focus + 1);
    }

    case "previous": {
      return clampRow(state, state.focus - 1);
    }

    case "first": {
      return state.rows[0];
    }

    default: {
      return state.rows.at(-1);
    }
  }
};

const PREVIEW_KEYS = new Set(["p", "right", "l"]);

const MOVE_KEYS: ReadonlyMap<string, MoveTarget> = new Map([
  ["j", "next"],
  ["k", "previous"],
  ["home", "first"],
  ["end", "last"],
]);

/**
 * Map a key press to what the picker does itself; undefined leaves it to the CheckboxGroup (arrows,
 * Space). Home/End share j/k's path so every move focuses its row the same way.
 */
export const pickerIntent = (name: string, ctrl: boolean): PickerIntent | undefined => {
  const target = MOVE_KEYS.get(name);

  if (target !== undefined) {
    return { kind: "move", target };
  }

  if (name === "a") {
    return { kind: "toggle-all" };
  }

  if (PREVIEW_KEYS.has(name)) {
    return { kind: "preview", open: true };
  }

  if (name === "d") {
    return { kind: "preview", open: true, diff: true };
  }

  if (name === "return" || name === "enter") {
    return { kind: "confirm" };
  }

  return name === "escape" || name === "q" || (ctrl && name === "c")
    ? { kind: "cancel" }
    : undefined;
};

/** What a key press does to the picker as a whole. */
export type PickerKeyOutcome =
  | { readonly kind: "pass" }
  | { readonly kind: "act"; readonly action: PickerAction }
  | { readonly kind: "finish"; readonly selection: ReadonlySet<string> | undefined };

const PASS: PickerKeyOutcome = { kind: "pass" };

/**
 * Decide a key press before the focused Checkbox sees it: Enter confirms instead of toggling, and
 * Space on a conflict row explains itself instead of ticking it. While the preview is open it owns
 * every key except Ctrl+C, which still cancels the picker. `pass` leaves the key to others.
 */
export const pickerKeyOutcome = (
  state: PickerState,
  name: string,
  ctrl: boolean,
): PickerKeyOutcome => {
  const intent = pickerIntent(name, ctrl);

  if (state.previewing) {
    return ctrl && intent?.kind === "cancel" ? { kind: "finish", selection: undefined } : PASS;
  }

  if (name === "space" && focusedUntickable(state)) {
    return { kind: "act", action: { kind: "refuse" } };
  }

  if (intent === undefined || intent.kind === "move") {
    return PASS;
  }

  if (intent.kind === "toggle-all" || intent.kind === "preview") {
    return { kind: "act", action: intent };
  }

  return { kind: "finish", selection: intent.kind === "confirm" ? state.selected : undefined };
};

export const selectionSummary = (state: PickerState) =>
  `${state.selected.size}/${selectableNames(state).length} selected`;

export const badgesFor = (choice: Choice): Badge[] => {
  const badges: Badge[] = [];

  if (choice.skill.optional) {
    badges.push({ label: "optional", tone: "muted" });
  }

  if (choice.status === "new") {
    badges.push({ label: "new", tone: "accent" });
  }

  if (choice.status === "installed") {
    badges.push(
      choice.changed === true
        ? { label: "changed", tone: "accent" }
        : { label: "installed", tone: "muted" },
    );
  }

  if (choice.skill.executables.length > 0) {
    badges.push({ label: "⚠ runs code", tone: "warn" });
  }

  if (choice.status === "conflict") {
    badges.push({ label: "conflict", tone: "warn" });
  }

  return badges;
};

/** A commit shortened for display; non-hash commits such as `local` stay as they are. */
export const shortCommit = (commit: string) =>
  /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 7) : commit;

/** A skill's description, or a placeholder when its SKILL.md has none. */
export const descriptionText = (skill: ResolvedSkill) =>
  skill.description === "" ? "(no description)" : skill.description;

/** Origin lines for the detail pane (Trust: repo, path, short commit). */
export const originLines = (skill: ResolvedSkill) => [
  `url     ${skill.url}`,
  `path    ${skill.path === "" ? "." : skill.path}`,
  `commit  ${shortCommit(skill.commit)}`,
];

/** Lines for the notices pane: Traversal warnings, then skills about to be removed. */
export const noticeLines = (plan: Plan) =>
  plan.removed.length === 0
    ? [...plan.traversal.warnings]
    : [...plan.traversal.warnings, `will be removed: ${plan.removed.join(", ")}`];

export interface RowLook {
  /** `[x]`, `[ ]`, or `[-]` for a row that can't be ticked. */
  readonly box: string;
  readonly nameTone: Tone | "text";
  /** The one-line description, or a conflict's note. */
  readonly subtitle: string;
  readonly subtitleTone: Tone;
}

const tickBox = (row: PickerRow, ticked: boolean) => {
  if (!row.selectable) {
    return "[-]";
  }

  return ticked ? "[x]" : "[ ]";
};

/** How a row reads: its checkbox, name colour and second line. */
export const rowLook = (row: PickerRow, focused: boolean, ticked: boolean): RowLook => {
  const { skill, status, note } = row.choice;
  const conflict = status === "conflict";
  const idleTone = row.selectable ? "text" : "muted";

  return {
    box: tickBox(row, ticked),
    nameTone: focused ? "accent" : idleTone,
    subtitle: conflict && note !== undefined ? note : skill.description,
    subtitleTone: conflict ? "warn" : "muted",
  };
};
