/**
 * The gear exhibits: small machines from home, each built at its true
 * size and shown on an exhibit piece of its own, which together make the
 * hero. Their lights are on the `breathe` bank and nothing on them moves.
 *
 * - The turntable is the classic silver direct-drive record deck at its
 *   true size (`DECK`), standing on a waist-high black DJ table
 *   (`TABLE`) with a crate of record sleeves on the table's lower shelf.
 *   The deck's black rubber base carries the silver die-cast top on four
 *   round feet. On its left half turns (but here stands still) the
 *   platter with its rows of strobe dots round the rim (`STROBE_ROWS`),
 *   the black rubber mat and one record on it, its red label and the
 *   spindle. At the back right stands the tonearm (`ARM`): its round base
 *   with the height ring, the gimbal, the S-shaped tube in three straight
 *   pieces resting on its arm rest, the headshell with the cartridge at
 *   its front end and the counterweight behind the pivot, with the cueing
 *   lever beside it. In the front left corner sit the power knob with the
 *   strobe lamp behind it, the large start/stop button and the 33 and 45
 *   buttons; down the right edge runs the pitch slider, its green lock
 *   light beside its middle. Two dust-cover hinges stand at the back. The
 *   maker's name lies flat in the top's back left corner (`DECK_MARK`),
 *   reading from the front. The strobe lamp (group 0) and the lock light
 *   (group 1) breathe.
 * - The camera is the black rangefinder-style mirrorless camera at its
 *   true size (`CAMERA`), on a tripod at eye height, the tripod's three
 *   legs standing on a low white round plinth like a museum piece. Its
 *   lens points at the room (`+d`): a short fast prime (`LENS`) with its
 *   mount, aperture ring, focus ring and round hood, set low and a little
 *   left on the flat-topped body. The body is a black top plate over the
 *   leatherette front, with the short grip at the front's left; the large
 *   optical viewfinder window sits in the top plate's right corner, the
 *   small frame window and the viewfinder lever below it and the square
 *   focus assist lamp beside them. On top stand the exposure dial, the
 *   shutter button in its collar with its thread, the shutter speed dial
 *   and the hot shoe; at the back the screen and the eyepiece. The
 *   maker's name runs across the top plate's front, left of the window
 *   (`CAMERA_MARK`). The tripod (`TRIPOD`): its centre column through the
 *   spider, a pan head with its tilt block, plate and handle, and three
 *   legs of two sections each. The focus assist lamp (group 0) breathes.
 *
 * The numbers each kind is built to are named above its recipe. Round
 * parts use few facets, as in every batch.
 */

import type { HeroKind } from "../../../world/types";
import { frameAt, type Frame, type Kit } from "../../kit";
import type { Rgb } from "../../looks";
import { sideways, tiltedBar, yawed, type Surfaces } from "../common";
import { MARKS } from "../marks";
import { STATUS_GREEN, heroHalf, type HeroRecipe } from "./common";
import { MARK_PROUD, fit, pixelBoxes, pixelRuns, textRows } from "./pixels";

/** The recipe's own frame: the origin, facing north. */
const ORIGIN: Frame = frameAt([0, 0, 0], 0);

/** The DJ table's black laminate, its legs and its shelf. */
const TABLE_BLACK: Rgb = [0.07, 0.07, 0.08];

/** The deck's silver-grey die-cast top. */
export const DECK_SILVER: Rgb = [0.62, 0.63, 0.65];

/** The deck's black rubber base and its feet. */
const DECK_RUBBER: Rgb = [0.06, 0.06, 0.065];

/** The platter's polished rim, a little brighter than the top. */
const PLATTER_SILVER: Rgb = [0.74, 0.75, 0.77];

/** The strobe dots on the rim: a dark gap colour against the bright rim. */
export const STROBE_DOT: Rgb = [0.2, 0.2, 0.22];

/** The rubber mat. */
const MAT_BLACK: Rgb = [0.04, 0.04, 0.045];

