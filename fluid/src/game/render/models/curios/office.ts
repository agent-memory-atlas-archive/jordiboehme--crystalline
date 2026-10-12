/**
 * The office curios' recipes (0.25.1): the floppy disk, the pizza box, the
 * lottery ticket, the 5.25 inch disk and the report sheets, the desk,
 * snack and paper slots' kinds. Colours and helpers
 * stay in this file, which imports only `common.ts` of the curio batches.
 * Nothing lights and nothing blinks.
 *
 * Every print lies on a face that looks up, where no quad can lie, so each
 * is laid by `flatText` as thin boxes of merged runs, as the tape drive's
 * badge is (`retro.ts`): its first row towards `-d`, so it reads from the
 * curio's front (`+d`), left to right along `+a`.
 *
 * - The floppy disk lies flat: a 90 by 94 mm square of dark plastic
 *   (`FLOPPY_BODY`) 3.3 mm thick with its back right corner cut off on
 *   the slant, a light grey metal shutter (`FLOPPY_SHUTTER`) over its back
 *   quarter, and a white label (`FLOPPY_LABEL`) over the front of it,
 *   carrying `MARKS.floppyLabel` in a blue ballpoint ink (`FLOPPY_INK`).
 *   v1 is the same disk with the second label, printed rather than
 *   handwritten: a yellow band (`FLOPPY_BAND`) across the label's back
 *   part carrying `MARKS.floppyPrinted`, and on the white part in front of
 *   it the version line `MARKS.floppyVersion`, both in a black print
 *   (`FLOPPY_PRINT`, `FLOPPY_PRINTED`).
 * - The pizza box is a flat square box of white-grey cardboard
 *   (`PIZZA_BASE`) 0.045 m tall under a slightly lighter lid
 *   (`PIZZA_LID`), `MARKS.pizzaLid` printed in red (`PIZZA_PRINT`) across
 *   the lid's top. v0 is one closed box; v1 and v2 stack two and three,
 *   each turned a little by `STACK_TURNS`, with the print on the top box
 *   alone. v3 is one box open: the base an open tray, the lid standing up
 *   from the tray's back edge, its front flap folded back at the top, and
 *   in the tray one slice (`PIZZA_SLICE`, a flat wedge with a crust and
 *   three red discs) and a few crumbs. The open lid's print faces the
 *   back and is not drawn.
 * - The lottery ticket is a 100 by 60 mm strip of pale paper
 *   (`TICKET_PAPER`) lying flat, a coloured band (`TICKET_BAND`) across
 *   its back edge, and the six `MARKS.numbers` in a dark ink
 *   (`TICKET_INK`) in two rows of three, each number set on its own in its
 *   slot (`TICKET_SLOTS`), and nothing else printed on it.
 * - The 5.25 inch disk lies flat: a 133 mm square of black flexible
 *   sleeve (`DISK_SLEEVE`) 2 mm thick, the write-protect notch cut out of
 *   its right edge. In its middle the sleeve's round opening shows the
 *   brown medium (`DISK_MEDIUM`), the medium's pale reinforcement ring
 *   (`DISK_RING`) and the dark hub hole (`DISK_HOLE`) at its centre; the
 *   oval head window in front of the hub and the small index hole beside
 *   it show the medium too. A printed paper label (`DISK_LABEL`) runs
 *   across the back edge, `MARKS.diskLabel` printed on it in red
 *   (`DISK_PRINT`) with a grey disc (`DISK_GLOBE`) beside it, as the
 *   printed original has (`DISK`).
 * - The report sheets are US letter sheets (0.216 by 0.279 m) lying flat.
 *   The cover sheet (`COVER_PAPER`) carries the original's layout within
 *   what may be drawn (`COVER`, from the 0.25.1 small props research): the
 *   heading `MARKS.reportTitle` across the upper quarter in a black print
 *   (`COVER_PRINT`), under it at the right the date word `MARKS.reportDate`
 *   with a rule after it, six blank field rules down the middle, and at
 *   the lower right an empty stamp box outlined by four thin strips, all
 *   rules in a grey print (`COVER_RULE`). v0 is the cover sheet alone, v1
 *   a short stack of plain sheets (`STACK_PAPER`) under it, v2 a tall
 *   stack in three blocks, each turned a little by `SHEET_TURNS`. Only the
 *   top sheet is a cover sheet, so nothing under it is printed.
 */

