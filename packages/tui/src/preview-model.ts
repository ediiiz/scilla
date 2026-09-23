import type { Choice } from "@scilla/core";
import { clashNote, descriptionText, originLines } from "./picker-model.ts";

export interface FrontmatterField {
  readonly key: string;
  readonly value: string;
}

/** A SKILL.md split into its frontmatter fields and the Markdown after them. */
export interface SkillDocument {
  readonly fields: readonly FrontmatterField[];
  readonly body: string;
}

const FRONTMATTER_FENCE = /^---\s*$/;

const TOP_LEVEL_FIELD = /^([\w.-]+):\s*(.*)$/;

const BLOCK_SCALAR_MARKER = /^[|>][+-]?$/;

const QUOTED = /^(["']).*\1$/;

const unquote = (value: string) => (QUOTED.test(value) ? value.slice(1, -1) : value);

interface FieldDraft {
  readonly key: string;
  readonly parts: string[];
}

/**
 * Read frontmatter leniently, like Traversal does: every top-level `key: value` starts a field, and
 * indented or continued lines join its value on one line. Block scalar markers (`|`, `>-`) are dropped.
 */
const parseFields = (lines: readonly string[]): FrontmatterField[] => {
  const drafts: FieldDraft[] = [];

  for (const line of lines) {
    const match = TOP_LEVEL_FIELD.exec(line);
    const [, key, value] = match ?? [];

    if (key === undefined) {
      drafts.at(-1)?.parts.push(line.trim());
    } else {
      drafts.push({ key, parts: [value ?? ""] });
    }
  }

  return drafts.map((draft) => ({
    key: draft.key,
    value: unquote(
      draft.parts
        .filter((part) => part !== "" && !BLOCK_SCALAR_MARKER.test(part))
        .join(" ")
        .trim(),
    ),
  }));
};

/** Split a SKILL.md into frontmatter fields and body; without a closed `---` block it's all body. */
export const splitFrontmatter = (text: string): SkillDocument => {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const opened = FRONTMATTER_FENCE.test(lines[0] ?? "");

  const end = opened
    ? lines.findIndex((line, index) => index > 0 && FRONTMATTER_FENCE.test(line))
    : -1;

  if (end === -1) {
    return { fields: [], body: lines.join("\n") };
  }

  return { fields: parseFields(lines.slice(1, end)), body: lines.slice(end + 1).join("\n") };
};

export type BodyLineKind = "heading" | "fence" | "code" | "bullet" | "quote" | "rule" | "text";

/** One source line of the body, classified for light Markdown styling. */
export interface BodyLine {
  /** The source line number, unique within a body. */
  readonly line: number;
  readonly kind: BodyLineKind;
  /** A bullet's indent and marker (`• `, `1. `); empty otherwise. */
  readonly marker: string;
  readonly text: string;
}

const CODE_FENCE = /^\s*(`{3,}|~{3,})/;

const HEADING = /^#{1,6}\s+(?<text>.*?)(?:\s+#+)?\s*$/;

const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

const UNORDERED = /^(?<indent>\s*)[-*+]\s+(?<text>.*)$/;

const ORDERED = /^(?<indent>\s*)(?<number>\d+[.)])\s+(?<text>.*)$/;

const QUOTE = /^\s*>\s?(?<text>.*)$/;

/** Checked in order; the first match decides the line's kind. Anything else is text. */
const LINE_RULES: readonly (readonly [BodyLineKind, RegExp])[] = [
  ["heading", HEADING],
  ["rule", RULE],
  ["bullet", UNORDERED],
  ["bullet", ORDERED],
  ["quote", QUOTE],
];

interface LineGroups {
  readonly indent?: string;
  readonly number?: string;
  readonly text?: string;
}

const classify = (source: string, line: number): BodyLine => {
  const matched = LINE_RULES.values()
    .map(([kind, pattern]) => ({ kind, match: pattern.exec(source) }))
    .find((candidate) => candidate.match !== null);

  if (matched === undefined) {
    return { line, kind: "text", marker: "", text: source.trimEnd() };
  }

  const groups: LineGroups = matched.match?.groups ?? {};
  const marker = `${groups.indent ?? ""}${groups.number ?? "•"} `;

  return {
    line,
    kind: matched.kind,
    marker: matched.kind === "bullet" ? marker : "",
    text: groups.text ?? "",
  };
};

/** Drop blank lines at either end, so the body starts right under the frontmatter. */
const trimBlankEdges = (lines: readonly string[]) => {
  const first = lines.findIndex((line) => line.trim() !== "");
  const last = lines.findLastIndex((line) => line.trim() !== "");

  return first === -1 ? [] : lines.slice(first, last + 1);
};

/** Classify each body line; lines inside a code fence are code, whatever they look like. */
export const bodyLines = (body: string): BodyLine[] => {
  let inCode = false;

  return trimBlankEdges(body.split(/\r?\n/)).map((source, line) => {
    if (CODE_FENCE.test(source)) {
      inCode = !inCode;

      return { line, kind: "fence", marker: "", text: source.trim() };
    }

    return inCode
      ? { line, kind: "code", marker: "", text: source.replaceAll("\t", "  ") }
      : classify(source, line);
  });
};

export interface InlineSegment {
  readonly kind: "plain" | "code" | "strong";
  readonly text: string;
}

const INLINE_MARKUP = /(`[^`]+`|\*\*[^*]+\*\*)/;

const INLINE_CODE = /^`[^`]+`$/;

const INLINE_STRONG = /^\*\*[^*]+\*\*$/;

const inlineSegment = (part: string): InlineSegment => {
  if (INLINE_CODE.test(part)) {
    return { kind: "code", text: part.slice(1, -1) };
  }

  return INLINE_STRONG.test(part)
    ? { kind: "strong", text: part.slice(2, -2) }
    : { kind: "plain", text: part };
};

/** Split a line on inline code spans and `**strong**` runs; everything else stays as written. */
export const inlineSegments = (text: string): InlineSegment[] =>
  text.split(INLINE_MARKUP).flatMap((part) => (part === "" ? [] : [inlineSegment(part)]));

/** One row of the file tree: a folder (ending in `/`) or a file, indented by depth. */
export interface TreeEntry {
  /** The path relative to the skill folder, unique within a tree. */
  readonly path: string;
  readonly depth: number;
  readonly name: string;
  readonly folder: boolean;
  /** Listed in the skill's executables, so it's shown in the warning colour. */
  readonly executable: boolean;
}

const compareSegments = (left: readonly string[], right: readonly string[]): number => {
  const index = left.findIndex((segment, at) => segment !== right[at]);

  if (index === -1) {
    return left.length - right.length;
  }

  const other = right[index];

  return other === undefined ? 1 : (left[index] ?? "").localeCompare(other);
};

const sharedDepth = (left: readonly string[], right: readonly string[]) => {
  const index = left.findIndex((segment, at) => segment !== right[at]);

  return index === -1 ? Math.min(left.length, right.length) : index;
};

/** Build a sorted, indented tree from relative file paths, marking the executables. */
export const fileTree = (files: readonly string[], executables: readonly string[]): TreeEntry[] => {
  const runs = new Set(executables);
  const entries: TreeEntry[] = [];
  let previous: readonly string[] = [];

  for (const segments of files.map((file) => file.split("/")).toSorted(compareSegments)) {
    const folders = segments.slice(0, -1);
    const shared = sharedDepth(previous, folders);

    for (const [offset, name] of folders.slice(shared).entries()) {
      const depth = shared + offset;

      entries.push({
        path: `${folders.slice(0, depth + 1).join("/")}/`,
        depth,
        name: `${name}/`,
        folder: true,
        executable: false,
      });
    }

    const path = segments.join("/");

    entries.push({
      path,
      depth: folders.length,
      name: segments.at(-1) ?? "",
      folder: false,
      executable: runs.has(path),
    });
    previous = folders;
  }

  return entries;
};

/** How many tree rows the preview shows before collapsing the rest. */
const TREE_LIMIT = 20;

export interface CollapsedTree {
  readonly shown: readonly TreeEntry[];
  /** `+N more`, noting hidden executables; undefined when nothing is hidden. */
  readonly more: string | undefined;
}

export const collapseTree = (entries: readonly TreeEntry[], limit = TREE_LIMIT): CollapsedTree => {
  if (entries.length <= limit) {
    return { shown: entries, more: undefined };
  }

  const hidden = entries.slice(limit);
  const runs = hidden.filter((entry) => entry.executable).length;

  return {
    shown: entries.slice(0, limit),
    more: `+${hidden.length} more${runs === 0 ? "" : ` (${runs} can run code)`}`,
  };
};

export type ScrollMove = "down" | "up" | "page-down" | "page-up" | "top" | "bottom";

const scrollStep = (move: ScrollMove, page: number, bottom: number, top: number) => {
  switch (move) {
    case "down": {
      return top + 1;
    }

    case "up": {
      return top - 1;
    }

    case "page-down": {
      return top + page;
    }

    case "page-up": {
      return top - page;
    }

    case "top": {
      return 0;
    }

    default: {
      return bottom;
    }
  }
};

/**
 * The first visible line after a move, kept within the content. A page keeps one line of overlap
 * so the reader doesn't lose their place.
 */
export const scrollOffset = (top: number, move: ScrollMove, content: number, viewport: number) => {
  const bottom = Math.max(content - viewport, 0);
  const page = Math.max(viewport - 1, 1);

  return Math.min(Math.max(scrollStep(move, page, bottom, top), 0), bottom);
};

export type PreviewIntent =
  | { readonly kind: "close" }
  | { readonly kind: "scroll"; readonly move: ScrollMove };

const CLOSE_KEYS = new Set(["escape", "left", "h", "q"]);

const SCROLL_KEYS: ReadonlyMap<string, ScrollMove> = new Map([
  ["j", "down"],
  ["down", "down"],
  ["k", "up"],
  ["up", "up"],
  ["pagedown", "page-down"],
  ["space", "page-down"],
  ["pageup", "page-up"],
  ["g", "top"],
  ["home", "top"],
  ["G", "bottom"],
  ["end", "bottom"],
]);

/** Map a key press inside the preview; `G` may arrive as `g` with shift. */
export const previewIntent = (name: string, shift: boolean): PreviewIntent | undefined => {
  if (CLOSE_KEYS.has(name)) {
    return { kind: "close" };
  }

  const move = name === "g" && shift ? "bottom" : SCROLL_KEYS.get(name);

  return move === undefined ? undefined : { kind: "scroll", move };
};

export interface PreviewHeader {
  readonly name: string;
  /** `optional` or `recommended`, as the Collection marks the skill. */
  readonly marker: string;
  readonly description: string;
  /** url, path, short commit, and the `via` chain when the skill came through References. */
  readonly origin: readonly string[];
  /** Why a conflict row can't be ticked; undefined for every other row. */
  readonly clash: string | undefined;
}

export const previewHeader = (choice: Choice): PreviewHeader => {
  const { skill } = choice;
  const origin = originLines(skill);

  return {
    name: skill.name,
    marker: skill.optional ? "optional" : "recommended",
    description: descriptionText(skill),
    origin: skill.via.length === 0 ? origin : [...origin, `via     ${skill.via.join(" › ")}`],
    clash: choice.status === "conflict" ? clashNote(choice) : undefined,
  };
};

/** Frontmatter keys padded to one width, so the values line up. */
export const frontmatterLines = (fields: readonly FrontmatterField[]) => {
  const width = Math.max(0, ...fields.map((field) => field.key.length));

  return fields.map((field) => ({ key: field.key.padEnd(width), value: field.value }));
};
