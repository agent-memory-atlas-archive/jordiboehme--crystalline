/**
 * The raster bars on the connecting screen's border: once the modems'
 * high tones start (`burstsAtMs` in `audio/modem.ts`), the light blue
 * around the panel fills with horizontal bars in the C64's sixteen
 * colours, scrolling down with a slow sway, the way a demo's border or a
 * tape loader's stripes run. The panel with the typed text is drawn over
 * them and stays as it is.
 *
 * One element carries the bars as a fixed gradient; a frame loop moves its
 * background position, so nothing re-renders at the frame rate. The loop
 * runs on `performance.now()` from the commit that shows the screen, the
 * clock `useC64Screen` starts in the same commit (its own `elapsed` stops
 * once the typing is done, so it cannot drive the bars). The loop and the
 * timer that turns the bars on stop when the screen goes.
 *
 * Their colours and their motion are in `raster.ts`, with why they never
 * flash. With `prefers-reduced-motion: reduce` the bars show still from
 * the same moment and no frame is requested. The bars are decoration,
 * hidden from a screen reader.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { BARS_IMAGE, CYCLE_PX, barsOffset } from "./raster";

/** Whether the viewer asked for less motion. */
function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The props of `RasterBars`. */
export interface RasterBarsProps {
  /** When the bars turn on, in milliseconds after the screen showed. */
  from: number;
}

/** The bars, filling their positioned parent. See the module doc. */
export function RasterBars({ from }: RasterBarsProps) {
  const [on, setOn] = useState(false);
  const bars = useRef<HTMLDivElement>(null);
  const started = useRef(0);

  // In the commit that shows the screen, on the clock the typing reads.
  useLayoutEffect(() => {
    started.current = performance.now();
    const timer = setTimeout(() => {
      setOn(true);
    }, from);
    return () => {
      clearTimeout(timer);
    };
  }, [from]);

  useEffect(() => {
    const el = bars.current;
    if (!on || el === null || reducedMotion()) return;
    let frame = 0;
    const draw = () => {
      const ms = performance.now() - started.current - from;
      el.style.backgroundPosition = `0 ${barsOffset(ms) % CYCLE_PX}px`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [on, from]);

  if (!on) return null;
  return (
    <div
      ref={bars}
      aria-hidden
      data-raster-bars=""
      className="absolute inset-0"
      style={{
        backgroundImage: BARS_IMAGE,
        backgroundSize: `100% ${CYCLE_PX}px`,
        backgroundPosition: "0 0",
      }}
    />
  );
}
