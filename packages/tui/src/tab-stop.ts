import { useEffect, type RefObject } from "react";

/** The part of a tuiparts group (CheckboxGroup, RadioGroup) that owns its roving tab stop. */
export interface TabStopGroup {
  readonly store: {
    focusTabStop(): boolean;
    subscribe(listener: () => void): () => void;
  };
}

/**
 * Focus a tuiparts group's tab stop once it has one. OpenTUI has no automatic focus traversal, and
 * the group's items register after the first commit, so the first attempt can come too early.
 */
export const useInitialTabStop = (group: RefObject<TabStopGroup | null>) => {
  useEffect(() => {
    const store = group.current?.store;

    if (store === undefined || store.focusTabStop()) {
      return undefined;
    }

    let focused = false;

    return store.subscribe(() => {
      focused ||= store.focusTabStop();
    });
  }, [group]);
};