import type { CurioKind } from "../../../world/types";
import type { Surface } from "../../geometry";
import { frameAt, type Frame, type Kit } from "../../kit";
import type { Rgb } from "../../looks";
import { yawed, type Surfaces } from "../common";
import { MARK_PROUD } from "../heroes/pixels";
import { MARKS } from "../marks";
import { curioHalf, flatText, type CurioRecipe } from "./common";

/** Every office curio is built in this frame, at the origin. */
const ORIGIN: Frame = frameAt([0, 0, 0], 0);

/** A thin box from `a0..a1` and `d0..d1`, `h0` to `h1`: one piece of a flat print. */
const slab =
  (k: Kit, h0: number, h1: number, s: Surface) =>
  (a0: number, a1: number, d0: number, d1: number): void => {
    k.box(a0, a1, d0, d1, h0, h1, s);
  };

// --- Floppy disk -------------------------------------------------------------

/** The disk's shell: a near black plastic. */
export const FLOPPY_BODY: Rgb = [0.11, 0.11, 0.12];

/** The shutter: a light grey metal. */
export const FLOPPY_SHUTTER: Rgb = [0.72, 0.73, 0.75];

/** The label: a white paper. */
export const FLOPPY_LABEL: Rgb = [0.93, 0.93, 0.9];

/** The handwriting on the label: a blue ballpoint ink. */
export const FLOPPY_INK: Rgb = [0.12, 0.2, 0.62];

/**
 * The disk's measures, in metres: the shell's thickness, the cut corner's
 * leg, the shutter's width along `a` and its reach in from the back edge,
 * the label's box in plan, the label's thickness over the shell, and the
 * strip of the label the handwriting is fitted into.
 */
export const FLOPPY = {
  shell: 0.0033,
  corner: 0.004,
  shutter: { a0: -0.025, a1: 0.02, reach: 0.0235 },
  label: { a0: -0.037, a1: 0.037, d0: -0.017, d1: 0.044 },
  labelTop: 0.0035,
  writing: [-0.035, 0.035, 0.002, 0.012],
} as const;

/** The second label's band: a yellow. */
export const FLOPPY_BAND: Rgb = [0.95, 0.82, 0.1];

/** The second label's print: a black. */
export const FLOPPY_PRINT: Rgb = [0.07, 0.07, 0.08];

/**
 * The second label's layout, in metres: the band runs from the label's
 * back edge to `band` along `d`, the name is fitted into `name` on the
 * band and the version line into `version` on the white part in front of
 * it, each `[a0, a1, d0, d1]`, the version line towards the left as on
 * the printed original.
 */
export const FLOPPY_PRINTED = {
  band: -0.002,
  name: [-0.035, 0.035, -0.015, -0.004],
  version: [-0.035, 0.012, 0.004, 0.01],
} as const;