/** The record: a glossy black with a faint blue cast. */
const VINYL: Rgb = [0.05, 0.05, 0.07];

/** The record's paper label. */
const LABEL_RED: Rgb = [0.75, 0.12, 0.1];

/** The buttons, the slider's slot, the hinges and the gimbal: dark grey. */
const DECK_DARK: Rgb = [0.15, 0.15, 0.16];

/** The strobe lamp: the small orange-red lamp that lights the dots. */
export const STROBE_LAMP: Rgb = [1.0, 0.35, 0.12];

/** The maker's name on the top: black on the silver. */
export const DECK_INK: Rgb = [0.03, 0.03, 0.035];

/**
 * The record sleeves in the crate, front to back: worn printed cardboard
 * in a spread of muted colours, so the row reads as many records.
 */
const SLEEVES: readonly Rgb[] = [
  [0.85, 0.82, 0.74],
  [0.18, 0.32, 0.55],
  [0.7, 0.2, 0.15],
  [0.12, 0.12, 0.12],
  [0.85, 0.6, 0.15],
  [0.3, 0.5, 0.3],
  [0.55, 0.4, 0.6],
  [0.9, 0.9, 0.88],
  [0.25, 0.2, 0.18],
  [0.2, 0.55, 0.6],
];

/** The crate: a pale wood. */
const CRATE_WOOD: Rgb = [0.62, 0.48, 0.3];

/**
 * The DJ table, in metres: its top from `h0` to `top`, a black slab over
 * the whole footprint; four square legs `leg` wide, set `inset` in from
 * the edges; the lower shelf from `shelf[0]` to `shelf[1]`.
 */
export const TABLE = {
  h0: 0.82,
  top: 0.86,
  leg: 0.04,
  inset: 0.01,
  shelf: [0.12, 0.14],
} as const;

/**
 * The deck, in metres, at its true size (453 by 360 by 162 mm): `w` along
 * `a` and `d` deep, centred on the table. `feet` the round feet's height
 * and radius, `base` the rubber base's top over the feet, `plate` the
 * silver top over the table (the top face the parts stand on), `bevel`
 * the silver top's bevel, inside which its face is flat.
 */
export const DECK = {
  w: 0.453,
  d: 0.36,
  feet: { h: 0.018, r: 0.033 },
  base: 0.045,
  plate: 0.093,
  bevel: 0.006,
} as const;

/**
 * The platter: its centre `(a, d)` on the deck's left half (14 mm in from
 * the left edge), radius `r` (332 mm across), standing `rise` over the
 * top; the mat `mat` thick and `matR` wide; the record `vinyl` thick,
 * `vinylR` wide, its label `labelR`; the spindle `spindle` tall.
 */
export const PLATTER = {
  a: -0.035,
  d: 0,
  r: 0.166,
  rise: 0.025,
  mat: 0.005,
  matR: 0.16,
  vinyl: 0.002,
  vinylR: 0.1505,
  labelR: 0.05,
  spindle: 0.012,
} as const;

/**
 * The strobe dots round the platter's rim, one row each: how many dots,
 * their centre height under the rim's top and their height. Two rows of
 * different pitch, as the rim's speed rows are.
 */
export const STROBE_ROWS: readonly { n: number; h: number; tall: number }[] = [
  { n: 36, h: 0.006, tall: 0.004 },
  { n: 40, h: 0.013, tall: 0.004 },
];

/** How far a strobe dot stands out of the rim, and its width. */
const DOT = { out: 0.0015, w: 0.006 } as const;

/**
 * The tonearm, in the deck's top terms: its pivot `(a, d)` 215 mm from
 * the spindle at the back right, the tube's axis `axis` over the top and
 * its radius; the S-shaped tube's points in plan from the pivot to the
 * headshell's root (`tube`), the headshell's tip (`tip`), the arm rest
 * under the tube at `rest`, and the counterweight's span behind the
 * pivot along `d` and its radius.
 */
