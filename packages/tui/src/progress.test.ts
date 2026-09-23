import { describe, expect, test } from "bun:test";
import { withProgress, type ProgressStream } from "./progress.ts";

const recorder = (isTTY: boolean) => {
  const chunks: string[] = [];

  const stream: ProgressStream = {
    isTTY,
    write: (chunk) => {
      chunks.push(chunk);

      return true;
    },
  };

  return { chunks, stream };
};

describe("withProgress", () => {
  test("writes one line when not a TTY and returns the task's value", async () => {
    const { chunks, stream } = recorder(false);

    expect(await withProgress("Fetching", async () => 42, stream)).toBe(42);
    expect(chunks).toEqual(["Fetching…\n"]);
  });

  test("animates a spinner on a TTY and clears it afterwards", async () => {
    const { chunks, stream } = recorder(true);

    await withProgress("Fetching", () => Bun.sleep(200), stream);

    const frames = chunks.filter((chunk) => chunk.includes("Fetching"));

    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]).toContain("⠋ Fetching");
    expect(chunks.at(-1)).toBe("\r\u001B[2K\u001B[?25h");
  });

  test("clears the spinner when the task fails", async () => {
    const { chunks, stream } = recorder(true);

    const failing = withProgress("Fetching", () => Promise.reject(new Error("offline")), stream);

    await expect(failing).rejects.toThrow("offline");
    expect(chunks.at(-1)).toBe("\r\u001B[2K\u001B[?25h");
  });
});
