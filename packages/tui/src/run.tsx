// fallow-ignore-file coverage-gaps -- these wrappers need a real terminal (createCliRenderer); the screens they mount are tested headlessly.
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { AuditReport, Choice, Plan } from "@scilla/core";
import type { ReactNode } from "react";
import type { AskLinks, PickResult } from "./confirm-model.ts";
import type { HomeAction, HomeContext } from "./home-model.ts";
import { HomeScreen } from "./HomeScreen.tsx";
import { SkillPicker } from "./SkillPicker.tsx";

/** Mount a full-screen view until it reports a result, then always restore the terminal. */
const runScreen = async <T,>(view: (done: (result: T) => void) => ReactNode): Promise<T> => {
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);

  try {
    return await new Promise<T>((resolve) => {
      root.render(view(resolve));
    });
  } finally {
    root.unmount();
    renderer.destroy();
  }
};

export interface PickOptions {
  /** Security ratings still being fetched; the rows get badges as soon as they arrive. */
  readonly audit?: Promise<AuditReport> | undefined;
  /** Loads a changed skill's changes since the lock (a unified diff), shown with `d`. */
  readonly diff?: ((choice: Choice) => Promise<string>) | undefined;
  /** Agents whose folder doesn't exist yet, to ask about linking the skills into after Enter. */
  readonly askLinks?: AskLinks;
}

/**
 * Let the Consumer choose skills from a plan, confirming risky ratings and answering `askLinks` in
 * the picker; resolves with what they chose, or undefined on cancel.
 */
export const pickSkills = (plan: Plan, { audit, diff, askLinks }: PickOptions = {}) =>
  runScreen<PickResult | undefined>((done) => (
    <SkillPicker plan={plan} audit={audit} diff={diff} askLinks={askLinks} onDone={done} />
  ));

/** The bare `scilla` home screen; resolves with what to do next, or undefined on Quit. */
export const runHome = (context: HomeContext) =>
  runScreen<HomeAction | undefined>((done) => <HomeScreen context={context} onDone={done} />);
