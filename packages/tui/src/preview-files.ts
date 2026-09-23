import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** What the preview could read of a skill's SKILL.md. */
export type SkillDoc =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly reason: string };

export interface PreviewFiles {
  readonly doc: SkillDoc;
  /** Paths relative to the skill folder, unsorted; undefined when the folder can't be listed. */
  readonly files: readonly string[] | undefined;
}

/** Folders the file tree leaves out, as the install hash does. */
const SKIPPED_FOLDERS = new Set([".git", "node_modules"]);

const missing = (cause: unknown) =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

const readDoc = async (dir: string): Promise<SkillDoc> => {
  try {
    return { kind: "text", text: await readFile(join(dir, "SKILL.md"), "utf8") };
  } catch (cause) {
    if (missing(cause)) {
      return { kind: "missing" };
    }

    return { kind: "unreadable", reason: cause instanceof Error ? cause.message : String(cause) };
  }
};

const walk = async (root: string, relative: string): Promise<string[]> => {
  const entries = await readdir(join(root, relative), { withFileTypes: true });

  const nested = await Promise.all(
    entries.map((entry) => {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;

      if (!entry.isDirectory()) {
        return [path];
      }

      return SKIPPED_FOLDERS.has(entry.name) ? [] : walk(root, path);
    }),
  );

  return nested.flat();
};

const listFiles = async (dir: string) => {
  try {
    return await walk(dir, "");
  } catch {
    return undefined;
  }
};

/** Read a skill folder for its preview: SKILL.md and the file list, side by side. */
export const loadPreview = async (dir: string): Promise<PreviewFiles> => {
  const [doc, files] = await Promise.all([readDoc(dir), listFiles(dir)]);

  return { doc, files };
};