/** The floppy disk: shell, cut corner, shutter, label and its writing or print. */
const floppyDisk: CurioRecipe = ({ k, kitAt, s, kind, variant }) => {
  const { hw, hd, top } = curioHalf(kind, variant);
  const body = s.tinted(FLOPPY_BODY);
  const c = FLOPPY.corner;
  const t = FLOPPY.shell;
  // The shell, its back right corner left out and closed on the slant by
  // a box turned an eighth, its outer face on the cut.
  k.box(-hw, hw - c, -hd, hd, 0, t, body);
  k.box(hw - c, hw, -hd + c, hd, 0, t, body);
  kitAt(yawed(ORIGIN, hw - c / 2, -hd + c / 2, Math.PI / 4)).box(
    -c / Math.SQRT2,
    c / Math.SQRT2,
    0,
    c / Math.SQRT2,
    0,
    t,
    body,
  );
  // The shutter over the back quarter, a little proud of the shell.
  const sh = FLOPPY.shutter;
  k.box(
    sh.a0,
    sh.a1,
    -hd,
    -hd + sh.reach,
    t - 0.0004,
    t + 0.0003,
    s.tinted(FLOPPY_SHUTTER),
  );
  const l = FLOPPY.label;
  if (variant === 1) {
    // The second label: the band and the white part side by side, each
    // up to the label's top, and the print on them up to the catalogue's
    // top.
    const p = FLOPPY_PRINTED;
    const h0 = t - 0.0003;
    k.box(l.a0, l.a1, l.d0, p.band, h0, FLOPPY.labelTop, s.tinted(FLOPPY_BAND));
    k.box(
      l.a0,
      l.a1,
      p.band,
      l.d1,
      h0,
      FLOPPY.labelTop,
      s.tinted(FLOPPY_LABEL),
    );
    const print = slab(k, FLOPPY.labelTop, top, s.tinted(FLOPPY_PRINT));
    flatText(MARKS.floppyPrinted, p.name, print);
    flatText(MARKS.floppyVersion, p.version, print);
    return;
  }
  if (variant !== 0)
    throw new Error(`the floppy disk has no variant ${String(variant)}`);
  // The label and the handwriting on it, up to the catalogue's top.
  k.box(
    l.a0,
    l.a1,
    l.d0,
    l.d1,
    t - 0.0003,
    FLOPPY.labelTop,
    s.tinted(FLOPPY_LABEL),
  );
  flatText(
    MARKS.floppyLabel,
    FLOPPY.writing,
    slab(k, FLOPPY.labelTop, top, s.tinted(FLOPPY_INK)),
  );
};

// --- Pizza box ---------------------------------------------------------------

/** The box's base: a white-grey cardboard. */
export const PIZZA_BASE: Rgb = [0.8, 0.78, 0.74];

/** The lid: a slightly lighter cardboard. */
export const PIZZA_LID: Rgb = [0.88, 0.86, 0.82];

/** The lid's print: a red. */
export const PIZZA_PRINT: Rgb = [0.8, 0.1, 0.08];

/** The slice's cheese: a yellow-orange. */
export const PIZZA_SLICE: Rgb = [0.95, 0.68, 0.22];

/** The slice's crust and the crumbs: a baked brown. */
export const PIZZA_CRUST: Rgb = [0.7, 0.45, 0.2];

/** The red discs on the slice. */
export const PIZZA_TOPPING: Rgb = [0.7, 0.12, 0.08];

/**
 * The box's measures, in metres: a box's side and height, the base's
 * height under the lid (the lid runs from there to `MARK_PROUD` under the
 * box's height, the print's thickness), the print's strip on
 * the lid (`a0..a1` along, `d0..d1` across) and the cardboard's thickness.
 */
export const PIZZA = {
  side: 0.36,
  height: 0.045,
  base: 0.038,
  print: [-0.15, 0.15, -0.02, 0.02],
  wall: 0.005,
} as const;

/**
 * Each box's turn in a stack, in radians, from the bottom up: a degree or
 * two either way, so the stack reads as boxes put down by hand and still
 * stays inside the catalogue's 0.37 m.
 */
export const STACK_TURNS: readonly number[] = [0, 0.026, -0.021];

/**
 * One closed box, its bottom at `h0`, built with `k`; `print` sets the
 * lid's print on it.
 */
