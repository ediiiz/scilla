import {
  UNAUDITED_REASONS,
  type AuditReport,
  type Choice,
  type ProviderRating,
  type Risk,
} from "@scilla/core";
import {
  badgesFor,
  selectionSummary,
  type Badge,
  type PickerState,
  type Tone,
} from "./picker-model.ts";

/**
 * The security ratings as the picker knows them: still on their way, arrived, or none at all (no
 * audit was asked for, or it failed). No ratings shows nothing; it never reads as "safe".
 */
export type Ratings = "pending" | AuditReport | undefined;

/** One line of the ratings block in the detail pane and the preview header. */
export interface RatingLine {
  /** Unique within a skill's lines. */
  readonly text: string;
  readonly tone: Tone;
}

const CHECKING = "checking ratings…";

const RISK_TONES: Readonly<Record<Risk, Tone>> = {
  safe: "good",
  low: "good",
  medium: "warn",
  high: "danger",
  critical: "danger",
};

/** The header's right side: `checking ratings…` while they load, then how many are ticked. */
export const headerStatus = (state: PickerState, ratings: Ratings) =>
  ratings === "pending" ? `${CHECKING}  ${selectionSummary(state)}` : selectionSummary(state);

/** A row's compact badge for its worst rating; none while loading, and none for unaudited skills. */
const ratingBadge = (ratings: Ratings, name: string): Badge | undefined => {
  const worst = ratings === "pending" ? undefined : ratings?.audits.get(name)?.worst;

  return worst === undefined ? undefined : { label: worst, tone: RISK_TONES[worst] };
};

/** A row's badges: what `badgesFor` shows, then the worst rating once it's known. */
export const rowBadges = (choice: Choice, ratings: Ratings): Badge[] => {
  const rating = ratingBadge(ratings, choice.skill.name);

  return rating === undefined ? badgesFor(choice) : [...badgesFor(choice), rating];
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** `Socket  high · 3 alerts · score 40`, with the labels padded to `width`. */
const providerLine = (provider: ProviderRating, width: number): RatingLine => {
  const extras = [
    provider.alerts === undefined ? [] : [plural(provider.alerts, "alert")],
    provider.score === undefined ? [] : [`score ${provider.score}`],
  ].flat();

  return {
    text: `  ${[`${provider.label.padEnd(width)}  ${provider.risk}`, ...extras].join(" · ")}`,
    tone: RISK_TONES[provider.risk],
  };
};

/** What the ratings say about one skill: each provider and where to read more, or why there are none. */
export const ratingLines = (ratings: Ratings, name: string): RatingLine[] => {
  if (ratings === undefined) {
    return [];
  }

  if (ratings === "pending") {
    return [{ text: CHECKING, tone: "muted" }];
  }

  const audit = ratings.audits.get(name);

  if (audit === undefined) {
    const reason = ratings.unaudited.get(name);

    return [
      {
        text: reason === undefined ? "not audited" : `not audited (${UNAUDITED_REASONS[reason]})`,
        tone: "muted",
      },
    ];
  }

  const width = Math.max(...audit.providers.map((provider) => provider.label.length));

  return [
    { text: "security ratings", tone: "muted" },
    ...audit.providers.map((provider) => providerLine(provider, width)),
    { text: "details", tone: "muted" },
    { text: `  ${audit.detailsUrl}`, tone: "muted" },
  ];
};
