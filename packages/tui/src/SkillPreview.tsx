import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { Choice } from "@scilla/core";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { RatingLines } from "./RatingLines.tsx";
import { loadPreview, type PreviewFiles } from "./preview-files.ts";
import {
  bodyLines,
  collapseTree,
  fileTree,
  frontmatterLines,
  inlineSegments,
  previewHeader,
  previewIntent,
  scrollOffset,
  splitFrontmatter,
  type BodyLine,
} from "./preview-model.ts";
import { ACCENT, MUTED, TEXT, WARN } from "./theme.ts";

export interface SkillPreviewProps {
  readonly choice: Choice;
  /** Back to the list; the picker keeps its focus and ticks. */
  readonly onClose: () => void;
}

/** Width of the file tree column; leaves the SKILL.md pane about 48 columns at 80 wide. */
const FILES_WIDTH = 28;

/** Wider than any terminal; clipped to the pane. */
const RULE_LINE = "─".repeat(200);

function Rule() {
  return (
    <text fg={MUTED} flexShrink={0} wrapMode="none">
      {RULE_LINE}
    </text>
  );
}

const KEY_HELP = "↑↓/jk scroll · pgup/pgdn page · g/G top/bottom · esc/←/q back";

const inlineSpans = (text: string): ReactNode[] =>
  inlineSegments(text).map((segment, index) => {
    const key = `${index}-${segment.kind}`;

    switch (segment.kind) {
      case "code": {
        return (
          <span key={key} fg={MUTED}>
            {segment.text}
          </span>
        );
      }

      case "strong": {
        return <b key={key}>{segment.text}</b>;
      }

      default: {
        return segment.text;
      }
    }
  });

interface MarkdownLineProps {
  readonly line: BodyLine;
}

// Light Markdown styling on plain OpenTUI text; see the note on DocumentPane for why.
function MarkdownLine({ line }: MarkdownLineProps) {
  switch (line.kind) {
    case "heading": {
      return (
        <text fg={ACCENT}>
          <b>{line.text}</b>
        </text>
      );
    }

    case "fence":
    case "code": {
      return (
        <text fg={MUTED} wrapMode="char">
          {line.text === "" ? " " : line.text}
        </text>
      );
    }

    case "rule": {
      return <Rule />;
    }

    case "quote": {
      return <text fg={MUTED}>{`│ ${line.text}`}</text>;
    }

    default: {
      return (
        <text fg={TEXT}>
          <span fg={ACCENT}>{line.marker}</span>
          {line.text === "" && line.marker === "" ? " " : inlineSpans(line.text)}
        </text>
      );
    }
  }
}

interface DocumentProps {
  readonly text: string;
  readonly scroll: RefObject<ScrollBoxRenderable | null>;
}

function SkillDocument({ text, scroll }: DocumentProps) {
  const { fields, body } = splitFrontmatter(text);
  const lines = bodyLines(body);

  // tuiparts has no scrolling container; the preview scrolls a plain OpenTUI scrollbox by key.
  return (
    <scrollbox ref={scroll} flexGrow={1} flexBasis={0}>
      {frontmatterLines(fields).map((field) => (
        <text key={field.key} fg={TEXT} flexShrink={0}>
          <span fg={MUTED}>{`${field.key}  `}</span>
          {field.value}
        </text>
      ))}
      {fields.length === 0 ? null : <Rule />}
      {lines.map((line) => (
        <MarkdownLine key={line.line} line={line} />
      ))}
    </scrollbox>
  );
}

interface PaneProps {
  readonly loaded: PreviewFiles | undefined;
  readonly scroll: RefObject<ScrollBoxRenderable | null>;
}

/**
 * OpenTUI 0.5.12 has a `<markdown>` intrinsic, but it draws paragraphs and headings only once its
 * tree-sitter worker has highlighted them (about half a second later), so a freshly opened preview
 * starts blank and headless tests would need real-time waits. Light styling here draws at once.
 */