function closedBox(k: Kit, s: Surfaces, h0: number, print: boolean): void {
  const h = PIZZA.side / 2;
  k.box(-h, h, -h, h, h0, h0 + PIZZA.base, s.tinted(PIZZA_BASE));
  k.box(
    -h,
    h,
    -h,
    h,
    h0 + PIZZA.base,
    h0 + PIZZA.height - MARK_PROUD,
    s.tinted(PIZZA_LID),
  );
  if (!print) return;
  flatText(
    MARKS.pizzaLid,
    PIZZA.print,
    slab(
      k,
      h0 + PIZZA.height - MARK_PROUD,
      h0 + PIZZA.height,
      s.tinted(PIZZA_PRINT),
    ),
  );
}

/**
 * The open box's measures, in metres: the tray's depth span (its back
 * edge where the lid stands), the lid's thickness and the flap folded back
 * at its top.
 */
export const OPEN_BOX = {
  trayBack: -0.17,
  trayFront: 0.19,
  trayTop: 0.04,
  lid: 0.006,
  flap: 0.006,
} as const;

/**
 * The slice in the open tray: its wedge's centre and turn, its corner
 * radius (an equilateral wedge, one sixth of a round pizza), and the red
 * discs' centres in the wedge's own frame.
 */
export const SLICE = {
  at: [0.02, 0.03] as const,
  turn: 0.35,
  r: 0.095,
  discs: [
    [0, 0.035],
    [-0.025, -0.01],
    [0.028, -0.008],
  ] as const,
};

/** The crumbs in the open tray: `[a, d, side]`. */
const CRUMBS: readonly (readonly [number, number, number])[] = [
  [-0.12, 0.12, 0.008],
  [-0.09, 0.15, 0.005],
  [0.12, -0.09, 0.006],
  [-0.13, -0.1, 0.005],
];

/** The pizza box: closed (v0), stacked two (v1) or three (v2) high, or open with one slice (v3). */
const pizzaBox: CurioRecipe = ({ k, kitAt, s, kind, variant }) => {
  if (variant < 3) {
    const n = variant + 1;
    for (let i = 0; i < n; i++) {
      const turn = STACK_TURNS[i] ?? 0;
      closedBox(
        kitAt(yawed(ORIGIN, 0, 0, turn)),
        s,
        i * PIZZA.height,
        i === n - 1,
      );
    }
    return;
  }
  const { hw, hd, top } = curioHalf(kind, variant);
  const o = OPEN_BOX;
  const base = s.tinted(PIZZA_BASE);
  const w = PIZZA.wall;
  // The open tray: its floor and four walls.
  k.box(-hw, hw, o.trayBack, o.trayFront, 0, w, base);
  k.box(-hw, hw, o.trayFront - w, o.trayFront, w, o.trayTop, base);
  k.box(-hw, hw, o.trayBack, o.trayBack + w, w, o.trayTop, base);
  k.box(-hw, -hw + w, o.trayBack + w, o.trayFront - w, w, o.trayTop, base);
  k.box(hw - w, hw, o.trayBack + w, o.trayFront - w, w, o.trayTop, base);
  // The lid standing up from the tray's back edge, its front flap folded
  // back at the top to the catalogue's depth.
  const lid = s.tinted(PIZZA_LID);
  k.box(-hw, hw, o.trayBack - o.lid, o.trayBack, w, top, lid);
  k.box(-hw, hw, -hd, o.trayBack - o.lid, top - o.flap, top, lid);
  // The slice: an equilateral wedge of cheese, its crust along the back
  // edge, and three red discs on it.
  const sk = kitAt(yawed(ORIGIN, SLICE.at[0], SLICE.at[1], SLICE.turn));
  const r = SLICE.r;
  sk.cylinder(0, 0, w, w + 0.008, r, 3, s.tinted(PIZZA_SLICE));
  const edge = (r * Math.sqrt(3)) / 2;
  const crust = s.tinted(PIZZA_CRUST);
  sk.box(-edge, edge, -r / 2 - 0.012, -r / 2 + 0.004, w, w + 0.012, crust);
  for (const [a, d] of SLICE.discs)
    sk.cylinder(a, d, w + 0.008, w + 0.0105, 0.012, 8, s.tinted(PIZZA_TOPPING));
  for (const [a, d, side] of CRUMBS)
    k.box(
      a - side / 2,
      a + side / 2,
      d - side / 2,
      d + side / 2,
      w,
      w + 0.004,
      crust,
    );
};

