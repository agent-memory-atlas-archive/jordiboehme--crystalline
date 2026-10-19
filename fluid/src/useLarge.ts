/** Whether the window is at Tailwind's `lg` or wider (the engram rail is a column). */

import { useSyncExternalStore } from "react";

const LARGE_QUERY = "(min-width: 64rem)";

function largeNow(): boolean {
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia(LARGE_QUERY).matches
  );
}

function subscribeLarge(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia(LARGE_QUERY);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

export function useLarge(): boolean {
  return useSyncExternalStore(subscribeLarge, largeNow);
}
