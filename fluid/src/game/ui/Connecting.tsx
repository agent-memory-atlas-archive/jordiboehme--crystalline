/**
 * The connecting screen: the station dialling in when it starts (M4 C26).
 *
 * A full-screen C64 frame in the device refusal's colours types out, at
 * `TYPE_CPS` characters a second, the dial command with the number, the
 * modem's answer and the name of the place dialled into, while the
 * director plays the dial-in (`audio/modem.ts`). It is done (`onDone`)
 * after `HANDSHAKE_MS`, or at once on any key or click; the host then cuts
 * the sound and hands the station its keys back. The frame, the
 * typing clock, the focus and the skip (a browser's shortcut is left
 * alone) are shared with the opening (`c64Clock.ts`, `c64Screen.tsx`).
 *
 * The host clears `busy` inside `onDone`, and the `preventDefault` on the
 * key taken is what keeps an Esc that skips this screen from also pausing
 * the station behind it.
 *
 * The typing runs on `performance.now()`, the station's own clock, so a
 * wall clock set back or stepped forward neither stalls the lines nor
 * prints them all at once. The screen takes the focus when it shows and
 * gives it back to what had it when it goes. A screen reader hears each
 * line once it is typed out: the typed characters are hidden from it, and
 * a polite live region, mounted empty with the screen, is handed every
 * whole line.
 */

import { useRef } from "react";

import { HANDSHAKE_MS } from "../audio/modem";
import { TYPE_CPS, typedCount, useC64Screen } from "./c64Clock";
import { C64Screen } from "./c64Screen";

export { TYPE_CPS };

/** The screen's accessible name. */
export const CONNECTING_LABEL = "Connecting";

/** The props of `Connecting`. */
export interface ConnectingProps {
  /** The number dialled (`dialNumber`). */
  number: string;
  /** The name of the place dialled into, upper-cased by the host. */
  name: string;
  /** The screen is done: its time ran out, or a key or a click skipped it. */
  onDone: () => void;
}

/** The screen. See the module doc. */
export function Connecting({ number, name, onDone }: ConnectingProps) {
  const lines = [`ATDT ${number}`, "CONNECT 2400", name];
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  const dialog = useRef<HTMLDivElement>(null);
  const elapsed = useC64Screen(
    dialog,
    onDone,
    HANDSHAKE_MS,
    (total * 1000) / TYPE_CPS,
  );

  let left = Math.min(typedCount(elapsed), total);
  const shown = lines.map((line) => {
    const part = line.slice(0, Math.max(0, left));
    left -= line.length;
    return part;
  });
  const whole = lines.filter((line, i) => shown[i] === line);

  return (
    <C64Screen
      label={CONNECTING_LABEL}
      dialog={dialog}
      announce={whole.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    >
      {shown.map((part, i) => (
        <p key={i} className="min-h-[1.75rem]">
          {part}
        </p>
      ))}
    </C64Screen>
  );
}
