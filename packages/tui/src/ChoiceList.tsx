import { useKeyboard } from "@opentui/react";
import type { RadioRootRenderable } from "@tuiparts/core/radio";
import type { RadioGroupRenderable } from "@tuiparts/core/radio-group";
import { Radio } from "@tuiparts/react/radio";
import { RadioGroup } from "@tuiparts/react/radio-group";
import { useRef, useState } from "react";
import { choiceKey } from "./home-model.ts";
import { useInitialTabStop } from "./tab-stop.ts";
import { ACCENT, MUTED, TEXT } from "./theme.ts";

export interface ChoiceOption {
  readonly label: string;
  readonly detail: string;
}

export interface ChoiceListProps {
  readonly options: readonly ChoiceOption[];
  readonly onChoose: (index: number) => void;
}

/** A single-choice list on a tuiparts RadioGroup: arrows and Home/End move, j/k too, Enter chooses. */
export function ChoiceList({ options, onChoose }: ChoiceListProps) {
  const [cursor, setCursor] = useState(0);
  const group = useRef<RadioGroupRenderable>(null);
  const [roots] = useState(() => new Map<number, RadioRootRenderable>());

  useInitialTabStop(group);

  // Runs before the focused Radio sees the key, so Enter chooses and j/k join the arrows.
  useKeyboard((key) => {
    const intent = choiceKey(key.name, cursor, options.length);

    if (intent === undefined) {
      return;
    }

    key.preventDefault();

    if (intent.kind === "choose") {
      onChoose(cursor);
    } else {
      setCursor(intent.index);
      roots.get(intent.index)?.focus();
    }
  });

  return (
    <RadioGroup
      ref={group}
      value={String(cursor)}
      onValueChange={(value) => setCursor(Number(value))}
      flexDirection="column"
    >
      {options.map((option, index) => (
        <Radio.Root
          key={option.label}
          value={String(index)}
          ref={(root) => {
            if (root === null) {
              roots.delete(index);
            } else {
              roots.set(index, root);
            }
          }}
        >
          {(radio) => (
            <text wrapMode="none" truncate>
              <span fg={ACCENT}>{radio.checked ? "› " : "  "}</span>
              <span fg={radio.checked ? ACCENT : TEXT}>{option.label}</span>
              <span fg={MUTED}>{option.detail === "" ? "" : `  ${option.detail}`}</span>
            </text>
          )}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
