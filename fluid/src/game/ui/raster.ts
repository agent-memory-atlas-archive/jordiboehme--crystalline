/**
 * What the connecting screen's raster bars look like and how they move
 * (`RasterBars.tsx` draws them): bars in the C64's sixteen colours, run
 * from dark to light and back, scrolling down with a slow sway.
 *
 * Photosensitivity: the bars are thin and the palette runs from black to
 * white and back over `CYCLE_PX`, so a point of the border goes from dark
 * to light and back less than once a second and the screen as a whole
 * never flashes (WCAG 2.3.1).
 */

/** The C64's sixteen colours, in the machine's own order (Pepto). */
export const C64_PALETTE = [
  "#000000", // black
  "#ffffff", // white
  "#68372b", // red
  "#70a4b2", // cyan
  "#6f3d86", // purple
  "#588d43", // green
  "#352879", // blue
  "#b8c76f", // yellow
  "#6f4f25", // orange
  "#433900", // brown
  "#9a6759", // light red
  "#444444", // dark grey
  "#6c6c6c", // grey
  "#9ad284", // light green
  "#6c5eb5", // light blue
  "#959595", // light grey
] as const;

/**
 * The palette from dark to light, by index into `C64_PALETTE`. The bars
 * run up this ramp and back down, so neighbouring bars are close in
 * brightness and no line jumps from black to white.
 */
const RAMP = [0, 6, 9, 2, 11, 4, 8, 12, 14, 5, 10, 3, 15, 7, 13, 1];

/** One bar's height, in pixels. */
export const BAR_PX = 6;

/** The bars of one cycle: up the ramp and back down, no colour doubled. */
const CYCLE = [...RAMP, ...RAMP.slice(1, -1).reverse()];

/** One cycle's height, in pixels. */
export const CYCLE_PX = CYCLE.length * BAR_PX;

/** How fast the bars scroll down, in pixels a second. */
const SPEED_PX_S = 90;

/** The sway over the scroll: its reach in pixels and its rate in hertz. */
const SWAY_PX = 24;
const SWAY_HZ = 0.5;

/** The bars as one gradient, hard stops between the colours. */
export const BARS_IMAGE = `linear-gradient(to bottom, ${CYCLE.map(
  (index, i) => {
    const colour = C64_PALETTE[index] as string;
    return `${colour} ${i * BAR_PX}px ${(i + 1) * BAR_PX}px`;
  },
).join(", ")})`;

/**
 * Where the bars stand `ms` after they turned on, in pixels down. The
 * sway never outruns the scroll, so the bars never turn back.
 */
export function barsOffset(ms: number): number {
  const s = ms / 1000;
  return SPEED_PX_S * s + SWAY_PX * Math.sin(2 * Math.PI * SWAY_HZ * s);
}
