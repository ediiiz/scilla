// prepack: npm packs only this folder, and the README lives at the repo root. Copy it in (npm does
// not follow symlinks into the tarball); postpack removes the copy again.
import { copyFileSync } from "node:fs";
import { join } from "node:path";

copyFileSync(
  join(import.meta.dir, "..", "..", "..", "README.md"),
  join(import.meta.dir, "..", "README.md"),
);