export const ARM = {
  pivot: [0.155, -0.1],
  axis: 0.04,
  r: 0.004,
  tube: [
    [0.155, -0.1],
    [0.165, -0.01],
    [0.15, 0.075],
    [0.155, 0.125],
  ],
  tip: [0.137, 0.168],
  rest: [0.15, 0.075],
  weight: { d0: -0.125, d1: -0.17, r: 0.02 },
} as const;

/** The pitch slider down the right edge: its slot and its knob. */
const PITCH = {
  a: 0.205,
  slot: [-0.005, 0.155],
  knob: [0.07, 0.086],
  light: [0.188, 0.078],
} as const;

/**
 * The maker's name in the top's back left corner: the box it is fitted
 * in, `[a0, a1, d0, d1]` on the top, clear of the platter and inside the
 * top's flat face, off its bevel (`DECK.bevel`).
 */
export const DECK_MARK = [-0.22, -0.125, -0.172, -0.156] as const;

/**
 * Lays `text` flat on a face that looks up at height `h`, fitted into
 * `[a0, a1, d0, d1]` with square pixels: one thin box `MARK_PROUD` thick
 * per lit run, its first row towards `-d`, so it reads from the front
 * (`+d`) left to right along `+a`. A frame cannot tilt, so no quad can
 * face up. Returns the pixel size.
 */
function flatMark(
  k: Kit,
  text: string,
  box: readonly [number, number, number, number],
  h: number,
  ink: ReturnType<Surfaces["tinted"]>,
): number {
  const rows = textRows(text);
  const [a0, a1, d0, d1] = box;
  const { px, left } = fit(rows, a0, a1, d0, d1);
  const far = (d0 + d1) / 2 - (rows.length * px) / 2;
  for (const r of pixelRuns(rows))
    k.box(
      left + r.col * px,
      left + (r.col + r.len) * px,
      far + r.row * px,
      far + (r.row + 1) * px,
      h,
      h + MARK_PROUD,
      ink,
    );
  return px;
}

/**
 * The DJ table: the top slab, four legs and the lower shelf, with the
 * crate of sleeves standing on the shelf's right half.
 */
function djTable(k: Kit, s: Surfaces, hw: number, d0: number, d1: number) {
  const black = s.tinted(TABLE_BLACK);
  const t = TABLE;
  k.bevelBox(-hw, hw, d0, d1, t.h0, t.top, 0.008, black);
  const [l0, l1] = [-hw + t.inset, hw - t.inset - t.leg];
  const [e0, e1] = [d0 + t.inset, d1 - t.inset - t.leg];
  for (const a of [l0, l1])
    for (const d of [e0, e1]) k.box(a, a + t.leg, d, d + t.leg, 0, t.h0, black);
  k.box(l0, l1 + t.leg, e0, e1 + t.leg, t.shelf[0], t.shelf[1], black);

  // The crate: a floor and four walls, the sleeves standing in it front
  // to back, a little taller than its walls.
  const wood = s.tinted(CRATE_WOOD);
  const [c0, c1, cd0, cd1] = [0.0, 0.34, -0.17, 0.17];
  const floor = t.shelf[1];
  const wall = 0.012;
  const rim = floor + 0.29;
  k.box(c0, c1, cd0, cd1, floor, floor + wall, wood);
  k.box(c0, c0 + wall, cd0, cd1, floor + wall, rim, wood);
  k.box(c1 - wall, c1, cd0, cd1, floor + wall, rim, wood);
  k.box(c0 + wall, c1 - wall, cd0, cd0 + wall, floor + wall, rim, wood);
  k.box(c0 + wall, c1 - wall, cd1 - wall, cd1, floor + wall, rim, wood);
  const step = (cd1 - cd0 - 2 * wall) / SLEEVES.length;
  SLEEVES.forEach((tint, i) => {
    const d = cd0 + wall + step * (i + 0.5);
    k.box(
      c0 + wall + 0.004,
      c1 - wall - 0.004,
      d - 0.002,
      d + 0.002,
      floor + wall,
      floor + wall + 0.31,
      s.tinted(tint),
    );
  });
}

