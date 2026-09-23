import { manifestJsonSchema, ScillaError } from "@scilla/core";
import agents from "../docs/agents.md" with { type: "text" };
import audit from "../docs/audit.md" with { type: "text" };
import commands from "../docs/commands.md" with { type: "text" };
import concepts from "../docs/concepts.md" with { type: "text" };
import install from "../docs/install.md" with { type: "text" };
import manifest from "../docs/manifest.md" with { type: "text" };
import sources from "../docs/sources.md" with { type: "text" };
import start from "../docs/start.md" with { type: "text" };
import packageJson from "../package.json" with { type: "json" };
import type { Io } from "./io.ts";

/** The docs topics, in reading order. */
export const TOPICS = [
  { name: "start", summary: "What scilla is; Consumer and Curator quick starts", text: start },
  {
    name: "concepts",
    summary: "Collection, Reference, Traversal, Pin and the rest",
    text: concepts,
  },
  {
    name: "sources",
    summary: "Every way to name a source: owner/repo, git URLs, folders",
    text: sources,
  },
  { name: "manifest", summary: "Every scilla.json field, with an example", text: manifest },
  {
    name: "commands",
    summary: "Every command, flag, environment variable and exit code",
    text: commands,
  },
  {
    name: "install",
    summary: "Where files go, both lock files, local edits, update and delete",
    text: install,
  },
  {
    name: "audit",
    summary: "Security ratings: where they come from, privacy, opting out",
    text: audit,
  },
  { name: "agents", summary: "A checklist for AI agents running scilla", text: agents },
];

const EXTRA = [
  { name: "all", summary: "Every topic in one document (llms.txt style)" },
  { name: "schema", summary: "The scilla.json JSON Schema" },
];

const topicNames = () => [...TOPICS, ...EXTRA].map((topic) => topic.name);

const index = () =>
  [
    "# scilla docs",
    "",
    "Read a topic with `scilla docs <topic>`. Output is Markdown; `--raw` skips the styling on a terminal.",
    "",
    ...[...TOPICS, ...EXTRA].map((topic) => `- \`${topic.name}\`: ${topic.summary}`),
    "",
  ].join("\n");

type LineKind = "fence" | "code" | "heading" | "text";

/** Rewrite each line of a Markdown document, knowing whether it's in a code block or a heading. */
const mapLines = (markdown: string, rewrite: (line: string, kind: LineKind) => string) => {
  let fenced = false;

  return markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) {
        fenced = !fenced;

        return rewrite(line, "fence");
      }

      if (fenced) {
        return rewrite(line, "code");
      }

      return rewrite(line, /^#{1,6} /.test(line) ? "heading" : "text");
    })
    .join("\n");
};

/** Every topic in one document with a single title: each topic's headings move down a level. */
const everything = () => {
  const header = [
    `# scilla ${packageJson.version}`,
    "",
    `> scilla installs curated Collections of agent skills. This is every \`scilla docs\` topic in one document, for scilla ${packageJson.version}.`,
    "",
  ].join("\n");

  const topics = TOPICS.map((topic) =>
    mapLines(topic.text, (line, kind) => (kind === "heading" ? `#${line}` : line)),
  );

  return [header, ...topics].join("\n");
};

const BOLD_ACCENT = "\u001B[1;36m";

const DIM = "\u001B[2m";

const RESET = "\u001B[0m";

/** Light terminal styling: bold, accent-coloured headings (without the `#`s) and dimmed fences. */
const styled = (markdown: string) =>
  mapLines(markdown, (line, kind) => {
    switch (kind) {
      case "heading": {
        return `${BOLD_ACCENT}${line.replace(/^#+ /, "")}${RESET}`;
      }

      case "fence": {
        return `${DIM}${line}${RESET}`;
      }

      default: {
        return line;
      }
    }
  });

const markdownFor = (topic: string | undefined) => {
  if (topic === undefined) {
    return index();
  }

  if (topic === "all") {
    return everything();
  }

  const found = TOPICS.find((candidate) => candidate.name === topic);

  if (found === undefined) {
    throw new ScillaError(`Unknown docs topic "${topic}". Topics: ${topicNames().join(", ")}.`);
  }

  return found.text;
};

/** Style only for a person at a terminal: not with `--raw`, a pipe, or `NO_COLOR`. */
const wantsStyle = (io: Io, raw: boolean) =>
  !raw && io.stdout.isTTY === true && (io.env["NO_COLOR"] ?? "") === "";

/** `scilla docs [topic] [--raw]`: the topic index, one topic, `all` of them, or the manifest `schema`. */
export const docs = (io: Io, topic: string | undefined, raw: boolean) => {
  if (topic === "schema") {
    io.stdout.write(`${JSON.stringify(manifestJsonSchema(), null, 2)}\n`);

    return;
  }

  const markdown = markdownFor(topic);

  io.stdout.write(wantsStyle(io, raw) ? styled(markdown) : markdown);
};
