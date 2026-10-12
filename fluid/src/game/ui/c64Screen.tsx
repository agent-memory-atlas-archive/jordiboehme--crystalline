/**
 * The frame the full-screen C64 screens share: a light blue screen, the
 * blue panel for the typed text (hidden from a screen reader) and a polite
 * live region. The typing clock, the focus and the skip are in
 * `c64Clock.ts`. `Connecting` and `Opening` are both built on it; only
 * `Connecting` asks for the raster bars on the border (`RasterBars`), so
 * the panel is positioned to stay drawn over them.
 */

import type { ReactNode, RefObject } from "react";

import { C64_BLUE, C64_LIGHT_BLUE, C64_TEXT } from "./DeviceRefusal";
import { RasterBars } from "./RasterBars";

/** The props of `C64Screen`. */
export interface C64ScreenProps {
  /** The screen's accessible name. */
  label: string;
  dialog: RefObject<HTMLDivElement | null>;
  /** The typed text, hidden from a screen reader. */
  children: ReactNode;
  /** What the polite live region is handed; it is mounted empty. */
  announce: ReactNode;
  /**
   * When the border turns to raster bars, in milliseconds after the screen
   * showed; a plain light blue border when absent.
   */
  barsFrom?: number;
}

/**
 * The frame: a light blue screen, the blue panel, the live region, and
 * the raster bars when `barsFrom` is given.
 */
export function C64Screen({
  label,
  dialog,
  children,
  announce,
  barsFrom,
}: C64ScreenProps) {
  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-8 font-mono text-lg uppercase outline-none"
      style={{ background: C64_LIGHT_BLUE }}
    >
      {barsFrom !== undefined && <RasterBars from={barsFrom} />}
      <div
        aria-hidden
        className="relative w-full max-w-2xl p-8"
        style={{ background: C64_BLUE, color: C64_TEXT }}
      >
        {children}
      </div>
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
    </div>
  );
}
