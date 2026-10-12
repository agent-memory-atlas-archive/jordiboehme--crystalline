/**
 * The tool maker's mark plate (0.25.1): a small near-black field quad with
 * the mark set on it in red block capitals. The tool board's top rail, the
 * tool cart's top drawer front, the workbench machine and the gun bench's
 * pegboard all lay it through `toolPlate`, so every tool-like model wears
 * the same mark, read from the front. The text is `MARKS.toolMark` and the
 * colours `TOOL_MARK`; nothing here spells a string.
 */

import type { Kit } from "../kit";
import type { Surfaces } from "./common";
import { MARK_PROUD, markLines } from "./heroes/pixels";
import { MARKS, TOOL_MARK } from "./marks";

/**
 * Lays the mark plate over `a0..a1` by `h0..h1` at depth `d` (the plate
 * faces `+d`): the field quad, then the mark inside it
 * `lift` proud (a plate that must clear the decal rule of a wall fixture
 * passes `DECAL_LIFT`), its square pixels as large as a small margin leaves. Returns the
 * pixel size.
 */
export function toolPlate(
  k: Kit,
  s: Surfaces,
  [a0, a1, h0, h1]: readonly [number, number, number, number],
  d: number,
  lift: number = MARK_PROUD,
): number {
  k.panel(a0, a1, d, h0, h1, s.tinted(TOOL_MARK.field));
  const padA = (a1 - a0) * 0.04;
  const padH = (h1 - h0) * 0.1;
  return markLines(
    k,
    MARKS.toolMark,
    [a0 + padA, a1 - padA, h0 + padH, h1 - padH],
    d + lift,
    s.tinted(TOOL_MARK.ink),
  );
}
