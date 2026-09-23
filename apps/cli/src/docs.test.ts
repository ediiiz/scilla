import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { manifestJsonSchema } from "@scilla/core";
import { z } from "zod";
import packageJson from "../package.json" with { type: "json" };
import { COMMAND_NAMES, HELP, LONG_FLAGS, parseCommand } from "./args.ts";
import { TOPICS } from "./docs.ts";
import { askLine } from "./io.ts";
import { cli, removeTemps } from "./testing/harness.ts";

afterAll(removeTemps);

const DOCS = join(import.meta.dir, "..", "docs");

const doc = (name: string) => readFileSync(join(DOCS, `${name}.md`), "utf8");

const topicNames = TOPICS.map((topic) => topic.name);

const WithProperties = z.object({ properties: z.record(z.string(), z.json()) });

// The manifest schema's field list, and the object form of a Reference inside `references`.
const JsonSchemaDoc = z.object({
  properties: z.looseObject({
    references: z.object({ items: z.object({ anyOf: z.array(z.json()) }) }),
  }),
});

describe("scilla docs", () => {
  test("with no topic lists every topic and how to read one", async () => {
    const result = await cli(["docs"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("`scilla docs <topic>`");

    for (const name of [...topicNames, "all", "schema"]) {
      expect(result.stdout).toContain(`- \`${name}\`: `);
    }
  });

  test.each([
    "start",
    "concepts",
    "sources",
    "manifest",
    "commands",
    "install",
    "review",
    "audit",
    "agents",
  ])("%s prints its Markdown file exactly", async (name) => {
    expect(await cli(["docs", name])).toMatchObject({ code: 0, stdout: doc(name) });
  });

  test("all is one document with a versioned header and every topic", async () => {
    const { stdout } = await cli(["docs", "all"]);

    expect(stdout).toStartWith(`# scilla ${packageJson.version}\n\n> `);
    expect(stdout.match(/^# /gm)).toHaveLength(1);

    for (const topic of TOPICS) {
      const title = topic.text.split("\n")[0] ?? "";

      expect(stdout).toContain(`\n#${title}\n`);
    }

    // Headings move down a level, but a `#` comment inside a code block stays as it is.
    expect(stdout).toContain("\n## Getting started\n");
    expect(stdout).toContain("\nscilla <command> [arguments] [flags]\n");
  });

  test("schema prints the manifest JSON Schema", async () => {
    const { code, stdout } = await cli(["docs", "schema"]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(manifestJsonSchema());
  });

  test("an unknown topic exits 1 and lists the topics", async () => {
    expect(await cli(["docs", "nope"])).toMatchObject({
      code: 1,
      stdout: "",
      stderr: `error: Unknown docs topic "nope". Topics: ${[...topicNames, "all", "schema"].join(", ")}.\n`,
    });
  });

  test("a terminal gets styled headings and dimmed fences; --raw and NO_COLOR get Markdown", async () => {
    const styled = await cli(["docs", "start"], { tty: true });

    expect(styled.stdout).toStartWith("\u001B[1;36mGetting started\u001B[0m\n");
    expect(styled.stdout).toContain("\u001B[2m```sh\u001B[0m\n");
    expect(styled.stdout).not.toContain("\n## ");
    expect((await cli(["docs", "start", "--raw"], { tty: true })).stdout).toBe(doc("start"));
    expect((await cli(["docs", "start"], { tty: true, env: { NO_COLOR: "1" } })).stdout).toBe(
      doc("start"),
    );
  });
});

describe("the docs stay in step with the code", () => {
  const commands = doc("commands");

  test("commands.md names every command and long flag the parser knows", () => {
    for (const name of COMMAND_NAMES) {
      expect(commands).toContain(`scilla ${name}`);
    }

    for (const flag of LONG_FLAGS) {
      expect(commands).toContain(`\`${flag}`);
    }
  });

  test("the command list is the parser's: each one parses, and help shows no others", () => {
    for (const name of COMMAND_NAMES) {
      const attempt = () => parseCommand([...name.split(" "), "x"]);

      expect(attempt).not.toThrow("Unknown command");
    }

    const inHelp = [...HELP.matchAll(/^ {2}scilla ([a-z]+(?: (?:add|new|accept|propose))?)/gm)].map(
      (match) => match[1],
    );

    expect(COMMAND_NAMES).toEqual(expect.arrayContaining(inHelp));
  });

  test("concepts.md defines every CONTEXT.md term", () => {
    const context = readFileSync(join(import.meta.dir, "..", "..", "..", "CONTEXT.md"), "utf8");
    const terms = [...context.matchAll(/^\*\*(.+)\*\*:$/gm)].map((match) => match[1] ?? "");

    expect(terms.length).toBeGreaterThan(5);

    for (const term of terms) {
      expect(doc("concepts")).toContain(`**${term}**:`);
    }
  });

  test("manifest.md describes every manifest and Reference field", () => {
    const schema = JsonSchemaDoc.parse(manifestJsonSchema());
    const manifest = doc("manifest");

    const reference = schema.properties.references.items.anyOf.flatMap((entry) => {
      const parsed = WithProperties.safeParse(entry);

      return parsed.success ? Object.keys(parsed.data.properties) : [];
    });

    expect(reference).toContain("include");

    for (const field of [...Object.keys(schema.properties), ...reference]) {
      expect(manifest).toContain(`- \`${field}\` (`);
    }
  });

  test("the example review workflows run on a schedule and on demand, with a command that parses", () => {
    const Workflow = z.object({
      on: z.object({
        schedule: z.array(z.object({ cron: z.string() })),
        workflow_dispatch: z.null(),
      }),
      jobs: z.record(
        z.string(),
        z.object({ steps: z.array(z.object({ run: z.string().optional() })) }),
      ),
    });

    for (const name of ["scilla-review.github.yml", "scilla-review.forgejo.yml"]) {
      const text = readFileSync(
        join(import.meta.dir, "..", "..", "..", "docs", "examples", name),
        "utf8",
      );

      const workflow = Workflow.parse(Bun.YAML.parse(text));

      const runs = Object.values(workflow.jobs).flatMap((job) =>
        job.steps.flatMap((step) => (step.run?.startsWith("bunx scilla-cli ") ? [step.run] : [])),
      );

      expect(runs).toHaveLength(1);
      expect(parseCommand(runs[0]?.split(" ").slice(2) ?? [])).toMatchObject({
        kind: "review-propose",
        open: true,
      });
    }
  });

  test("help points at the docs", () => {
    expect(HELP).toEndWith("\nDocs: scilla docs (for people and agents)\n");
  });
});

describe("askLine", () => {
  test("writes the question and resolves with the answer", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const asked = askLine(input, output)("Go? ");

    input.write("yes\n");

    expect(await asked).toBe("yes");
    expect(output.read()?.toString()).toBe("Go? ");
  });
});