/**
 * The turntable on its DJ table: the table with its crate; on its top the
 * deck's feet, its rubber base and silver top, the platter with its
 * strobe dots, the mat, the record and the spindle; the tonearm on its
 * base with the counterweight, the arm rest and the cueing lever; the
 * power knob with the strobe lamp, the start/stop and the speed buttons;
 * the pitch slider with its lock light; the hinges; and the maker's name.
 */
const turntable: HeroRecipe = ({ k, kitAt, s, variant, kind }) => {
  const { hw, d0, d1 } = heroHalf(kind, variant);
  djTable(k, s, hw, d0, d1);

  const T = TABLE.top;
  const P = T + DECK.plate;
  const [w, dd] = [DECK.w / 2, DECK.d / 2];
  const rubber = s.tinted(DECK_RUBBER);
  const silver = s.tinted(DECK_SILVER);
  const dark = s.tinted(DECK_DARK);

  // The feet, the rubber base and the silver top.
  const f = DECK.feet;
  for (const a of [-1, 1])
    for (const d of [-1, 1])
      k.cylinder(a * (w - 0.04), d * (dd - 0.04), T, T + f.h, f.r, 12, rubber);
  k.bevelBox(-w, w, -dd, dd, T + f.h, T + DECK.base, 0.004, rubber);
  k.bevelBox(-w, w, -dd, dd, T + DECK.base, P, DECK.bevel, silver);

  // The platter, its strobe dots, the mat, the record and the spindle.
  const p = PLATTER;
  const rimTop = P + p.rise;
  k.cylinder(p.a, p.d, P - 0.004, rimTop, p.r, 32, s.tinted(PLATTER_SILVER));
  const dots = s.tinted(STROBE_DOT);
  for (const row of STROBE_ROWS)
    for (let i = 0; i < row.n; i++) {
      const turn = ((i + (row.n % 2 === 0 ? 0.5 : 0)) * 2 * Math.PI) / row.n;
      const dk = kitAt(yawed(ORIGIN, p.a, p.d, turn));
      const h = rimTop - row.h;
      dk.box(
        -DOT.w / 2,
        DOT.w / 2,
        p.r - 0.002,
        p.r + DOT.out,
        h - row.tall / 2,
        h + row.tall / 2,
        dots,
      );
    }
  const matTop = rimTop + p.mat;
  k.cylinder(p.a, p.d, rimTop, matTop, p.matR, 32, s.tinted(MAT_BLACK));
  const vinylTop = matTop + p.vinyl;
  k.cylinder(p.a, p.d, matTop, vinylTop, p.vinylR, 32, s.tinted(VINYL));
  k.cylinder(
    p.a,
    p.d,
    vinylTop,
    vinylTop + 0.0015,
    p.labelR,
    16,
    s.tinted(LABEL_RED),
  );
  k.cylinder(p.a, p.d, vinylTop, vinylTop + p.spindle, 0.0035, 8, silver);

  // The tonearm: base, height ring, gimbal, the S-shaped tube, the
  // headshell and cartridge, the counterweight, the rest and the cue.
  const [pa, pd] = ARM.pivot;
  const axis = P + ARM.axis;
  k.cylinder(pa, pd, P, P + 0.012, 0.036, 16, silver);
  k.cylinder(pa, pd, P + 0.012, P + 0.024, 0.03, 16, dark);
  k.cylinder(pa, pd, P + 0.024, axis + 0.008, 0.014, 12, dark);
  const bar = (
    from: readonly [number, number],
    to: readonly [number, number],
    h: number,
    r: number,
    sides: number,
    surf: ReturnType<Surfaces["tinted"]>,
  ) => {
    const [da, dn] = [to[0] - from[0], to[1] - from[1]];
    const len = Math.hypot(da, dn);
    const bk = kitAt(
      yawed(
        ORIGIN,
        (from[0] + to[0]) / 2,
        (from[1] + to[1]) / 2,
        Math.atan2(dn, da),
      ),
    );
    bk.cylinderAlong(-len / 2 - r, len / 2 + r, 0, h, r, sides, surf);
  };
  for (let i = 0; i + 1 < ARM.tube.length; i++) {
    const a = ARM.tube[i];
    const b = ARM.tube[i + 1];
    if (a && b) bar(a, b, axis, ARM.r, 8, silver);
  }
  // The headshell: a flat plate from the tube's end to its tip, the
  // cartridge under it and the finger lift beside it.
  const root = ARM.tube[ARM.tube.length - 1] ?? ARM.pivot;
  const [ta, td] = ARM.tip;
  const angle = Math.atan2(td - root[1], ta - root[0]);
  const shell = kitAt(
    yawed(ORIGIN, (root[0] + ta) / 2, (root[1] + td) / 2, angle),
  );
  const half = Math.hypot(ta - root[0], td - root[1]) / 2;
  shell.box(-half, half, -0.009, 0.009, axis - 0.004, axis + 0.002, dark);
  shell.box(
    -half + 0.012,
    half - 0.006,
    -0.007,
    0.007,
    axis - 0.02,
    axis - 0.004,
    rubber,
  );
  shell.box(-0.004, 0.004, 0.009, 0.022, axis - 0.002, axis + 0.001, silver);
  // The counterweight on its stub behind the pivot.
  const wt = ARM.weight;
  bar([pa, pd], [pa, wt.d0], axis, 0.005, 8, silver);
  bar([pa, wt.d0], [pa, wt.d1], axis, wt.r, 14, dark);
  // The arm rest under the tube and the cueing lever beside the base.
  const [ra, rd] = ARM.rest;
  k.cylinder(ra, rd, P, axis - ARM.r, 0.005, 8, dark);
  k.cylinder(0.2, -0.04, P, P + 0.03, 0.006, 8, dark);
  k.box(0.192, 0.208, -0.07, -0.04, P + 0.03, P + 0.036, silver);

  // The front left corner: the power knob with the strobe lamp on its
  // post behind it, the start/stop button and the speed buttons.
  k.cylinder(-0.2, 0.152, P, P + 0.016, 0.017, 16, silver);
  k.cylinder(-0.195, 0.115, P, P + 0.028, 0.009, 10, dark);
  k.cylinder(
    -0.195,
    0.115,
    P + 0.028,
    P + 0.033,
    0.007,
    10,
    s.blink(STROBE_LAMP, 0),
  );
  k.box(-0.178, -0.138, 0.142, 0.174, P, P + 0.008, dark);
  k.box(-0.132, -0.112, 0.16, 0.174, P, P + 0.006, dark);
  k.box(-0.106, -0.086, 0.16, 0.174, P, P + 0.006, dark);

  // The pitch slider down the right edge and its green lock light.
  k.box(
    PITCH.a - 0.007,
    PITCH.a + 0.007,
    PITCH.slot[0],
    PITCH.slot[1],
    P,
    P + 0.002,
    dark,
  );
  k.box(
    PITCH.a - 0.011,
    PITCH.a + 0.011,
    PITCH.knob[0],
    PITCH.knob[1],
    P,
    P + 0.014,
    silver,
  );
  k.cylinder(
    PITCH.light[0],
    PITCH.light[1],
    P,
    P + 0.003,
    0.003,
    8,
    s.blink(STATUS_GREEN, 1),
  );

  // The dust-cover hinges on the back.
  for (const a of [-1, 1])
    k.box(a * 0.13, a * 0.17, -dd - 0.014, -dd, P - 0.02, P + 0.012, dark);

  // The maker's name, flat in the back left corner.
  flatMark(k, MARKS.deckMark, DECK_MARK, P, s.tinted(DECK_INK));
};