// --- Lottery ticket ----------------------------------------------------------

/** The ticket's paper: a pale cream. */
export const TICKET_PAPER: Rgb = [0.94, 0.92, 0.84];

/** The band across the ticket's back edge: an orange-red. */
export const TICKET_BAND: Rgb = [0.88, 0.35, 0.15];

/** The numbers: a dark ink. */
export const TICKET_INK: Rgb = [0.1, 0.1, 0.13];

/** The ticket's measures, in metres: the paper's thickness and the band's reach in from the back edge. */
export const TICKET = { paper: 0.0005, band: 0.012 } as const;

/**
 * The numbers' slots, in `MARKS.numbers` order, each `[a0, a1, d0, d1]`:
 * the first three in a row nearer the band, the last three in a row in
 * front of it, each row left to right. Every slot is as deep as five
 * pixels of 2.2 mm and wider than the widest number, so every number is
 * set at the same pixel.
 */
export const TICKET_SLOTS: readonly (readonly [
  number,
  number,
  number,
  number,
])[] = [
  [-0.0145, -0.0035],
  [0.006, 0.017],
].flatMap(([d0 = 0, d1 = 0]) =>
  [-0.03, 0, 0.03].map((a) => [a - 0.011, a + 0.011, d0, d1] as const),
);

/** The lottery ticket: paper, band and the six numbers. */
const lotteryTicket: CurioRecipe = ({ k, s, kind, variant }) => {
  const { hw, hd, top } = curioHalf(kind, variant);
  const p = TICKET.paper;
  k.box(-hw, hw, -hd, hd, 0, p, s.tinted(TICKET_PAPER));
  k.box(-hw, hw, -hd, -hd + TICKET.band, p, p + 0.0003, s.tinted(TICKET_BAND));
  const ink = slab(k, p, top, s.tinted(TICKET_INK));
  MARKS.numbers.forEach((n, i) => {
    const slot = TICKET_SLOTS[i];
    if (slot === undefined)
      throw new Error("the lottery ticket has no slot for a number");
    flatText(n, slot, ink);
  });
};

// --- 5.25 inch disk ----------------------------------------------------------

/** The sleeve: a black, a touch lighter than the hub hole. */
export const DISK_SLEEVE: Rgb = [0.07, 0.07, 0.08];

/** The medium seen through the sleeve's openings: an oxide brown. */
export const DISK_MEDIUM: Rgb = [0.34, 0.22, 0.13];

/** The reinforcement ring around the hub hole: a pale plastic. */
export const DISK_RING: Rgb = [0.82, 0.8, 0.74];

/** The hub hole: the dark of the surface seen through it. */
export const DISK_HOLE: Rgb = [0.02, 0.02, 0.02];

/** The label: a white paper. */
export const DISK_LABEL: Rgb = [0.93, 0.93, 0.91];

/** The label's print: a red. */
export const DISK_PRINT: Rgb = [0.8, 0.12, 0.1];

/** The grey disc beside the print. */
export const DISK_GLOBE: Rgb = [0.6, 0.61, 0.63];

/**
 * The 5.25 inch disk's measures, in metres, the hub at the origin: the
 * sleeve's thickness; the sleeve's round opening, the reinforcement
 * ring's and the hub hole's radii; the oval head window in front of the
 * hub (its half width and its ends along `d`); the index hole's centre
 * and radius; the write-protect notch on the right edge (its ends along
 * `d` and its reach in from the edge); the label across the back edge,
 * its top, the box the print is fitted into, and the grey disc.
 */
