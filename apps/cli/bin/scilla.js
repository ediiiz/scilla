#!/usr/bin/env node
// The published bin. scilla itself runs on Bun; this file only has to run on Node, so that
// `npx scilla-cli` without Bun explains what is missing instead of failing inside a stack trace.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = new URL("../dist/index.js", import.meta.url);

const missingBun = "scilla: Requires Bun ≥1.4 — https://bun.sh\n";

if (process.versions.bun === undefined) {
  const child = spawn("bun", [fileURLToPath(entry), ...process.argv.slice(2)], {
    stdio: "inherit",
  });

  // Ctrl-C and Ctrl-\ reach the whole foreground process group, so Bun gets them from the terminal;
  // the shim only has to survive them. Signals aimed at the shim alone are passed on.
  const passOn = (signal) => () => child.kill(signal);

  process.on("SIGINT", () => {});
  process.on("SIGQUIT", () => {});
  process.on("SIGTERM", passOn("SIGTERM"));
  process.on("SIGHUP", passOn("SIGHUP"));

  child.on("error", (cause) => {
    process.stderr.write(cause.code === "ENOENT" ? missingBun : `scilla: ${cause.message}\n`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal === null) {
      process.exit(code ?? 1);
    }

    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  });
} else {
  // Already on Bun (bunx, `bun add -g`, or Bun standing in for a missing `node`): no second process.
  await import(entry.href);
}
