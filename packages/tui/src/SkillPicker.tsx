import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { executablesSummary, type AuditReport, type Choice, type Plan } from "@scilla/core";
import type { CheckboxRootRenderable } from "@tuiparts/core/checkbox";
import type { CheckboxGroupRenderable } from "@tuiparts/core/checkbox-group";
import { Checkbox } from "@tuiparts/react/checkbox";
import { CheckboxGroup } from "@tuiparts/react/checkbox-group";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
import { headerStatus, rowBadges } from "./rating-model.ts";
import { RatingLines } from "./RatingLines.tsx";
import { RatingsContext, useAuditRatings, useRatings } from "./ratings.ts";
import { SkillPreview } from "./SkillPreview.tsx";
import { useInitialTabStop } from "./tab-stop.ts";
import { ACCENT, MUTED, toneColor, WARN } from "./theme.ts";

export interface SkillPickerProps {
  readonly plan: Plan;
  /** Security ratings still on their way; rows get badges when they arrive. */
  readonly audit?: Promise<AuditReport> | undefined;
  /** Called once: the chosen skill names, or undefined when the Consumer cancels. */
  readonly onDone: (selection: ReadonlySet<string> | undefined) => void;
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

    if (intent?.kind === "move" && !state.previewing) {
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

/** The picker's own keys; see `pickerKeyOutcome`. */
const usePickerKeys = (
  latest: RefObject<PickerState>,
  dispatch: (action: PickerAction) => void,
  onDone: SkillPickerProps["onDone"],
) => {
  useKeyboard((key) => {
    const outcome = pickerKeyOutcome(latest.current, key.name, key.ctrl);

    if (outcome.kind === "pass") {
      return;
    }

    key.preventDefault();

    if (outcome.kind === "act") {
      dispatch(outcome.action);
    } else {
      onDone(outcome.selection);
    }
  });
};

export function SkillPicker({ plan, audit, onDone, diff }: SkillPickerProps) {
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

  usePickerKeys(latest, dispatch, onDone);

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
        <text fg={state.hint === undefined ? MUTED : WARN} flexShrink={0} wrapMode="none" truncate>
          {state.hint ?? (diffable ? DIFF_KEY_HELP : KEY_HELP)}
        </text>
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
