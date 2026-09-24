import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import {
  executablesSummary,
  type Agent,
  type AuditReport,
  type Choice,
  type Plan,
} from "@scilla/core";
import type { CheckboxRootRenderable } from "@tuiparts/core/checkbox";
import type { CheckboxGroupRenderable } from "@tuiparts/core/checkbox-group";
import { Checkbox } from "@tuiparts/react/checkbox";
import { CheckboxGroup } from "@tuiparts/react/checkbox-group";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  afterRisk,
  dialogKey,
  dialogView,
  firstDialog,
  linkAnswers,
  riskyPicks,
  type AskLinks,
  type DialogKey,
  type PickResult,
} from "./confirm-model.ts";
import {
  descriptionText,
  initialPickerState,
  moveTarget,
  noticeLines,
  originLines,
  pickerIntent,
  pickerKeyOutcome,
  reducePicker,
  rowLook,
  type PickerAction,
  type PickerRow,
  type PickerState,
} from "./picker-model.ts";
import { headerStatus, rowBadges, type Ratings } from "./rating-model.ts";
import { RatingLines } from "./RatingLines.tsx";
import { RatingsContext, useAuditRatings, useRatings } from "./ratings.ts";
import { SkillPreview } from "./SkillPreview.tsx";
import { useInitialTabStop } from "./tab-stop.ts";
import { ACCENT, MUTED, toneColor, WARN } from "./theme.ts";

export interface SkillPickerProps {
  readonly plan: Plan;
  /** Security ratings still on their way; rows get badges when they arrive. */
  readonly audit?: Promise<AuditReport> | undefined;
  /** Called once: what the Consumer chose, or undefined when they cancel. */
  readonly onDone: (result: PickResult | undefined) => void;
  /** Agents whose folder doesn't exist yet, to ask about linking the skills into after Enter. */
  readonly askLinks?: AskLinks;
  /** Loads a changed skill's changes since the lock (a unified diff), for `d`. */
  readonly diff?: ((choice: Choice) => Promise<string>) | undefined;
}

const rowId = (name: string) => `skill-row-${name}`;

interface SkillRowProps {
  readonly row: PickerRow;
  readonly roots: Map<string, CheckboxRootRenderable>;
}

function SkillRow({ row, roots }: SkillRowProps) {
  const { name } = row.choice.skill;
  const badges = rowBadges(row.choice, useRatings());

  return (
    <Checkbox.Root
      id={rowId(name)}
      value={name}
      flexDirection="column"
      flexShrink={0}
      ref={(root) => {
        if (root === null) {
          roots.delete(name);
        } else {
          roots.set(name, root);
        }
      }}
    >
      {(checkbox) => {
        const look = rowLook(row, checkbox.focused, checkbox.checked);

        return (
          <>
            <text wrapMode="none" truncate>
              <span fg={ACCENT}>{checkbox.focused ? "› " : "  "}</span>
              <span fg={toneColor(look.nameTone)}>{`${look.box} ${name}`}</span>
              {badges.map((badge) => (
                <span key={badge.label} fg={toneColor(badge.tone)}>{` ${badge.label}`}</span>
              ))}
              <span fg={MUTED}>{row.trail.length === 0 ? "" : `  ‹ ${row.trail.join(" › ")}`}</span>
            </text>
            <text wrapMode="none" truncate fg={toneColor(look.subtitleTone)}>
              {`      ${look.subtitle}`}
            </text>
          </>
        );
      }}
    </Checkbox.Root>
  );
}

interface SkillListProps {
  readonly state: PickerState;
  readonly dispatch: (action: PickerAction) => void;
}

function SkillList({ state, dispatch }: SkillListProps) {
  const scroll = useRef<ScrollBoxRenderable>(null);
  const group = useRef<CheckboxGroupRenderable>(null);
  // One stable registry of the rows' Checkbox renderables, for focusing them from j/k and Home/End.
  const [roots] = useState(() => new Map<string, CheckboxRootRenderable>());
  const focusedName = state.rows[state.focus]?.choice.skill.name;

  useInitialTabStop(group);

  // Follow the CheckboxGroup's roving focus so the detail pane and scrolling track it.
  useEffect(() => {
    const unsubscribes = state.rows.map((row, index) =>
      roots.get(row.choice.skill.name)?.store.subscribe((checkbox) => {
        if (checkbox.focused) {
          dispatch({ kind: "focus", index });
        }
      }),
    );

    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe?.();
      }
    };
  }, [roots, state.rows, dispatch]);

  // The CheckboxGroup moves focus with the arrows; j/k and Home/End focus their row the same way.
  useKeyboard((key) => {
    const intent = pickerIntent(key.name, key.ctrl);

    if (intent?.kind === "move" && !state.previewing && state.dialog === undefined) {
      key.preventDefault();
      roots.get(moveTarget(state, intent.target)?.choice.skill.name ?? "")?.focus();
    }
  });

  // tuiparts has no scrolling container, and an OpenTUI scrollbox doesn't follow focus on its own.
  useEffect(() => {
    if (focusedName !== undefined) {
      scroll.current?.scrollChildIntoView(rowId(focusedName));
    }
  }, [focusedName]);

  return (
    <scrollbox ref={scroll} flexGrow={1} flexBasis={0}>
      <CheckboxGroup
        ref={group}
        value={[...state.selected]}
        onValueChange={(names) => dispatch({ kind: "select", names })}
        loopFocus={false}
        flexDirection="column"
      >
        {state.groups.map((section) => (
          <box key={section.label} flexDirection="column" flexShrink={0} marginBottom={1}>
            <text fg={ACCENT} wrapMode="none" truncate>
              <b>{section.label}</b>
            </text>
            {section.rows.map((row) => (
              <SkillRow key={row.choice.skill.name} row={row} roots={roots} />
            ))}
          </box>
        ))}
      </CheckboxGroup>
    </scrollbox>
  );
}

