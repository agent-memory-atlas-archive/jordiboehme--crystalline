/**
 * The loading state every screen shows: a terminal-style block in the app's
 * muted ink, shown at once (no delay) where the content will land.
 *
 *     SEARCHING FOR <WHAT THE SCREEN KNOWS>
 *     LOADING
 *     █
 *
 * Screen readers get one plain sentence (`label`) on the status region and
 * nothing of the caps text. The compact variant is one line, `LOADING█`, for
 * menus and lists. When a full loader goes away because the content
 * arrived, {@link ReadyFlash} (drawn once by the layout) lays `READY.` over
 * the content area for a moment; a result already in the cache never mounts
 * a loader, so it shows neither.
 */

import { useEffect, useState } from "react";

import { loaderShown, onLoadingEvent } from "../loadingSignal";

/** How long READY. stays before it is gone, in milliseconds. */
export const READY_MS = 400;

const INK = "font-mono text-sm uppercase tracking-wide text-muted";

function Cursor() {
  return (
    <span aria-hidden className="loading-cursor">
      {"█"}
    </span>
  );
}

export function Loading({
  label,
  subject,
  compact = false,
  className = "",
}: {
  /** The plain sentence a screen reader hears, e.g. "Loading the engram". */
  label: string;
  /** What the first line searches for: a title, a query, a path. */
  subject?: string;
  /** One line, `LOADING█`, for a menu or a list. Never flashes READY. */
  compact?: boolean;
  className?: string;
}) {
  useEffect(() => (compact ? undefined : loaderShown()), [compact]);
  if (compact) {
    return (
      <p
        role="status"
        aria-busy="true"
        aria-label={label}
        data-loading="compact"
        className={`${INK} ${className}`}
      >
        <span aria-hidden>
          {"LOADING"}
          <Cursor />
        </span>
      </p>
    );
  }
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-loading="full"
      className={`${INK} py-3 ${className}`}
    >
      <div aria-hidden>
        <p className="truncate">
          {`SEARCHING FOR ${(subject ?? "").trim().toUpperCase()}`.trimEnd()}
        </p>
        <p>{"LOADING"}</p>
        <p>
          <Cursor />
        </p>
      </div>
    </div>
  );
}

/**
 * READY., laid over the top of the content area for {@link READY_MS} after a
 * full loader gave way to content. Absolute, so the layout never moves, and
 * hidden from screen readers. Drawn once, by the layout, inside a
 * positioned container.
 */
export function ReadyFlash() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onLoadingEvent((event) => {
      clearTimeout(timer);
      if (event === "busy") {
        setVisible(false);
        return;
      }
      setVisible(true);
      timer = setTimeout(() => {
        setVisible(false);
      }, READY_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);
  if (!visible) {
    return null;
  }
  return (
    <p
      aria-hidden
      data-ready-flash
      className={`ready-flash pointer-events-none absolute left-0 top-0 z-10 bg-canvas px-1 ${INK}`}
    >
      {"READY."}
    </p>
  );
}