export const DISK = {
  sleeve: 0.002,
  hub: { open: 0.019, ring: 0.0175, hole: 0.0143 },
  window: { half: 0.0065, d0: 0.022, d1: 0.06 },
  index: { a: 0.026, d: 0.003, r: 0.003 },
  notch: { d0: -0.0365, d1: -0.0305, reach: 0.004 },
  label: { a0: -0.05, a1: 0.05, d0: -0.0635, d1: -0.035 },
  labelTop: 0.0025,
  print: [-0.03, 0.02, -0.056, -0.042],
  globe: { a: 0.038, d: -0.049, r: 0.007 },
} as const;

/** The 5.25 inch disk: sleeve and notch, hub, head window, index hole, label and print. */
const disk525: CurioRecipe = ({ k, s, kind, variant }) => {
  const { hw, hd, top } = curioHalf(kind, variant);
  const t = DISK.sleeve;
  const sleeve = s.tinted(DISK_SLEEVE);
  // The sleeve, the notch left out of its right edge.
  const n = DISK.notch;
  k.box(-hw, hw - n.reach, -hd, hd, 0, t, sleeve);
  k.box(hw - n.reach, hw, -hd, n.d0, 0, t, sleeve);
  k.box(hw - n.reach, hw, n.d1, hd, 0, t, sleeve);
  // The hub: the medium in the sleeve's opening, the ring on it and the
  // hole in the ring, each a little prouder than the last.
  const lift = 0.0001;
  const h = DISK.hub;
  const medium = s.tinted(DISK_MEDIUM);
  k.cylinder(0, 0, t - lift, t + lift, h.open, 20, medium);
  k.cylinder(0, 0, t + lift, t + 2 * lift, h.ring, 20, s.tinted(DISK_RING));
  k.cylinder(0, 0, t + 2 * lift, t + 3 * lift, h.hole, 20, s.tinted(DISK_HOLE));
  // The oval head window and the index hole, the medium showing in both.
  const w = DISK.window;
  k.box(
    -w.half,
    w.half,
    w.d0 + w.half,
    w.d1 - w.half,
    t - lift,
    t + lift,
    medium,
  );
  for (const d of [w.d0 + w.half, w.d1 - w.half])
    k.cylinder(0, d, t - lift, t + lift, w.half, 12, medium);
  const ix = DISK.index;
  k.cylinder(ix.a, ix.d, t - lift, t + lift, ix.r, 10, medium);
  // The label across the back edge, the grey disc and the print on it.
  const l = DISK.label;
  k.box(
    l.a0,
    l.a1,
    l.d0,
    l.d1,
    t - 0.0003,
    DISK.labelTop,
    s.tinted(DISK_LABEL),
  );
  const g = DISK.globe;
  k.cylinder(
    g.a,
    g.d,
    DISK.labelTop - lift,
    DISK.labelTop + 3 * lift,
    g.r,
    16,
    s.tinted(DISK_GLOBE),
  );
  flatText(
    MARKS.diskLabel,
    DISK.print,
    slab(k, DISK.labelTop, top, s.tinted(DISK_PRINT)),
  );
};

// --- Report sheets -----------------------------------------------------------

/** The cover sheet: a white paper. */
export const COVER_PAPER: Rgb = [0.94, 0.94, 0.91];

/** The plain sheets under it: a paper a shade greyer, so the stack reads. */
export const STACK_PAPER: Rgb = [0.84, 0.84, 0.81];

/** The heading and the date word: a black print. */
export const COVER_PRINT: Rgb = [0.06, 0.06, 0.07];

/** The field rules and the stamp box: a grey print. */
export const COVER_RULE: Rgb = [0.38, 0.38, 0.4];

/**
 * The cover sheet's layout, in metres, its centre at the origin and its
 * top edge towards `-d`: the sheet's size, the print's thickness, the
 * heading's box and the date word's box (each `[a0, a1, d0, d1]`), the
 * rule after the date word (its ends along `a`), the field rules (their
 * ends along `a` and their places along `d`), the rules' width, and the
 * stamp box's outline (`[a0, a1, d0, d1]`).
 */