/** The camera's black top plate, dials and lens barrel. */
const CAMERA_BLACK: Rgb = [0.07, 0.07, 0.075];

/** The camera's leatherette front and the lens's rubber focus ring. */
export const LEATHERETTE: Rgb = [0.035, 0.035, 0.035];

/** The lens mount, the shutter button and the strap lugs: bright metal. */
const CAMERA_METAL: Rgb = [0.7, 0.7, 0.72];

/** The viewfinder window's and the lens's glass: a dark blue-black. */
export const FINDER_GLASS: Rgb = [0.07, 0.09, 0.14];

/** The small frame window beside the viewfinder: a pale frosted grey. */
const FRAME_WINDOW: Rgb = [0.72, 0.74, 0.74];

/** The focus assist lamp: a warm amber that breathes. */
export const ASSIST_LAMP: Rgb = [1.0, 0.55, 0.15];

/** The maker's name on the top plate: a light grey on the black. */
export const CAMERA_INK: Rgb = [0.85, 0.85, 0.84];

/** The plinth: a museum white, its top a shade greyer. */
const PLINTH_WHITE: Rgb = [0.86, 0.86, 0.84];

/** The tripod's legs, column and head: a dark anodised grey. */
const TRIPOD_GREY: Rgb = [0.2, 0.2, 0.22];

