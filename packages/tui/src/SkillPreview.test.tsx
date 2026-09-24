import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SkillPicker } from "./SkillPicker.tsx";
import { plan } from "./test-fixtures.ts";
import { mountScreen, reporter, unmountAll } from "./test-render.ts";

let root = "";

const numbered = Array.from({ length: 60 }, (_, index) => `line ${String(index).padStart(2, "0")}`);

const ALPHA_MD = [
  "---",
  "name: alpha",
  'description: "Does alpha things."',
  "license: MIT",
  "---",
  "",
  "# Usage",
  "",
  "Run it with `alpha --go` and **care**.",
  "",
  "- first step",
  "- second step",
  "",
  "```sh",
  "echo hi",
  "```",
  "",
  ...numbered,
].join("\n");

const write = async (path: string, text: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scilla-preview-"));
  await Promise.all([
    write("alpha/SKILL.md", ALPHA_MD),
    write("alpha/scripts/run.sh", "#!/bin/sh\n"),
    write("alpha/references/guide.md", "guide\n"),
    write("alpha/.git/HEAD", "ref\n"),
    write("alpha/node_modules/dep/index.js", "\n"),
    write("omega/SKILL.md", "---\nname: omega\n---\nOmega body text.\n"),
    mkdir(join(root, "bare"), { recursive: true }),
  ]);
});

afterAll(() => rm(root, { recursive: true, force: true }));

afterEach(unmountAll);

const fixture = () =>
  plan([
    {
      name: "alpha",
      dir: join(root, "alpha"),
      executables: ["scripts/run.sh"],
      via: ["acme/tools", "deep/nested"],
    },
    { name: "bare", dir: join(root, "bare"), optional: true, via: ["acme/tools"] },
    {
      name: "omega",
      dir: join(root, "omega"),
      status: "conflict",
      note: "already installed from x/y",
      via: ["acme/tools"],
    },
  ]);

const mount = async (height = 30) => {
  const { reported, done } = reporter<ReadonlySet<string> | undefined>();

  const screen = await mountScreen(
    <SkillPicker plan={fixture()} onDone={(result) => done(result?.selected)} />,
    80,
    height,
  );

  return { ...screen, outcome: reported };
};

describe("SkillPreview", () => {
  test("p opens the focused skill with origin, frontmatter, body and files", async () => {
    const { frame, press, waitFor } = await mount();

    expect(frame()).toContain("p preview");

    await press("p");
    await waitFor("line 00");

    const text = frame();

    expect(text).toContain("alpha  recommended");
    expect(text).toContain("Does alpha things.");
    expect(text).toContain("commit  0123456");
    expect(text).toContain("via     acme/tools › deep/nested");
    expect(text).toContain("license      MIT");
    expect(text).not.toContain("---");
    expect(text).not.toContain("...");
    expect(text).toContain("Usage");
    expect(text).not.toContain("# Usage");
    expect(text).toContain("Run it with alpha --go and care.");
    expect(text).toContain("• first step");
    expect(text).toContain("```sh");
    expect(text).toContain("echo hi");
    expect(text).toContain("Files (3)");
    expect(text).toContain("scripts/");
    expect(text).toContain("run.sh ⚠");
    expect(text).not.toContain("HEAD");
    expect(text).not.toContain("index.js");
    expect(text).toContain("esc/←/q back");
  });

  test("a conflict row previews with its clash note", async () => {
    const { frame, press, waitFor } = await mount();

    await press("END", "l");
    await waitFor("Omega body text.");

    expect(frame()).toContain("omega  recommended");
    expect(frame()).toContain("conflict: already installed from x/y");
  });

  test("a folder without SKILL.md shows a notice", async () => {
    const { frame, press, waitFor } = await mount();

    await press("j", "ARROW_RIGHT");
    await waitFor("no SKILL.md");

    expect(frame()).toContain("bare  optional");
    expect(frame()).toContain("This skill has no SKILL.md.");
    expect(frame()).toContain("Files (0)");
  });

  test("the body scrolls by line, page and to either end", async () => {
    const { frame, press, waitFor } = await mount(24);

    await press("p");
    await waitFor("Usage");

    expect(frame()).not.toContain("line 59");

    await press("G");

    expect(frame()).toContain("line 59");
    expect(frame()).not.toContain("Usage");

    await press("k", "k", "k");

    expect(frame()).not.toContain("line 59");

    await press("END");

    expect(frame()).toContain("line 59");

    await press("g");

    expect(frame()).toContain("Usage");

    await press("j");

    expect(frame()).not.toContain("name         alpha");

    await press("\u001B[6~");

    expect(frame()).not.toContain("Usage");

    await press("\u001B[5~", "HOME");

    expect(frame()).toContain("name         alpha");
  });

  test("esc returns to the list with focus and ticks kept", async () => {
    const { frame, outcome, press, waitFor } = await mount();

    await press("j", " ", "p");
    await waitFor("no SKILL.md");
    await press(" ", "j", "ESCAPE");

    expect(frame()).toContain("› [x] bare");
    expect(frame()).toContain("1/2 selected");

    await press("p");
    await waitFor("no SKILL.md");
    await press("h");

    expect(frame()).toContain("› [x] bare");

    await press("RETURN");

    expect(outcome.value).toEqual(new Set(["bare"]));
  });

  test("q closes only the preview; a second q cancels the picker", async () => {
    const { frame, outcome, press, waitFor } = await mount();

    await press("p");
    await waitFor("line 00");
    await press("q");

    expect(outcome.value).toBe("pending");
    expect(frame()).toContain("› [ ] alpha");
    expect(frame()).toContain("space toggle");

    await press("q");

    expect(outcome.value).toBeUndefined();
  });
});

/** A picker whose alpha changed since the lock, with `diff` loading its changes. */
const changed = (diff: () => Promise<string>) => {
  const { done } = reporter<ReadonlySet<string> | undefined>();

  const picked = plan([
    {
      name: "alpha",
      dir: join(root, "alpha"),
      status: "installed",
      selected: true,
      changed: true,
    },
    { name: "omega", dir: join(root, "omega"), status: "installed", selected: true },
  ]);

  return mountScreen(
    <SkillPicker plan={picked} diff={diff} onDone={(result) => done(result?.selected)} />,
    90,
    30,
  );
};

describe("the changes preview", () => {
  test("d shows a changed skill's diff, and d again its SKILL.md", async () => {
    const patch = "diff --git a/SKILL.md b/SKILL.md\n@@ -1 +1 @@\n-old line\n+new line\n";
    const { frame, press, waitFor } = await changed(() => Promise.resolve(patch));

    expect(frame()).toContain("alpha changed");
    expect(frame()).toContain("omega installed");
    expect(frame()).toContain("d changes");

    await press("d");
    await waitFor("+new line");

    expect(frame()).toContain("Changes since the lock");
    expect(frame()).toContain("-old line");
    expect(frame()).toContain("d SKILL.md/changes");

    await press("d");
    await waitFor("Usage");

    expect(frame()).toContain("SKILL.md");
    expect(frame()).not.toContain("+new line");
  });

  test("d on an unchanged skill only hints, and a failed load says why", async () => {
    const { frame, press, waitFor } = await changed(() => Promise.reject(new Error("boom")));

    await press("j", "d");

    expect(frame()).toContain("no changes since the lock to show");

    await press("k", "d");
    await waitFor("could not be loaded");

    expect(frame()).toContain("The changes could not be loaded: boom");
  });
});