function DocumentPane({ loaded, scroll }: PaneProps) {
  const doc = loaded?.doc;

  return (
    <box
      border
      borderColor={MUTED}
      title=" SKILL.md "
      flexGrow={1}
      flexDirection="column"
      paddingX={1}
    >
      {doc === undefined ? <text fg={MUTED}>Loading…</text> : null}
      {doc?.kind === "missing" ? <text fg={WARN}>This skill has no SKILL.md.</text> : null}
      {doc?.kind === "unreadable" ? (
        <text fg={WARN}>{`SKILL.md could not be read: ${doc.reason}`}</text>
      ) : null}
      {doc?.kind === "text" ? <SkillDocument text={doc.text} scroll={scroll} /> : null}
    </box>
  );
}

interface FilesPaneProps {
  readonly loaded: PreviewFiles | undefined;
  readonly executables: readonly string[];
}

function FilesPane({ loaded, executables }: FilesPaneProps) {
  const files = loaded?.files;
  const tree = collapseTree(fileTree(files ?? [], executables));

  return (
    <box
      border
      borderColor={MUTED}
      title={files === undefined ? " Files " : ` Files (${files.length}) `}
      width={FILES_WIDTH}
      flexDirection="column"
      paddingX={1}
    >
      {loaded === undefined ? <text fg={MUTED}>Loading…</text> : null}
      {loaded !== undefined && files === undefined ? (
        <text fg={WARN}>The folder could not be listed.</text>
      ) : null}
      {tree.shown.map((entry) => (
        <text
          key={entry.path}
          fg={entry.executable ? WARN : entry.folder ? MUTED : TEXT}
          wrapMode="none"
          truncate
        >
          {`${"  ".repeat(entry.depth)}${entry.name}${entry.executable ? " ⚠" : ""}`}
        </text>
      ))}
      {tree.more === undefined ? null : <text fg={MUTED}>{tree.more}</text>}
    </box>
  );
}

interface HeadingProps {
  readonly choice: Choice;
}

function PreviewHeading({ choice }: HeadingProps) {
  const header = previewHeader(choice);

  return (
    <box flexDirection="column" flexShrink={0} marginBottom={1}>
      <text wrapMode="none" truncate>
        <span fg={ACCENT}>
          <b>{header.name}</b>
        </span>
        <span fg={MUTED}>{`  ${header.marker}`}</span>
      </text>
      <text fg={TEXT}>{header.description}</text>
      {header.origin.map((line) => (
        <text key={line} fg={MUTED} wrapMode="none" truncate>
          {line}
        </text>
      ))}
      {header.clash === undefined ? null : <text fg={WARN}>{`conflict: ${header.clash}`}</text>}
      <RatingLines name={header.name} />
    </box>
  );
}

/** Read the skill folder once per opened preview; undefined while it loads. */
const usePreviewFiles = (dir: string) => {
  const [loaded, setLoaded] = useState<PreviewFiles | undefined>(undefined);

  useEffect(() => {
    let live = true;

    void loadPreview(dir).then((files) => {
      if (live) {
        setLoaded(files);
      }
    });

    return () => {
      live = false;
    };
  }, [dir]);

  return loaded;
};

/** A full-screen look at one skill: origin, SKILL.md and its files. Every key stops here. */
export function SkillPreview({ choice, onClose }: SkillPreviewProps) {
  const loaded = usePreviewFiles(choice.skill.dir);
  const scroll = useRef<ScrollBoxRenderable>(null);

  // Registered after the picker's own handlers, and keeps the hidden list's Checkbox from the key.
  useKeyboard((key) => {
    key.preventDefault();

    const intent = previewIntent(key.name, key.shift);
    const box = scroll.current;

    if (intent?.kind === "close") {
      onClose();
    } else if (intent !== undefined && box !== null) {
      box.scrollTop = scrollOffset(
        box.scrollTop,
        intent.move,
        box.scrollHeight,
        box.viewport.height,
      );
    }
  });

  // tuiparts has no layout or text primitives; the preview's frame is plain OpenTUI.
  return (
    <box flexDirection="column" width="100%" height="100%" paddingX={1}>
      <PreviewHeading choice={choice} />
      <box flexDirection="row" flexGrow={1} gap={1}>
        <DocumentPane loaded={loaded} scroll={scroll} />
        <FilesPane loaded={loaded} executables={choice.skill.executables} />
      </box>
      <text fg={MUTED} flexShrink={0} wrapMode="none" truncate>
        {KEY_HELP}
      </text>
    </box>
  );
}