/**
 * The camera body, in metres, at its true size (140.5 by 82.8 mm, 34.8 mm
 * at its thinnest): `w` along `a`, `h` tall from `bottom`, `d` deep
 * centred on the tripod; `plate` the top plate's lower edge over the
 * bottom (the leatherette below it); `grip` the grip's width at the
 * front's left and how far it stands out.
 */
export const CAMERA = {
  w: 0.1405,
  h: 0.0828,
  d: 0.0348,
  bottom: 1.43,
  plate: 0.058,
  grip: { w: 0.02, out: 0.0055 },
} as const;

/**
 * The lens, along `d` from the body's front: its axis at `a` and
 * `h` over the body's bottom (it sits low, its underside level with the
 * body's), and its rings, each `[from, to, radius]` in metres from the
 * front: the mount, the aperture ring, the rubber focus ring and the
 * front barrel; the glass at the front and the round hood.
 */
export const LENS = {
  a: -0.01,
  h: 0.031,
  rings: [
    [0, 0.005, 0.028],
    [0.005, 0.015, 0.03],
    [0.015, 0.038, 0.031],
    [0.038, 0.055, 0.0295],
  ],
  glass: 0.024,
  hood: { at: 0.059, r: 0.0315, tube: 0.0045 },
} as const;

/**
 * The maker's name's box on the top plate's front, `[a0, a1, h0, h1]` in
 * metres over the body's bottom: left of the viewfinder window, over the
 * lens.
 */
export const CAMERA_MARK = [-0.067, 0.027, 0.062, 0.0785] as const;

/** The viewfinder window's box on the front, `[a0, a1, h0, h1]`. */
export const FINDER = [0.033, 0.062, 0.059, 0.077] as const;

/**
 * The tripod, in metres: the plinth's radius and height; the spider's
 * height and radius; the legs' feet at `foot` from the centre on the
 * plinth, their tops at `top` from the centre at the spider, their
 * upper and lower widths; the pan head's base, the plate's top (the
 * camera's bottom) and the handle's reach behind.
 */
export const TRIPOD = {
  plinth: { r: 0.42, h: 0.1 },
  spider: { h0: 1.18, h1: 1.24, r: 0.045 },
  foot: 0.32,
  top: 0.035,
  upper: 0.026,
  lower: 0.019,
  head: 1.37,
  handle: 0.2,
} as const;

/** The legs' turns about the column: one at the back, two at the front. */
const LEG_TURNS = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6] as const;

/**
 * The plinth and the tripod: three legs of two sections each from the
 * spider down to the plinth's top, a rubber foot under each; the centre
 * column, the pan head, the tilt block, the plate and the handle.
 */
