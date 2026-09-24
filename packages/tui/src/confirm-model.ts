import type { Agent, AgentLinks, Risk } from "@scilla/core";
import type { Dialog, PickerState, Tone } from "./picker-model.ts";
import type { Ratings } from "./rating-model.ts";

/** What the Consumer chose: the skills, and any answer on linking into an agent folder. */
export interface PickResult {
  readonly selected: ReadonlySet<string>;
  readonly agentLinks?: AgentLinks | undefined;
}

/** Ratings that make the picker ask before installing. */
const RISKY: ReadonlySet<Risk> = new Set(["medium", "high", "critical"]);

export interface RiskyPick {
  readonly name: string;
  readonly worst: Risk;
}

/** Ticked skills rated medium or worse, in `selected` order; none while ratings load or without any. */
export const riskyPicks = (ratings: Ratings, selected: ReadonlySet<string>): RiskyPick[] => {
  if (ratings === undefined || ratings === "pending") {
    return [];
  }

  return [...selected].flatMap((name) => {
    const worst = ratings.audits.get(name)?.worst;

    return worst !== undefined && RISKY.has(worst) ? [{ name, worst }] : [];
  });
};

/** The agents to ask about linking into, once the pick is made; none asks nothing. */
export type AskLinks = readonly Agent[] | undefined;

/** The dialog after the risk one: the link question when there is one, else none (finish). */
export const afterRisk = (askLinks: AskLinks): Dialog | undefined =>
  askLinks === undefined || askLinks.length === 0 ? undefined : "link";

/** The dialog Enter opens, or undefined when nothing needs asking and the picker can finish. */
export const firstDialog = (
  ratings: Ratings,
  selected: ReadonlySet<string>,
  askLinks: AskLinks,
): Dialog | undefined =>
  ratings === "pending" || riskyPicks(ratings, selected).length > 0 ? "risk" : afterRisk(askLinks);

/**
 * What a key does while a dialog is open; every other key is swallowed. The link dialog is a
 * checklist of agents: Space ticks, the arrows or j/k move, `n` answers no for all of them.
 */
export type DialogKey =
  | "accept"
  | "decline"
  | "back"
  | "cancel"
  | "toggle"
  | "up"
  | "down"
  | "ignore";

const LINK_KEYS: ReadonlyMap<string, DialogKey> = new Map([
  ["space", "toggle"],
  ["j", "down"],
  ["down", "down"],
  ["k", "up"],
  ["up", "up"],
  ["n", "decline"],
]);

export const dialogKey = (dialog: Dialog, name: string, ctrl: boolean): DialogKey => {
  if (ctrl && name === "c") {
    return "cancel";
  }

  if (name === "y" || name === "return" || name === "enter") {
    return "accept";
  }

  if (dialog === "link" && LINK_KEYS.has(name)) {
    return LINK_KEYS.get(name) ?? "ignore";
  }

  return name === "escape" || name === "q" || name === "n" ? "back" : "ignore";
};

/** What the link dialog records: every agent asked about, yes unless unticked, or no for all. */
export const linkAnswers = (
  agents: readonly Agent[],
  unticked: ReadonlySet<string>,
  none: boolean,
): AgentLinks =>
  Object.fromEntries(agents.map((agent) => [agent.folder, !none && !unticked.has(agent.folder)]));

export interface DialogLine {
  readonly text: string;
  readonly tone: Tone | "text";
}

export interface DialogView {
  readonly title: string;
  readonly lines: readonly DialogLine[];
  readonly keys: string;
}

const RISK_TONE: Readonly<Record<Risk, Tone>> = {
  safe: "good",
  low: "good",
  medium: "warn",
  high: "danger",
  critical: "danger",
};

const riskView = (ratings: Ratings, selected: ReadonlySet<string>): DialogView => {
  if (ratings === "pending") {
    return {
      title: " Security ratings ",
      lines: [{ text: "Still checking the security ratings of the ticked skills…", tone: "muted" }],
      keys: "y install without waiting · n back",
    };
  }

  const picks = riskyPicks(ratings, selected);
  const width = Math.max(...picks.map((pick) => pick.name.length));

  return {
    title: " Rated medium risk or higher ",
    lines: picks.map((pick) => ({
      text: `${pick.name.padEnd(width)}  ${pick.worst}`,
      tone: RISK_TONE[pick.worst],
    })),
    keys: "y install anyway · n back",
  };
};

const linkView = (agents: readonly Agent[], state: PickerState): DialogView => {
  const [only] = agents;
  const single = agents.length === 1 && only !== undefined;
  const width = Math.max(...agents.map((agent) => agent.folder.length));

  const rows = agents.map((agent, index): DialogLine => {
    const box = state.linkUnticked.has(agent.folder) ? "[ ]" : "[x]";
    const focused = index === state.linkFocus;
    const text = `${focused ? "›" : " "} ${box} ${`${agent.folder}/skills`.padEnd(width + 7)}  ${agent.name}`;

    return { text, tone: focused ? "accent" : "text" };
  });

  return {
    title: single ? ` Link into ${only.folder} ` : " Link into agent folders ",
    lines: [
      {
        text: single
          ? `${only.folder}/ doesn't exist here yet. Link the skills into it, so ${only.name} finds them?`
          : "These agent folders don't exist here yet. Link the skills into the ticked ones?",
        tone: "text",
      },
      ...(single ? [] : rows),
      { text: "The answer is saved in scilla-lock.json.", tone: "muted" },
    ],
    keys: single ? "y yes · n no · esc back" : "space tick · y confirm · n none · esc back",
  };
};

/** What an open dialog shows. */
export const dialogView = (state: PickerState, ratings: Ratings, askLinks: AskLinks): DialogView =>
  state.dialog === "link" && askLinks !== undefined && askLinks.length > 0
    ? linkView(askLinks, state)
    : riskView(ratings, state.selected);
