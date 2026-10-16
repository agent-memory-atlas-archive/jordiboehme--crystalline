/**
 * Whether the window is at Tailwind's `md` or wider, read from the same
 * breakpoint the stylesheet uses. Shared by the frame and the avatar menu.
 */

import { useSyncExternalStore } from "react";

/** Tailwind's `md`, which is where the sidebar stops being a drawer. */
const WIDE_QUERY = "(min-width: 48rem)";

/** Whether there is a column beside the reading surface at all. */
function wideNow(): boolean {
  // An environment with no media queries to ask - jsdom, an old embedded view -
  // is answered the way the stylesheet's own default answers it, which is the
  // desktop frame; below `md` the sheet takes the sidebar over anyway.
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia(WIDE_QUERY).matches
  );
}

/**
 * Whether the frame is wide enough to have a sidebar rather than a drawer.
 *
 * The rail is a choice about a column that only exists from `md` up. Below it
 * the sidebar is a drawer the top bar opens over the screen, and a stored rail
 * applied there would be three faults at once: a three-rem strip of icons
 * where a full-width drawer belongs, a way out of it that the stylesheet hides
 * (`hidden md:inline-flex`) so the keyboard handoff lands on nothing, and two
 * disclosures of one sidebar disagreeing about whether it is open. Gating the
 * rail on the same breakpoint the stylesheet uses closes all three, because
 * below it there is only ever the expanded drawer.
 */
export function useWide(): boolean {
  // Subscribed rather than held in state: the width of the window is somebody
  // else's value, and React reads it on every render it does, so a window
  // resized between a render and the effect that would have caught it cannot
  // leave a stale answer behind.
  return useSyncExternalStore(subscribeWide, wideNow);
}

/** Watch the breakpoint, where there is anything to watch it with. */
function subscribeWide(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}