function tripod(k: Kit, kitAt: (f: Frame) => Kit, s: Surfaces): void {
  const t = TRIPOD;
  const white = s.tinted(PLINTH_WHITE);
  k.cylinder(0, 0, 0, t.plinth.h - 0.01, t.plinth.r, 32, white);
  k.cylinder(
    0,
    0,
    t.plinth.h - 0.01,
    t.plinth.h,
    t.plinth.r - 0.02,
    32,
    s.tinted([0.78, 0.78, 0.76]),
  );

  const grey = s.tinted(TRIPOD_GREY);
  const metal = s.tinted(CAMERA_METAL);
  const rubber = s.tinted(LEATHERETTE);
  const top = (t.spider.h0 + t.spider.h1) / 2;
  const floor = t.plinth.h;
  const angle = Math.atan2(floor - top, t.foot - t.top);
  const mid = [(t.top + t.foot) / 2, (top + floor) / 2] as const;
  for (const turn of LEG_TURNS) {
    const leg = kitAt(yawed(ORIGIN, 0, 0, turn));
    const piece = (
      from: readonly [number, number],
      to: readonly [number, number],
      width: number,
    ) =>
      leg.extrude(
        tiltedBar(
          (from[0] + to[0]) / 2,
          (from[1] + to[1]) / 2,
          angle,
          Math.hypot(to[0] - from[0], to[1] - from[1]),
          width,
        ),
        -width / 2,
        width / 2,
        grey,
      );
    piece([t.top, top], [mid[0] + 0.02, mid[1] - 0.08], t.upper);
    piece([mid[0] - 0.02, mid[1] + 0.08], [t.foot, floor], t.lower);
    // The lock where the lower section slides out of the upper one.
    const lock = [mid[0] + 0.02, mid[1] - 0.08] as const;
    leg.extrude(
      tiltedBar(lock[0], lock[1], angle, 0.04, t.upper + 0.01),
      -t.upper / 2 - 0.004,
      t.upper / 2 + 0.004,
      rubber,
    );
    leg.cylinder(t.foot, 0, floor, floor + 0.012, 0.016, 8, rubber);
  }
  k.cylinder(0, 0, t.spider.h0, t.spider.h1, t.spider.r, 12, grey);
  k.cylinder(0, 0, 0.95, t.head, 0.014, 10, metal);
  k.cylinder(0, 0, t.head, t.head + 0.02, 0.028, 14, grey);
  k.box(
    -0.016,
    0.016,
    -0.018,
    0.018,
    t.head + 0.02,
    CAMERA.bottom - 0.01,
    grey,
  );
  k.box(-0.026, 0.026, -0.02, 0.02, CAMERA.bottom - 0.01, CAMERA.bottom, grey);
  const side = kitAt(sideways(ORIGIN));
  const hh = t.head + 0.035;
  side.cylinderAlong(0.015, t.handle - 0.06, 0, hh, 0.007, 8, grey);
  side.cylinderAlong(t.handle - 0.06, t.handle, 0, hh, 0.011, 10, rubber);
}

/**
 * The camera on its tripod on its plinth: the body with its top plate,
 * leatherette and grip; the lens with its rings, glass and hood; the
 * viewfinder window, the frame window, the lever and the focus assist
 * lamp; the dials, the shutter button and the hot shoe on top; the
 * screen and the eyepiece at the back; the strap lugs; and the maker's
 * name across the front.
 */
