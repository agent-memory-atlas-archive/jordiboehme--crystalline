/**
 * What every curio recipe shares (2.6b): the shape of a recipe, each
 * kind's blink bank, the sizes a recipe reads and the blockout every kind
 * starts as.
 *
 * A curio mesh is built like a hero's: once per kind, variant and look, at
 * the origin in `frameAt([0, 0, 0], 0)`, and drawn instanced, turned by the
 * instance's quarter turn and moved to its anchor on the GPU, where the
 * anchor's height is the surface it stands on (`Curio.h`). Every curio is
 * built centred on the origin, its base at `h` 0 and its front towards
 * `+d`, inside its catalogue size (`CURIO_CATALOGUE`); `curioHalf` gives
 * that box in the recipe's local terms, so no recipe repeats a catalogue
 * number. The one hovering kind (`CURIO_LIFT`, 2.6d C4) is built from its
 * lift up instead, so its lowest vertex is its lift over its surface.
 *
 * A curio's lights: a steady one uses `s.signal(tint)` (or `s.glow(tint)`
 * for a screen), a blinking one `s.blink(tint, group)`, whose bank is the
 * kind's `CURIO_BANK` entry (C16). The instance slot carries the bank, so
 * every group of a kind's lights pulses with that bank. A kind whose bank
 * is `steady` has no blink parts, and every other kind has at least one in
 * every variant (the curio test holds both).
 *
 * A mark on a face that looks up, where no quad can lie, is laid by
 * `flatText` as thin pieces of merged runs (`pixelRects`): the tape drive's
 * badge (`retro.ts`) and the office curios' prints (`office.ts`).
 *
 * Kept apart from `index.ts` so the batch files can import it without an
 * import cycle through the dispatcher. The batch files import only this
 * module, never each other.
 */

import { CURIO_CATALOGUE, curioLift } from "../../../world/curios";
import type { CurioKind } from "../../../world/types";
import type { BlinkBank } from "../../blink";
import type { Kit } from "../../kit";
import type { Look, Rgb } from "../../looks";
import type { KitAt, Surfaces } from "../common";
import { fit, pixelRuns, textRows } from "../heroes/pixels";

/**
 * One curio kind's recipe: builds `variant` of `kind` with `k` in
 * `frameAt([0, 0, 0], 0)`, centred on the origin. Pure in kind, variant
 * and look.
 */
export type CurioRecipe = (r: {
  k: Kit;
  kitAt: KitAt;
  s: Surfaces;
  look: Look;
  variant: number;
  kind: CurioKind;
}) => void;

/**
 * Each curio kind's blink bank (C16): the sword's blade and the pistol's
 * chamber breathe, the console's screen swaps between two pictures, the
 * meter's wing lights chase, the trap's and the radar's lights strobe,
 * the reactor case's core and the drone's eye breathe (2.6d C18), and
 * every other kind is steady.
 */
export const CURIO_BANK = {
  "light-sword": "breathe",
  "green-pistol": "breathe",
  "pink-gadget": "steady",
  "wing-meter": "chase",
  "pocket-console": "swap",
  "tape-drive": "steady",
  "tape-player": "steady",
  "video-tape": "steady",
  "beige-laptop": "steady",
  "star-ball": "steady",
  "catch-ball": "steady",
  "trap-box": "status",
  "fuel-case": "steady",
  "treasure-radar": "status",
  "capsule-case": "steady",
  "reactor-case": "breathe",
  "hover-drone": "breathe",
  "breadbin-computer": "steady",
  "slim-computer": "steady",
  "space-bricks": "steady",
  "soot-puffs": "steady",
  "floppy-disk": "steady",
  "pizza-box": "steady",
  "lottery-ticket": "steady",
} as const satisfies Record<CurioKind, BlinkBank>;

/**
 * A curio's half width, half depth, top and lift in the recipe's local
 * terms: its box runs `a` from `-hw` to `hw`, `d` from `-hd` to `hd` and
 * `h` from 0 to `top`, centred on the origin, and its mesh starts at
 * `lift` (`curioLift`: 0 but for the hovering drone, 2.6d C4). Read the
 * sizes from here, never repeat them in a recipe. Throws on a variant the
 * kind does not have.
 */