interface DetailPaneProps {
  readonly row: PickerRow | undefined;
}

// tuiparts has no panel or text primitives; the detail pane is plain OpenTUI layout.
function DetailPane({ row }: DetailPaneProps) {
  if (row === undefined) {
    return <box border borderColor={MUTED} width="40%" />;
  }

  const { skill, note } = row.choice;

  return (
    <box
      border
      borderColor={MUTED}
      title={` ${skill.name} `}
      width="40%"
      flexDirection="column"
      paddingX={1}
    >
      {originLines(skill).map((line) => (
        <text key={line} fg={MUTED} wrapMode="char">
          {line}
        </text>
      ))}
      <RatingLines name={skill.name} />
      {note === undefined ? null : (
        <text marginTop={1} fg={WARN}>
          {note}
        </text>
      )}
      <text marginTop={1}>{descriptionText(skill)}</text>
      {skill.executables.length === 0 ? null : (
        <box flexDirection="column" marginTop={1}>
          <text fg={WARN}>⚠ contains files that can run code:</text>
          {executablesSummary(skill.executables).map((line) => (
            <text key={line} fg={WARN} wrapMode="char">{`  ${line}`}</text>
          ))}
        </box>
      )}
    </box>
  );
}

const KEY_HELP = "↑↓/jk move · space toggle · a all · p preview · enter confirm · esc cancel";

const DIFF_KEY_HELP =
  "↑↓/jk move · space toggle · a all · p preview · d changes · enter confirm · esc cancel";

interface Flow {
  readonly latest: RefObject<PickerState>;
  readonly ratings: Ratings;
  readonly askLinks: AskLinks;
  readonly dispatch: (action: PickerAction) => void;
  readonly onDone: SkillPickerProps["onDone"];
}

/** Open `dialog`, or finish with the ticked skills when there's none left to ask. */
const advance = ({ latest, dispatch, onDone }: Flow, dialog: PickerState["dialog"]) => {
  if (dialog === undefined) {
    onDone({ selected: latest.current.selected });
  } else {
    dispatch({ kind: "dialog", dialog });
  }
};

/** Move, tick or answer in the link dialog's checklist of agents. */
const answerLinks = (flow: Flow, agents: readonly Agent[], answer: DialogKey) => {
  const { latest, dispatch, onDone } = flow;
  const { selected, linkFocus, linkUnticked } = latest.current;
  const focused = agents[linkFocus];

  if (answer === "up" || answer === "down") {
    const index = linkFocus + (answer === "down" ? 1 : -1);

    dispatch({ kind: "link-focus", index: Math.min(Math.max(index, 0), agents.length - 1) });
  } else if (answer === "toggle" && focused !== undefined) {
    dispatch({ kind: "link-toggle", folder: focused.folder });
  } else if (answer === "accept" || answer === "decline") {
    onDone({ selected, agentLinks: linkAnswers(agents, linkUnticked, answer === "decline") });
  }
};

/** Answer the open dialog; see `dialogKey`. */
const answerDialog = (flow: Flow, name: string, ctrl: boolean) => {
  const { latest, askLinks, dispatch, onDone } = flow;
  const { dialog } = latest.current;

  if (dialog === undefined) {
    return;
  }

  const answer = dialogKey(dialog, name, ctrl);

  if (answer === "cancel") {
    onDone(undefined);
  } else if (answer === "back") {
    dispatch({ kind: "dialog", dialog: undefined });
  } else if (dialog === "risk" && answer === "accept") {
    advance(flow, afterRisk(askLinks));
  } else if (dialog === "link" && askLinks !== undefined) {
    answerLinks(flow, askLinks, answer);
  }
};

/** The picker's own keys; see `pickerKeyOutcome`. Enter asks what `firstDialog` says first. */
const usePickerKeys = (flow: Flow) => {
  useKeyboard((key) => {
    const { latest, ratings, askLinks, dispatch, onDone } = flow;
    const outcome = pickerKeyOutcome(latest.current, key.name, key.ctrl);

    if (outcome.kind === "pass") {
      return;
    }

    key.preventDefault();

    switch (outcome.kind) {
      case "act": {
        dispatch(outcome.action);
        break;
      }

      case "confirm": {
        advance(flow, firstDialog(ratings, latest.current.selected, askLinks));
        break;
      }

      case "dialog": {
        answerDialog(flow, key.name, key.ctrl);
        break;
      }

      default: {
        onDone(undefined);
      }
    }
  });
};

