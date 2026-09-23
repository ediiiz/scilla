import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";

const live: TestRendererSetup[] = [];

const scoped = (step: () => void | Promise<void>) =>
  act(async () => {
    await step();
    await Bun.sleep(0);
  });

/** A headless screen: key presses are wrapped in `act` and followed by a render. */
export const mountScreen = async (node: ReactNode, width = 100, height = 30) => {
  // Kitty encoding makes a lone Escape unambiguous, so it needs no parser timeout.
  const setup = await testRender(node, { width, height, kittyKeyboard: true });

  live.push(setup);

  // `act` commits React updates when its scope ends, and tuiparts stores notify their items a tick
  // later, so each input takes a few scoped passes: input, commit, render the committed tree.
  const settle = async (input: () => void | Promise<void>) => {
    await scoped(input);
    await scoped(() => setup.renderOnce());
    await scoped(() => setup.renderOnce());
  };

  await settle(() => undefined);

  // One key per act/render, like a person typing.
  const pressEach = async ([key, ...rest]: readonly string[]): Promise<void> => {
    if (key !== undefined) {
      await settle(() => setup.mockInput.pressKey(key));
      await pressEach(rest);
    }
  };

  // Async work (the preview reads files) finishes in real time; poll a few ms at a time.
  const waitFor = async (text: string, tries = 200): Promise<void> => {
    if (setup.captureCharFrame().includes(text) || tries === 0) {
      return;
    }

    await settle(() => Bun.sleep(5));
    await waitFor(text, tries - 1);
  };

  return {
    frame: () => setup.captureCharFrame(),
    waitFor,
    press: (...keys: readonly string[]) => pressEach(keys),
    type: (text: string) => settle(() => setup.mockInput.typeText(text)),
  };
};

/** Destroy every screen mounted so far; call from `afterEach`. */
export const unmountAll = () => {
  act(() => {
    for (const setup of live.splice(0)) {
      setup.renderer.destroy();
    }
  });
};

/** The latest value a screen reported through its `onDone`. */
interface Reported<T> {
  value: T | "pending";
}

export const reporter = <T>() => {
  const reported: Reported<T> = { value: "pending" };

  return {
    reported,
    done: (value: T) => {
      reported.value = value;
    },
  };
};
