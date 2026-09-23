import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { plant, removeTemps, temp } from "../src/testing/harness.ts";

afterAll(removeTemps);

const SCRIPT = join(import.meta.dir, "release.ts");

const spec = `${packageJson.name}@${packageJson.version}`;

// Stand-ins for npm and bun on PATH: npm logs its arguments, `npm view` answers E404 as the
// registry does right after a publish, and `npm publish` answers what the test asks for.
const FAKE_NPM = `#!/bin/sh
echo "$@" >> "$NPM_LOG"
case "$1" in
  view) echo "npm error code E404" >&2; exit 1 ;;
  publish) echo "$PUBLISH_OUTPUT" >&2; exit "$PUBLISH_CODE" ;;
esac
`;

/** Run the release script against a fake npm whose publish exits `code` after printing `said`. */
const release = async (code: number, said: string) => {
  const bin = plant(temp("release-bin"), { "npm!": FAKE_NPM, "bun!": "#!/bin/sh\nexit 0\n" });
  const log = join(temp("release-log"), "npm.log");
  const events = join(temp("release-out"), "changesets-output");

  writeFileSync(log, "");

  const child = Bun.spawn([process.execPath, SCRIPT], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      NPM_LOG: log,
      PUBLISH_CODE: String(code),
      PUBLISH_OUTPUT: said,
      CHANGESETS_OUTPUT: events,
    },
  });

  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

  return { exitCode, stdout, npm: readFileSync(log, "utf8"), events: readFileSync(events, "utf8") };
};

describe("the release script", () => {
  test("asks the registry without its cache, publishes, and records the git tag", async () => {
    const result = await release(0, "");

    expect(result.exitCode).toBe(0);
    expect(result.npm).toContain(`view ${spec} version --prefer-online`);
    expect(result.npm).toContain("publish --provenance");
    expect(JSON.parse(result.events)).toMatchObject({ type: "git-tag", tag: spec });
  });

  test("a version npm already has (E409) is nothing to publish, and no git tag", async () => {
    const said = `npm error code E409\nnpm error Cannot publish over previously staged version "${packageJson.version}"`;
    const result = await release(1, said);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${spec} is already on npm; nothing to publish.\n`);
    expect(result.events).toBe("");
  });

  test("any other publish failure fails the release", async () => {
    const result = await release(1, "npm error code E403");

    expect(result.exitCode).not.toBe(0);
    expect(result.events).toBe("");
  });
});
