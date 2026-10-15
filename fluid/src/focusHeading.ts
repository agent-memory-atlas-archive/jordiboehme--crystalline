/**
 * Focus for a screen reached by an action rather than a link: after a delete
 * or a move the page the person was on is gone, and the frame's own focus
 * lands on the whole main region. The action navigates with
 * {@link FOCUS_HEADING} in the location state, and the destination, once it
 * has drawn its heading, moves focus there.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

export const FOCUS_HEADING = { focusHeading: true } as const;

/** Make the page's first-level heading the focused element. */
export function focusPageHeading(): void {
  const heading = document.querySelector("main h1");
  if (heading instanceof HTMLElement) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

/**
 * `ready` is true once the screen has drawn its heading. The focus is
 * deferred one tick: the frame moves focus to the main region in an effect of
 * its own on every route change, which runs after this screen's.
 */
export function useHeadingFocusRequest(ready: boolean): void {
  const { state, key } = useLocation() as {
    state: { focusHeading?: boolean } | null;
    key: string;
  };
  const done = useRef<string | null>(null);
  const wanted = state?.focusHeading === true;
  useEffect(() => {
    if (!ready || !wanted || done.current === key) {
      return;
    }
    const timer = setTimeout(() => {
      done.current = key;
      focusPageHeading();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [ready, wanted, key]);
}
