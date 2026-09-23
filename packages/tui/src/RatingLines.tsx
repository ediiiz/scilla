import { ratingLines } from "./rating-model.ts";
import { useRatings } from "./ratings.ts";
import { toneColor } from "./theme.ts";

export interface RatingLinesProps {
  readonly name: string;
}

/** A skill's security ratings, one line each, for the detail pane and the preview header. */
export function RatingLines({ name }: RatingLinesProps) {
  const lines = ratingLines(useRatings(), name);

  return lines.length === 0 ? null : (
    <box flexDirection="column" flexShrink={0} marginTop={1}>
      {lines.map((line) => (
        <text key={line.text} fg={toneColor(line.tone)} wrapMode="char">
          {line.text}
        </text>
      ))}
    </box>
  );
}
