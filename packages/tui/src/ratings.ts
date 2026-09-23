import type { AuditReport } from "@scilla/core";
import { createContext, useContext, useEffect, useState } from "react";
import type { Ratings } from "./rating-model.ts";

/** The picker's ratings, for its rows, detail pane and preview; see `useAuditRatings`. */
export const RatingsContext = createContext<Ratings>(undefined);

export const useRatings = () => useContext(RatingsContext);

/**
 * Follow an audit that's still running while the picker is open: `pending` until it settles, then
 * its report. Without an audit, or when it rejects, there are no ratings.
 */
export const useAuditRatings = (audit: Promise<AuditReport> | undefined) => {
  const [ratings, setRatings] = useState<Ratings>(audit === undefined ? undefined : "pending");

  useEffect(() => {
    let live = true;

    const settle = (next: Ratings) => {
      if (live) {
        setRatings(next);
      }
    };

    void audit?.then(settle, () => settle(undefined));

    return () => {
      live = false;
    };
  }, [audit]);

  return ratings;
};
