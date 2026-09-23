import { describe, expect, test } from "bun:test";
import {
  pickSkills,
  runHome,
  withProgress,
  type HomeAction,
  type HomeContext,
  type ProgressStream,
} from "./index.ts";
import { lock } from "./test-fixtures.ts";

// The terminal entry points can't run headless; this pins the surface a CLI builds on.
describe("public API", () => {
  test("exports the screens and the progress helper", async () => {
    const lines: string[] = [];
    const stream: ProgressStream = { isTTY: false, write: (chunk) => lines.push(chunk) > 0 };
    const context: HomeContext = { project: lock(), global: lock(), isCollection: false };

    const action: HomeAction = await withProgress(
      "Loading",
      async () => ({ kind: "check" }),
      stream,
    );

    expect(pickSkills).toBeInstanceOf(Function);
    expect(runHome).toBeInstanceOf(Function);
    expect(context.isCollection).toBe(false);
    expect(action).toEqual({ kind: "check" });
    expect(lines).toEqual(["Loading…\n"]);
  });
});
