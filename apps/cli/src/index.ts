#!/usr/bin/env bun
// fallow-ignore-file coverage-gaps -- bin entry, exercised by the CLI e2e tests
import { homedir } from "node:os";
import { envValue } from "@scilla/core";
import { pickSkills, runHome, withProgress } from "@scilla/tui";
import { askLine } from "./io.ts";
import { main } from "./main.ts";

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  // An empty or blank path variable counts as unset, never as the current directory.
  home: envValue(process.env, "SCILLA_HOME") ?? homedir(),
  stdout: process.stdout,
  stderr: process.stderr,
  interactive: process.stdout.isTTY && process.stdin.isTTY,
  debug: envValue(process.env, "SCILLA_DEBUG") !== undefined,
  cacheDir: undefined,
  env: process.env,
  fetch,
  ask: askLine(process.stdin, process.stdout),
  tui: { pickSkills, runHome, withProgress },
});
