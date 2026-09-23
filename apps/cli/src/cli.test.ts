import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { manifestFile, plant, removeTemps, skillAt, temp } from "./testing/harness.ts";

afterAll(removeTemps);

const ENTRY = join(import.meta.dir, "index.ts");

/** Run the real bin in `cwd` with piped stdio (so no TTY) and a temp home and cache. */
const spawn = async (args: readonly string[], cwd = temp("project")) => {
  const home = temp("home");

  const child = Bun.spawn(["bun", ENTRY, ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: home,
      SCILLA_HOME: home,
      SCILLA_CACHE_DIR: temp("cache"),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      SCILLA_NO_AUDIT: "1",
    },
  });

  child.stdin.end();

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { stdout, stderr, code };
};

describe("the scilla bin", () => {
  test("--version", async () => {
    expect(await spawn(["--version"])).toMatchObject({
      code: 0,
      stdout: `${packageJson.version}\n`,
    });
  });

  test("--help, and bare scilla without a terminal", async () => {
    const help = await spawn(["--help"]);
    const bare = await spawn([]);

    expect(help.code).toBe(0);
    expect(help.stdout).toStartWith("scilla: install curated Collections of agent skills");
    expect(bare.stdout).toBe(help.stdout);
  });

  test("add ./fixture -y installs into the project", async () => {
    const project = temp("project");

    plant(join(project, "fixture"), {
      ...manifestFile("fixture"),
      ...skillAt("skills/hello", "hello"),
    });

    const result = await spawn(["add", "./fixture", "-y"], project);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Installed: hello");
    expect(existsSync(join(project, ".agents", "skills", "hello", "SKILL.md"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(project, "scilla-lock.json"), "utf8")).skills,
    ).toHaveProperty("hello");
  });

  test("errors exit 1 on stderr", async () => {
    expect(await spawn(["delete", "ghost"])).toMatchObject({
      code: 1,
      stdout: "",
      stderr: 'error: No Collection or skill "ghost" is installed in this project.\n',
    });
  });
});
