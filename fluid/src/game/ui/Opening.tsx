/**
 * The opening question, before the connecting screen (spec D-10).
 *
 * The same full-screen C64 frame as the connecting screen (`c64Screen.tsx`)
 * types one line out, at `TYPE_CPS` characters a second, with a block
 * cursor; once it is typed the cursor blinks `OPENING_BLINKS` times and
 * the screen is done (`onDone`). A key or a click skips it at once; a
 * browser's shortcut is left to the browser. It makes no sound: the dial-in
 * starts when the connecting screen shows.
 *
 * A screen reader hears the whole line once it is typed: the typed
 * characters are hidden from it and a polite live region, mounted empty
 * with the screen, is handed the line.
 */

import { useRef } from "react";

import { TYPE_CPS, typedCount, useC64Screen } from "./c64Clock";
import { C64Screen } from "./c64Screen";

/** The screen's accessible name. */
export const OPENING_LABEL = "Opening";

/** The line typed out. */
export const OPENING_TEXT = "SHALL WE PLAY A GAME?";

/** How often the cursor blinks once the line is typed. */
export const OPENING_BLINKS = 3;

/** How long the cursor stays on, and then off, in milliseconds. */
export const BLINK_MS = 400;

/** When the line is typed out, in milliseconds. */
const TYPED_MS = (OPENING_TEXT.length * 1000) / TYPE_CPS;

/** When the screen is done: the line typed and the blinks over. */
const END_MS = TYPED_MS + OPENING_BLINKS * 2 * BLINK_MS;

/** The props of `Opening`. */
export interface OpeningProps {
  /** The screen is done: its blinks are over, or a key or a click skipped it. */
  onDone: () => void;
}

/** The screen. See the module doc. */
export function Opening({ onDone }: OpeningProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const elapsed = useC64Screen(dialog, onDone, END_MS, END_MS);
  const count = Math.min(typedCount(elapsed), OPENING_TEXT.length);
  const typed = count >= OPENING_TEXT.length;
  // Solid while typing; then on for BLINK_MS, off for BLINK_MS, in turn.
  const cursorOn =
    !typed || Math.floor((elapsed - TYPED_MS) / BLINK_MS) % 2 === 0;

  return (
    <C64Screen
      label={OPENING_LABEL}
      dialog={dialog}
      announce={typed ? <p>{OPENING_TEXT}</p> : null}
    >
      <p className="min-h-[1.75rem]">
        {OPENING_TEXT.slice(0, count)}
        <span data-cursor={cursorOn ? "on" : "off"}>
          {cursorOn ? "█" : " "}
        </span>
      </p>
    </C64Screen>
  );
}
