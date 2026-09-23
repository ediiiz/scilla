import { afterAll, describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { plant, removeTemps, temp } from "./testing/harness.ts";

afterAll(removeTemps);

const SHIM = fileURLToPath(new URL("../bin/scilla.js", import.meta.url));

const ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const NODE = Bun.which("node");

/** A PATH holding only `node` and, when given, a stand-in `bun` shell script. */
const pathWith = (fakeBun?: string) => {
  const bin = temp("bin");

  if (NODE !== null) {
    symlinkSync(NODE, join(bin, "node"));
  }

  if (fakeBun !== undefined) {
    plant(bin, { "bun!": `#!/bin/sh\n${fakeBun}\n` });
  }

  return bin;
};

/** Run the published bin the way `npx` does: under Node, with piped stdio. */
const runShim = async (path: string, args: readonly string[] = []) => {
  const child = Bun.spawn([NODE ?? "node", SHIM, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: path },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { stdout, stderr, code: child.exitCode, signal: child.signalCode };
};

describe.skipIf(NODE === null)("the Node shim", () => {
  test("hands the bundle and every argument to bun, and passes its exit code back", async () => {
    const result = await runShim(pathWith('echo "$@"; exit 3'), ["add", "a b", "-y"]);

    expect(result).toMatchObject({ code: 3, stdout: `${ENTRY} add a b -y\n`, stderr: "" });
  });

  test("without bun on PATH it says what to install and exits 1", async () => {
    expect(await runShim(pathWith(), ["--version"])).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "scilla: Requires Bun ≥1.4 — https://bun.sh\n",
    });
  });

  test("dies of the same signal as bun", async () => {
    expect(await runShim(pathWith("kill -TERM $$"))).toMatchObject({
      code: null,
      signal: "SIGTERM",
    });
  });
});