/** A risk dialog opened before the ratings arrived moves on by itself when none is risky. */
const useSettledRisk = (flow: Flow, state: PickerState) => {
  const { ratings, askLinks } = flow;
  const settled = state.dialog === "risk" && ratings !== "pending";
  const clear = settled && riskyPicks(ratings, state.selected).length === 0;

  useEffect(() => {
    if (clear) {
      advance(flow, afterRisk(askLinks));
    }
    // `flow` is rebuilt every render; only a change in what's settled should move on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clear]);
};

interface DialogPanelProps {
  readonly state: PickerState;
  readonly ratings: Ratings;
  readonly askLinks: AskLinks;
}

// tuiparts has no dialog; this is a plain OpenTUI panel over the key help, the list still visible.
function DialogPanel({ state, ratings, askLinks }: DialogPanelProps) {
  if (state.dialog === undefined) {
    return null;
  }

  const view = dialogView(state, ratings, askLinks);

  return (
    <box
      border
      borderColor={ACCENT}
      title={view.title}
      flexDirection="column"
      flexShrink={0}
      paddingX={1}
    >
      {view.lines.map((line) => (
        <text key={line.text} fg={toneColor(line.tone)}>
          {line.text}
        </text>
      ))}
      <text fg={ACCENT} marginTop={1}>
        {view.keys}
      </text>
    </box>
  );
}

interface FooterProps extends DialogPanelProps {
  readonly diffable: boolean;
}

/** The open dialog, else the key help (or the hint that replaces it for one key). */
function Footer({ state, ratings, askLinks, diffable }: FooterProps) {
  if (state.dialog !== undefined) {
    return <DialogPanel state={state} ratings={ratings} askLinks={askLinks} />;
  }

  return (
    <text fg={state.hint === undefined ? MUTED : WARN} flexShrink={0} wrapMode="none" truncate>
      {state.hint ?? (diffable ? DIFF_KEY_HELP : KEY_HELP)}
    </text>
  );
}

export function SkillPicker({ plan, audit, onDone, diff, askLinks }: SkillPickerProps) {
  const [state, setState] = useState(() => initialPickerState(plan));
  const ratings = useAuditRatings(audit);
  // Keys can arrive faster than React renders; confirm must see every toggle before it.
  const latest = useRef(state);
  const notices = noticeLines(plan);
  const focused = state.rows[state.focus];
  const focusedChoice = focused?.choice;
  const diffable = diff !== undefined && plan.choices.some((choice) => choice.changed === true);

  // One loader per focused skill, so the preview loads its changes once.
  const loadDiff = useMemo(
    () =>
      diff === undefined || focusedChoice?.changed !== true ? undefined : () => diff(focusedChoice),
    [diff, focusedChoice],
  );

  const dispatch = useCallback((action: PickerAction) => {
    latest.current = reducePicker(latest.current, action);
    setState(latest.current);
  }, []);

  const flow: Flow = { latest, ratings, askLinks, dispatch, onDone };

  usePickerKeys(flow);
  useSettledRisk(flow, state);

  // tuiparts has no layout or text primitives; the frame, header and key help are plain OpenTUI.
  // The list stays mounted but hidden under the preview, so its Checkbox focus and ticks survive.
  return (
    <RatingsContext value={ratings}>
      <box
        visible={!state.previewing}
        flexDirection="column"
        width="100%"
        height="100%"
        paddingX={1}
      >
        <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
          <text fg={ACCENT}>
            <b>{plan.traversal.name}</b>
          </text>
          <text fg={MUTED}>{headerStatus(state, ratings)}</text>
        </box>
        <text fg={MUTED} flexShrink={0} marginBottom={1}>
          {plan.traversal.description}
        </text>
        <box flexDirection="row" flexGrow={1} gap={1}>
          <SkillList state={state} dispatch={dispatch} />
          <DetailPane row={focused} />
        </box>
        {notices.length === 0 ? null : (
          <box
            border
            borderColor={WARN}
            title=" Warnings "
            flexDirection="column"
            flexShrink={0}
            paddingX={1}
          >
            {notices.map((line) => (
              <text key={line} fg={WARN}>
                {line}
              </text>
            ))}
          </box>
        )}
        <Footer state={state} ratings={ratings} askLinks={askLinks} diffable={diffable} />
      </box>
      {state.previewing && focused !== undefined ? (
        <SkillPreview
          choice={focused.choice}
          loadDiff={loadDiff}
          showDiff={state.diffing}
          onClose={() => dispatch({ kind: "preview", open: false })}
        />
      ) : null}
    </RatingsContext>
  );
}