const camera: HeroRecipe = ({ k, kitAt, s }) => {
  tripod(k, kitAt, s);

  const c = CAMERA;
  const [w, dd] = [c.w / 2, c.d / 2];
  const b = c.bottom;
  const T = b + c.h;
  const black = s.tinted(CAMERA_BLACK);
  const leather = s.tinted(LEATHERETTE);
  const metal = s.tinted(CAMERA_METAL);
  const glass = s.tinted(FINDER_GLASS);

  // The body: leatherette below the top plate, the grip at the front's
  // left.
  k.bevelBox(-w, w, -dd, dd, b, b + c.plate, 0.003, leather);
  k.bevelBox(-w, w, -dd, dd, b + c.plate, T, 0.003, black);
  k.bevelBox(
    -w + 0.002,
    -w + 0.002 + c.grip.w,
    dd - 0.002,
    dd + c.grip.out,
    b + 0.004,
    b + c.plate - 0.004,
    0.003,
    leather,
  );
  for (const sg of [-1, 1])
    k.box(sg * w, sg * (w + 0.004), -0.003, 0.003, T - 0.012, T - 0.005, metal);

  // The lens along `d`, low and a little left: its rings, glass and hood.
  const side = kitAt(sideways(ORIGIN));
  const lh = b + LENS.h;
  for (const [from, to, r] of LENS.rings)
    side.cylinderAlong(
      -(dd + from),
      -(dd + to),
      LENS.a,
      lh,
      r,
      20,
      from === 0.015 ? leather : from === 0 ? metal : black,
    );
  const front = dd + (LENS.rings[LENS.rings.length - 1]?.[1] ?? 0);
  side.cylinderAlong(
    -front,
    -(front + 0.001),
    LENS.a,
    lh,
    LENS.glass,
    16,
    glass,
  );
  k.ring(
    LENS.a,
    dd + LENS.hood.at,
    lh,
    LENS.hood.r,
    LENS.hood.tube,
    6,
    20,
    black,
    "inward",
  );

  // The front's right: the viewfinder window in its frame, the frame
  // window and the lever under it, the focus assist lamp beside them.
  const [f0, f1, g0, g1] = FINDER;
  k.box(
    f0 - 0.002,
    f1 + 0.002,
    dd,
    dd + 0.0008,
    b + g0 - 0.002,
    b + g1 + 0.002,
    metal,
  );
  k.box(f0, f1, dd + 0.0008, dd + 0.0014, b + g0, b + g1, glass);
  k.box(
    0.04,
    0.05,
    dd,
    dd + 0.001,
    b + 0.044,
    b + 0.053,
    s.tinted(FRAME_WINDOW),
  );
  k.box(0.056, 0.065, dd, dd + 0.004, b + 0.04, b + 0.054, metal);
  k.box(
    0.027,
    0.033,
    dd,
    dd + 0.001,
    b + 0.045,
    b + 0.051,
    s.blink(ASSIST_LAMP, 0),
  );

  // On top: the exposure dial at the left, the shutter button in its
  // collar with its thread, the shutter speed dial and the hot shoe.
  k.cylinder(-0.057, -0.004, T, T + 0.0085, 0.0125, 16, black);
  k.cylinder(-0.04, 0.0095, T, T + 0.004, 0.008, 12, metal);
  k.cylinder(-0.04, 0.0095, T + 0.004, T + 0.008, 0.0045, 10, metal);
  k.cylinder(-0.04, 0.0095, T + 0.008, T + 0.0085, 0.0022, 8, black);
  k.cylinder(-0.018, -0.003, T, T + 0.0075, 0.0145, 18, black);
  k.cylinder(-0.018, -0.003, T + 0.0075, T + 0.009, 0.0115, 18, metal);
  k.box(0, 0.022, -0.009, 0.009, T, T + 0.006, black);

  // At the back: the screen and the eyepiece behind the window.
  k.box(-0.055, 0.03, -dd - 0.001, -dd, b + 0.008, b + 0.056, glass);
  k.box(0.035, 0.062, -dd - 0.008, -dd, b + 0.056, b + 0.078, leather);

  // The maker's name across the top plate's front.
  const [m0, m1, n0, n1] = CAMERA_MARK;
  const rows = textRows(MARKS.cameraMark);
  const { px, left, top } = fit(rows, m0, m1, b + n0, b + n1);
  pixelBoxes(k, rows, left, top, px, dd, dd + MARK_PROUD, (ch) =>
    ch === "#" ? s.tinted(CAMERA_INK) : null,
  );
};

/** The gear kinds' recipes. */
export const GEAR_RECIPES = {
  turntable,
  camera,
} satisfies Record<Extract<HeroKind, "turntable" | "camera">, HeroRecipe>;