export function curioHalf(
  kind: CurioKind,
  variant: number,
): { hw: number; hd: number; top: number; lift: number } {
  const size = CURIO_CATALOGUE[kind].sizes[variant];
  if (size === undefined)
    throw new Error(`curioHalf: ${kind} has no variant ${String(variant)}`);
  return {
    hw: size.width / 2,
    hd: size.depth / 2,
    top: size.top,
    lift: curioLift(kind),
  };
}

/** The bevel of a curio blockout's box, in metres. */
const BLOCKOUT_BEVEL = 0.005;

/** A blinking blockout's cap: its side, in metres. */
const CAP_SIDE = 0.03;

/** A blinking blockout's cap: its height, in metres; the box stops this far under the top. */
const CAP_HEIGHT = 0.01;

/**
 * The blockout cap's colour: a plain warm white, a stand-in light that
 * belongs to no look and no finished model.
 */
const CAP_TINT: Rgb = [1.0, 0.92, 0.8];

/**
 * The blockout every curio starts as (like `heroBlockout`): one bevelled
 * box over its whole size from its lift up to its top, less `CAP_HEIGHT`
 * for a kind whose bank blinks, which gets a blink-group-0 cap sitting on
 * the box's top in the middle, so every check (glow contact, the bank
 * rule) runs on it from the start. The cap is `CAP_SIDE` square and
 * `CAP_HEIGHT` thick, so it ends exactly at the top.
 */
export const curioBlockout: CurioRecipe = ({ k, s, variant, kind }) => {
  const { hw, hd, top, lift } = curioHalf(kind, variant);
  const blinks = CURIO_BANK[kind] !== "steady";
  const h1 = blinks ? top - CAP_HEIGHT : top;
  k.bevelBox(-hw, hw, -hd, hd, lift, h1, BLOCKOUT_BEVEL, s.body);
  if (!blinks) return;
  const c = CAP_SIDE / 2;
  k.box(-c, c, -c, c, h1, top, s.blink(CAP_TINT, 0));
};

/** A rectangle of a pixel picture's lit cells: its first column, its top row, its width and its height in cells. */
export interface PixelRect {
  col: number;
  row: number;
  len: number;
  rows: number;
}

/**
 * A pixel picture's lit cells (`#`) as rectangles: each horizontal run of
 * `pixelRuns`, merged with the runs straight under it that start and end
 * in the same columns, so an upright stroke is one piece however tall.
 * Together they cover every lit cell exactly once. For a mark built from
 * boxes or slabs, which cost a dozen triangles a piece.
 */
export function pixelRects(rows: readonly string[]): PixelRect[] {
  const rects: PixelRect[] = [];
  for (const r of pixelRuns(rows)) {
    const above = rects.find(
      (x) => x.col === r.col && x.len === r.len && x.row + x.rows === r.row,
    );
    if (above) above.rows++;
    else rects.push({ ...r, rows: 1 });
  }
  return rects;
}

/**
 * Lays `text` flat on a face that looks up, fitted into `a0..a1` along
 * and `d0..d1` across with square pixels as large as both allow (`fit`),
 * centred: `lay` draws one rectangle of lit cells (`pixelRects`) from
 * `a0` to `a1` and `d0` to `d1`. The first row lies towards `-d`, so the
 * text reads from the curio's front (`+d`), left to right along `+a`.
 * Returns the pixel size, to hold to C13's 1 mm floor.
 */
export function flatText(
  text: string,
  box: readonly [a0: number, a1: number, d0: number, d1: number],
  lay: (a0: number, a1: number, d0: number, d1: number) => void,
): number {
  const rows = textRows(text);
  const { px, left } = fit(rows, ...box);
  const far = (box[2] + box[3]) / 2 - (rows.length * px) / 2;
  for (const r of pixelRects(rows))
    lay(
      left + r.col * px,
      left + (r.col + r.len) * px,
      far + r.row * px,
      far + (r.row + r.rows) * px,
    );
  return px;
}
