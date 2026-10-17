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

/**
 * Make the page's first-level heading the focused element. False when the
 * screen has not drawn one yet.
 */
export function focusPageHeading(): boolean {
  const heading = document.querySelector("main h1");
  if (!(heading instanceof HTMLElement)) {
    return false;
  }
  heading.tabIndex = -1;
  heading.focus();
  return true;
}

/**
 * `ready` is true once the screen has drawn its heading. The frame's own
 * route-change focus on the main region stands aside for a location that
 * carries {@link FOCUS_HEADING} (`RouteFocus` in `Layout.tsx`), so the two do
 * not race.
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
    if (focusPageHeading()) {
      done.current = key;
      return;
    }
    // The page's own heading can come from a part that is still loading;
    // wait for it to be drawn rather than give up.
    const watch = new MutationObserver(() => {
      if (focusPageHeading()) {
        done.current = key;
        watch.disconnect();
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
    };
  }, [ready, wanted, key]);
}