export const COVER = {
  width: 0.216,
  depth: 0.279,
  print: 0.0008,
  title: [-0.0715, 0.0715, -0.077, -0.055],
  date: [0.022, 0.046, -0.035, -0.027],
  dateRule: [0.048, 0.094],
  fields: {
    a0: -0.09,
    a1: 0.094,
    d: [-0.012, 0.004, 0.02, 0.036, 0.052, 0.068],
  },
  rule: 0.0008,
  stamp: [0.03, 0.09, 0.085, 0.12],
} as const;

/**
 * The stacks' blocks, from the bottom up, in each variant: a block's
 * height and its turn in radians. v1 is one block of plain sheets, v2
 * three, a little askew; the cover sheet lies on the top block at that
 * block's turn. The turns are pinned against the catalogue's box.
 */
export const SHEET_TURNS: readonly (readonly (readonly [
  h: number,
  turn: number,
])[])[] = [
  [],
  [[0.0285, 0.02]],
  [
    [0.026, -0.03],
    [0.026, 0.015],
    [0.0255, 0.05],
  ],
];

/** One cover sheet with `k`, its underside at `h0`, its print up to `top`. */
function coverSheet(k: Kit, s: Surfaces, h0: number, top: number): void {
  const c = COVER;
  const paper = top - c.print;
  k.box(
    -c.width / 2,
    c.width / 2,
    -c.depth / 2,
    c.depth / 2,
    h0,
    paper,
    s.tinted(COVER_PAPER),
  );
  const print = slab(k, paper, top, s.tinted(COVER_PRINT));
  flatText(MARKS.reportTitle, c.title, print);
  const datePx = flatText(MARKS.reportDate, c.date, print);
  // The rule after the date word, along its foot, and the field rules.
  const rule = slab(k, paper, top, s.tinted(COVER_RULE));
  const foot = (c.date[2] + c.date[3]) / 2 + (5 * datePx) / 2;
  rule(c.dateRule[0], c.dateRule[1], foot - c.rule, foot);
  for (const d of c.fields.d) rule(c.fields.a0, c.fields.a1, d - c.rule, d);
  // The stamp box: four thin strips round an empty field.
  const [a0, a1, d0, d1] = c.stamp;
  const t = c.rule;
  rule(a0, a1, d0, d0 + t);
  rule(a0, a1, d1 - t, d1);
  rule(a0, a0 + t, d0 + t, d1 - t);
  rule(a1 - t, a1, d0 + t, d1 - t);
}

/** The report sheets: a cover sheet alone (v0) or on a stack (v1, v2). */
const reportSheets: CurioRecipe = ({ k, kitAt, s, kind, variant }) => {
  const { top } = curioHalf(kind, variant);
  const blocks = SHEET_TURNS[variant];
  if (blocks === undefined)
    throw new Error(`the report sheets have no variant ${String(variant)}`);
  const c = COVER;
  let h = 0;
  let turn = 0;
  for (const [height, t] of blocks) {
    kitAt(yawed(ORIGIN, 0, 0, t)).box(
      -c.width / 2,
      c.width / 2,
      -c.depth / 2,
      c.depth / 2,
      h,
      h + height,
      s.tinted(STACK_PAPER),
    );
    h += height;
    turn = t;
  }
  coverSheet(
    blocks.length === 0 ? k : kitAt(yawed(ORIGIN, 0, 0, turn)),
    s,
    h,
    top,
  );
};

/** The office curios' recipes. */
export const OFFICE_RECIPES = {
  "floppy-disk": floppyDisk,
  "pizza-box": pizzaBox,
  "lottery-ticket": lotteryTicket,
  "disk-525": disk525,
  "report-sheets": reportSheets,
} satisfies Record<
  Extract<
    CurioKind,
    | "floppy-disk"
    | "pizza-box"
    | "lottery-ticket"
    | "disk-525"
    | "report-sheets"
  >,
  CurioRecipe
>;
