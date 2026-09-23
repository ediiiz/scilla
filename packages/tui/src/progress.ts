/** Where progress goes; `process.stderr` by default. */
export interface ProgressStream {
  readonly isTTY?: boolean | undefined;
  write(chunk: string): boolean;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const INTERVAL_MS = 80;

const CLEAR_LINE = "\r\u001B[2K";

const HIDE_CURSOR = "\u001B[?25l";

const SHOW_CURSOR = "\u001B[?25h";

/**
 * Run a slow non-TUI step (such as a Traversal that fetches git repos) with a spinner on a TTY,
 * or a single `label…` line otherwise. The spinner line is cleared when the task settles.
 */
export const withProgress = async <T>(
  label: string,
  task: () => Promise<T>,
  stream: ProgressStream = process.stderr,
): Promise<T> => {
  if (stream.isTTY !== true) {
    stream.write(`${label}…\n`);

    return task();
  }

  let frame = 0;

  const draw = () => {
    stream.write(`${CLEAR_LINE}${FRAMES[frame % FRAMES.length] ?? ""} ${label}`);
    frame += 1;
  };

  stream.write(HIDE_CURSOR);
  draw();

  const timer = setInterval(draw, INTERVAL_MS);

  try {
    return await task();
  } finally {
    clearInterval(timer);
    stream.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
  }
};
