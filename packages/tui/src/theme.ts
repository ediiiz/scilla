import type { Tone } from "./picker-model.ts";

/** The one accent colour, used for focus, the title and "new". */
export const ACCENT = "#5fafff";

/** Secondary text: descriptions, origins, deeper Reference labels, key help. */
export const MUTED = "#808080";

/** Things the Consumer should read before confirming: executables, conflicts, warnings. */
export const WARN = "#d7af5f";

/** Primary text; OpenTUI's own default foreground. */
export const TEXT = "#ffffff";

/** Security ratings of `safe` or `low`. */
const GOOD = "#87d787";

/** Security ratings of `high` or `critical`. */
const DANGER = "#ff5f5f";

const TONE_COLORS: Readonly<Record<Tone | "text", string>> = {
  accent: ACCENT,
  muted: MUTED,
  warn: WARN,
  good: GOOD,
  danger: DANGER,
  text: TEXT,
};

/** The colour a model's tone is drawn in. */
export const toneColor = (tone: Tone | "text") => TONE_COLORS[tone];
