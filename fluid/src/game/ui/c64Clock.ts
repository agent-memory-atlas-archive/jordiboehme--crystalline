/**
 * What the full-screen C64 screens share: the frame, the typing clock, the
 * focus and the skip on any key or click. `Connecting` and `Opening` are
 * both built on it.
 *
 * The listeners are on `window` in the capture phase, so they run before
 * the session's own Esc listener whatever order they were added in (C9),
 * and are added in the commit that shows the screen, so the first key
 * already skips it. A browser's shortcut (a key held with Ctrl, Cmd or
 * Alt, or F1 to F12) is left to the browser: it neither skips the screen
 * nor is cancelled; the auto-repeat of a held key is cancelled but does
 * not skip it. The typing runs on `performance.now()`, the station's
 * own clock, so a wall clock set back or stepped forward neither stalls
 * the lines nor prints them all at once. The screen takes the focus when
 * it shows and gives it back to what had it when it goes.
 */

import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** How fast the lines are typed out, in characters a second. */
export const TYPE_CPS = 30;

/** A function key: F1 to F12 (a reload, the developer tools, full screen). */
const FUNCTION_KEY = /^F([1-9]|1[0-2])$/;

/**
 * A browser's key, left alone: one held with Ctrl, Cmd or Alt, or a
 * function key. It neither skips the screen nor is cancelled.
 */
export function isShortcut(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    FUNCTION_KEY.test(event.code)
  );
}

/** The characters of a typing that has run for `elapsedMs`. */
export function typedCount(elapsedMs: number): number {
  // The epsilon keeps a clock that lands on a whole character from
  // rounding down through float error.
  return Math.floor((elapsedMs * TYPE_CPS) / 1000 + 1e-6);
}

/**
 * The screen's behaviour. Returns the milliseconds elapsed since it showed,
 * refreshed at the typing rate until `tickMs`. `onDone` is called once,
 * after `endMs` or at once on any key or click.
 */
export function useC64Screen(
  dialog: RefObject<HTMLDivElement | null>,
  onDone: () => void,
  endMs: number,
  tickMs: number,
): number {
  const [elapsed, setElapsed] = useState(0);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  // In the commit that shows it, so no key lands before it has the focus.
  useLayoutEffect(() => {
    const before = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (before instanceof HTMLElement && before !== document.body) {
        if (before.isConnected) before.focus();
      }
    };
  }, [dialog]);

  // In the commit that shows it too, so the first key already skips it.
  useLayoutEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      doneRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (isShortcut(event)) return;
      event.preventDefault();
      // A key still held from before the screen showed would skip it with
      // its auto-repeat; only a fresh press does.
      if (event.repeat) return;
      finish();
    };
    const onClick = () => {
      finish();
    };
    const started = performance.now();
    const ticking = setInterval(() => {
      const now = performance.now() - started;
      setElapsed(Math.min(now, tickMs));
      if (now >= tickMs) clearInterval(ticking);
    }, 1000 / TYPE_CPS);
    const timer = setTimeout(finish, endMs);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("click", onClick, true);
    return () => {
      done = true;
      clearInterval(ticking);
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", onClick, true);
    };
  }, [endMs, tickMs]);

  return elapsed;
}
