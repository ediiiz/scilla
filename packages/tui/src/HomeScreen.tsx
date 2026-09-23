import { useKeyboard } from "@opentui/react";
import type { InputRenderable } from "@tuiparts/core/input";
import { Input } from "@tuiparts/react/input";
import { useEffect, useRef, useState } from "react";
import { ChoiceList } from "./ChoiceList.tsx";
import {
  answerPrompt,
  chooseItem,
  installedCollections,
  menuItems,
  pickCollection,
  type HomeAction,
  type HomeContext,
  type HomeStep,
  type HomeTransition,
  type InstalledCollection,
  type PickPurpose,
  type PromptSpec,
} from "./home-model.ts";
import { ACCENT, MUTED } from "./theme.ts";

export interface HomeScreenProps {
  readonly context: HomeContext;
  /** Called once: the chosen action, or undefined on Quit or cancel. */
  readonly onDone: (action: HomeAction | undefined) => void;
}

interface InstalledPaneProps {
  readonly collections: readonly InstalledCollection[];
}

// tuiparts has no list or panel primitive for read-only rows; the installed list is plain OpenTUI.
function InstalledPane({ collections }: InstalledPaneProps) {
  const scopes = [
    { title: "Project", global: false },
    { title: "Global", global: true },
  ];

  return (
    <box
      border
      borderColor={MUTED}
      title=" Installed "
      flexDirection="column"
      paddingX={1}
      flexShrink={0}
    >
      {scopes.map((scope) => {
        const listed = collections.filter((collection) => collection.global === scope.global);

        return (
          <box key={scope.title} flexDirection="column">
            <text fg={ACCENT}>
              <b>{scope.title}</b>
            </text>
            {listed.length === 0 ? (
              <text fg={MUTED}>{"  none"}</text>
            ) : (
              listed.map((collection) => (
                <text key={collection.key} wrapMode="none" truncate>
                  {`  ${collection.name}`}
                  <span fg={MUTED}>{`  ${collection.skills} skills · ${collection.key}`}</span>
                </text>
              ))
            )}
          </box>
        );
      })}
    </box>
  );
}

interface PromptViewProps {
  readonly spec: PromptSpec | undefined;
  readonly onSubmit: (value: string) => void;
}

function PromptView({ spec, onSubmit }: PromptViewProps) {
  const input = useRef<InputRenderable>(null);

  // OpenTUI has no automatic focus traversal, so take focus on mount.
  useEffect(() => {
    input.current?.focus();
  }, []);

  // The frame is a plain OpenTUI box: tuiparts has no field or label primitive.
  return (
    <box border borderColor={ACCENT} title={` ${spec?.label ?? ""} `} height={3} flexShrink={0}>
      <Input ref={input} placeholder={spec?.placeholder ?? ""} onSubmit={onSubmit} />
    </box>
  );
}

interface PickViewProps {
  readonly purpose: PickPurpose;
  readonly collections: readonly InstalledCollection[];
  readonly onPick: (collection: InstalledCollection) => void;
}

function PickView({ purpose, collections, onPick }: PickViewProps) {
  return (
    <box flexDirection="column">
      <text marginBottom={1}>
        {purpose === "update" ? "Update which Collection?" : "Remove which Collection?"}
      </text>
      <ChoiceList
        options={collections.map((collection) => ({
          label: collection.name,
          detail: `${collection.global ? "global" : "project"} · ${collection.key}`,
        }))}
        onChoose={(index) => {
          const collection = collections[index];

          if (collection !== undefined) {
            onPick(collection);
          }
        }}
      />
    </box>
  );
}

const HELP: ReadonlyMap<HomeStep["kind"], string> = new Map([
  ["menu", "↑↓/jk move · enter choose · esc quit"],
  ["pick", "↑↓/jk move · enter choose · esc back"],
  ["prompt", "enter submit · esc back"],
]);

const MENU_STEP: HomeStep = { kind: "menu" };

const CANCEL: HomeTransition = { kind: "done", action: undefined };

/** Esc or q steps back to the menu, or leaves from the menu; ctrl+c always leaves. q types in a prompt. */
const leaveTransition = (
  step: HomeStep,
  name: string,
  ctrl: boolean,
): HomeTransition | undefined => {
  if (ctrl && name === "c") {
    return CANCEL;
  }

  if (name !== "escape" && (name !== "q" || step.kind === "prompt")) {
    return undefined;
  }

  return step.kind === "menu" ? CANCEL : { kind: "step", step: MENU_STEP };
};

export function HomeScreen({ context, onDone }: HomeScreenProps) {
  const [step, setStep] = useState<HomeStep>(MENU_STEP);
  const collections = installedCollections(context);
  const items = menuItems(context);

  const apply = (transition: HomeTransition) => {
    if (transition.kind === "done") {
      onDone(transition.action);
    } else {
      setStep(transition.step);
    }
  };

  useKeyboard((key) => {
    const transition = leaveTransition(step, key.name, key.ctrl);

    if (transition !== undefined) {
      apply(transition);
    }
  });

  // tuiparts has no layout or text primitives; the frame, header and key help are plain OpenTUI.
  return (
    <box flexDirection="column" width="100%" height="100%" paddingX={1}>
      <text fg={ACCENT} flexShrink={0}>
        <b>scilla</b>
        <span fg={MUTED}>
          {context.isCollection
            ? `  curating ${context.collectionName ?? "this Collection"}`
            : "  agent skills from Collections"}
        </span>
      </text>
      <InstalledPane collections={collections} />
      <box flexDirection="column" flexGrow={1} marginTop={1}>
        {step.kind === "menu" ? (
          <ChoiceList
            options={items.map((item) => ({ label: item.label, detail: item.description }))}
            onChoose={(index) => {
              const item = items[index];

              if (item !== undefined) {
                apply(chooseItem(item));
              }
            }}
          />
        ) : null}
        {step.kind === "pick" ? (
          <PickView
            purpose={step.purpose}
            collections={collections}
            onPick={(collection) => onDone(pickCollection(step.purpose, collection))}
          />
        ) : null}
        {step.kind === "prompt" ? (
          <PromptView
            key={step.answers.length}
            spec={step.effect.prompts[step.answers.length]}
            onSubmit={(value) => apply(answerPrompt(step, value))}
          />
        ) : null}
      </box>
      <text fg={MUTED} flexShrink={0}>
        {HELP.get(step.kind)}
      </text>
    </box>
  );
}
