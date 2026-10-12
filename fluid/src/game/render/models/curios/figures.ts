/**
 * The figure and radio curios' recipes (0.25.1): the penguin figurine and
 * the radio set, the figure and radio slots' kinds. Colours and helpers
 * stay in this file, which imports only `common.ts` of the curio batches.
 * The measures follow the 0.25.1 small props research
 * (`plans/2026-10-12-small-props-research.md`, local).
 *
 * - The penguin figurine sits plump on the desk, facing `+d`, 0.2 m tall
 *   and 0.17 m wide across its feet, the seated drawing's own 216 to 256.
 *   A black body (`PENGUIN_BLACK`), a squashed lathe ball, carries a white
 *   belly (`PENGUIN_WHITE`), a smaller lathe ball set forward so only its
 *   front shows, about half the figure's width. The black head sits on
 *   top, about three eighths of the figure's width. On its front two white
 *   eyes, each half closed under a black lid, a black pupil low in each,
 *   and under them the yellow-orange beak (`PENGUIN_BEAK`) in two
 *   mandibles. Two black flippers hang at the sides, a little out from
 *   the body, and two flat yellow-orange feet (`PENGUIN_FEET`) stand out
 *   in front, turned outwards. Nothing glows and it carries no text.
 * - The radio set is a generic 1980s short-wave transceiver on four small
 *   feet (`RADIO`): a black case (`RADIO_CASE`) with a dark grey front
 *   panel (`RADIO_PANEL`) carrying the analog signal meter at the top left
 *   (a cream scale, `METER_FACE`, breathing in group 1, with a black
 *   needle), the frequency window beside it (six amber digit cells,
 *   `WINDOW_DIGITS`, breathing in group 0, in a black bezel), the big
 *   silver tuning knob right of centre (`KNOB_SILVER`) and a row of small
 *   silver knobs along the bottom. A desk microphone stands at its right
 *   on a round black base, its cable running to the set. v0 has a yellow
 *   sticky note (`NOTE_YELLOW`) stuck on the panel's top right edge,
 *   standing up over the case, with `MARKS.radioNote` written on it in a
 *   dark pen (`NOTE_PEN`) through `markLines`, reading from the front. v1
 *   moves the set and the microphone to the left and lays an A5 sheet
 *   (`SHEET_PAPER`) beside them, the same words written across its back
 *   half through `flatText` and four faint log rules (`SHEET_RULE`) under
 *   them.
 */

import type { CurioKind } from "../../../world/types";
import { frameAt, type Frame, type Kit } from "../../kit";
import type { Rgb } from "../../looks";
import {
  discOutline,
  offset,
  tiltedBar,
  yawed,
  type Surfaces,
} from "../common";
import { MARK_PROUD, markLines } from "../heroes/pixels";
import { MARKS } from "../marks";
import { curioHalf, flatText, type CurioRecipe } from "./common";

/** Every figure curio is built in this frame, at the origin. */
const ORIGIN: Frame = frameAt([0, 0, 0], 0);

// --- Penguin figurine --------------------------------------------------------

/** The back, the head and the flippers: a soft black. */
export const PENGUIN_BLACK: Rgb = [0.06, 0.06, 0.07];

/** The belly and the eyes: an off white. */
export const PENGUIN_WHITE: Rgb = [0.95, 0.95, 0.93];

/** The beak: the drawing's yellow-orange, sRGB 233, 190, 24. */
export const PENGUIN_BEAK: Rgb = [0.91, 0.75, 0.09];

/** The feet: the drawing's deeper yellow-orange, sRGB 237, 182, 20. */
export const PENGUIN_FEET: Rgb = [0.93, 0.71, 0.08];

/**
 * The penguin's measures, in metres: each lathe ball's centre along `d`,
 * its radius, the height of its middle and its half height; the eyes' and
 * the beak's boxes; each foot's centre, half sizes and outward turn; each
 * flipper's middle, length, width and lean.
 */
export const PENGUIN = {
  body: { d: -0.004, r: 0.055, mid: 0.075, half: 0.075 },
  belly: { d: 0.016, r: 0.042, mid: 0.08, half: 0.07 },
  head: { d: -0.002, r: 0.034, mid: 0.166, half: 0.034 },
  eye: { a: 0.011, half: 0.006, h0: 0.165, h1: 0.179, d0: 0.022, d1: 0.0315 },
  lid: 0.172,
  beak: { half: 0.014, d0: 0.018, d1: 0.046, h0: 0.143, h1: 0.157 },
  foot: { a: 0.045, d: 0.026, half: 0.0325, deep: 0.0225, h: 0.014 },
  footTurn: 0.35,
  flipper: { a: 0.054, h: 0.07, len: 0.08, wide: 0.014, lean: 0.35 },
} as const;

/** Lathe facets around a ball. */
const BALL_SIDES = 12;

/** Steps up a ball's profile, bottom to top. */
const BALL_STEPS = 8;

/**
 * A squashed ball's lathe profile: radius `r` at its middle `mid`, half
 * height `half`, from its bottom up to its top, so it closes both ends.
 */
function ballProfile(r: number, mid: number, half: number): [number, number][] {
  return Array.from({ length: BALL_STEPS + 1 }, (_, i) => {
    const t = -Math.PI / 2 + (Math.PI * i) / BALL_STEPS;
    const x = Math.cos(t);
    return [Math.abs(x) < 1e-12 ? 0 : r * x, mid + half * Math.sin(t)];
  });
}

/** The penguin figurine: body, belly, head, eyes, beak, flippers and feet. */
const penguinFigure: CurioRecipe = ({ k, kitAt, s }) => {
  const p = PENGUIN;
  const black = s.tinted(PENGUIN_BLACK);
  const white = s.tinted(PENGUIN_WHITE);
  // The feet first, flat on the desk, turned out from the middle.
  const f = p.foot;
  for (const side of [-1, 1]) {
    kitAt(yawed(ORIGIN, side * f.a, f.d, -side * p.footTurn)).bevelBox(
      -f.half,
      f.half,
      -f.deep,
      f.deep,
      0,
      f.h,
      0.004,
      s.tinted(PENGUIN_FEET),
    );
  }
  // The body and the belly set forward in it, then the head on top.
  const b = p.body;
  k.lathe(0, b.d, ballProfile(b.r, b.mid, b.half), BALL_SIDES, black);
  const w = p.belly;
  k.lathe(0, w.d, ballProfile(w.r, w.mid, w.half), BALL_SIDES, white);
  const h = p.head;
  k.lathe(0, h.d, ballProfile(h.r, h.mid, h.half), BALL_SIDES, black);
  // The eyes: white, a black pupil low and to the inside, a black lid
  // over the top half, so each looks half closed.
  const e = p.eye;
  for (const side of [-1, 1]) {
    const a = side * e.a;
    k.box(a - e.half, a + e.half, e.d0, e.d1, e.h0, e.h1, white);
    const inner = a - side * 0.0015;
    k.box(
      inner - 0.0025,
      inner + 0.0025,
      e.d1 - 0.002,
      e.d1 + 0.001,
      e.h0 + 0.001,
      p.lid,
      black,
    );
    k.box(
      a - e.half,
      a + e.half,
      e.d0,
      e.d1 + 0.0015,
      p.lid,
      e.h1 + 0.001,
      black,
    );
  }
  // The beak in two mandibles, the upper one a little longer.
  const bk = p.beak;
  const beak = s.tinted(PENGUIN_BEAK);
  const split = (bk.h0 + bk.h1) / 2;
  k.bevelBox(-bk.half, bk.half, bk.d0, bk.d1, split, bk.h1, 0.003, beak);
  k.bevelBox(
    -bk.half * 0.8,
    bk.half * 0.8,
    bk.d0,
    bk.d1 - 0.006,
    bk.h0,
    split,
    0.003,
    beak,
  );
  // The flippers, hanging from the shoulders, their tips a little out
  // from the body.
  const fl = p.flipper;
  for (const side of [-1, 1])
    k.extrude(
      tiltedBar(
        side * fl.a,
        fl.h,
        Math.PI / 2 + side * fl.lean,
        fl.len,
        fl.wide,
      ),
      -0.018,
      0.018,
      black,
    );
};

// --- Radio set ---------------------------------------------------------------

/** The case: a near black metal. */
export const RADIO_CASE: Rgb = [0.07, 0.07, 0.08];

/** The front panel: a dark grey. */
export const RADIO_PANEL: Rgb = [0.17, 0.17, 0.18];

/** The tuning knob and the small knobs: a brushed silver. */
export const KNOB_SILVER: Rgb = [0.72, 0.73, 0.75];

/** The signal meter's lit scale: a warm cream. */
export const METER_FACE: Rgb = [1.0, 0.86, 0.58];

/** The frequency window's lit digit cells: an amber. */
export const WINDOW_DIGITS: Rgb = [1.0, 0.58, 0.12];

/** The window's bezel, the meter's needle and the microphone's base: a black. */
export const RADIO_BLACK: Rgb = [0.03, 0.03, 0.035];

/** The sticky note: a yellow, 76 by 76 mm. */
export const NOTE_YELLOW: Rgb = [0.98, 0.9, 0.35];

/** The writing on the note and the sheet: a dark blue pen. */
export const NOTE_PEN: Rgb = [0.1, 0.12, 0.35];

/** The A5 sheet beside the set: a white paper. */
export const SHEET_PAPER: Rgb = [0.93, 0.93, 0.9];

/** The sheet's faint log rules: a pale grey-blue. */
export const SHEET_RULE: Rgb = [0.62, 0.66, 0.74];

/**
 * The radio set's measures, in metres, in the set's own terms (its block
 * of set and microphone centred on `a` 0): the case's box on its feet,
 * the panel's face, the meter, the window and its six digit cells, the
 * tuning knob, the small knobs, the microphone, the note, and the A5
 * sheet `gap` to the right of the block, its writing's box and its log
 * rules.
 */
export const RADIO = {
  block: 0.36,
  case: { a0: -0.18, a1: 0.09, d0: -0.14, d1: 0.13, h0: 0.012, h1: 0.108 },
  foot: { r: 0.008, inset: 0.02 },
  face: 0.135,
  meter: { a0: -0.165, a1: -0.112, h0: 0.058, h1: 0.096 },
  window: { a0: -0.098, a1: -0.008, h0: 0.072, h1: 0.096 },
  digits: 6,
  knob: { a: 0.035, h: 0.045, r: 0.03, d: 0.012 },
  small: { a0: -0.16, step: 0.026, n: 5, h: 0.03, r: 0.007, d: 0.008 },
  mic: { a: 0.135, d: 0.02, base: 0.04, stem: 0.006, head: 0.022 },
  note: { a0: 0.006, side: 0.076, h0: 0.078, thick: 0.0008 },
  sheet: { gap: 0.02, w: 0.148, d: 0.21, thick: 0.0005 },
  sheetText: { margin: 0.01, d0: -0.075, d1: -0.035 },
  sheetRules: [0.0, 0.025, 0.05, 0.075],
} as const;

/** The lit tints, sized past 1 so the breathe bank's low still shows them. */
const LIT = 1.4;

/** A colour scaled by `k`, past 1 for a light that must never read dark. */
const bright = (c: Rgb, x: number): Rgb => [c[0] * x, c[1] * x, c[2] * x];

/**
 * The set and its microphone with `k`, their block centred on `a` 0:
 * case, feet, panel, meter, window, knobs and the microphone on its base.
 */
function radioBody(k: Kit, s: Surfaces): void {
  const r = RADIO;
  const c = r.case;
  const black = s.tinted(RADIO_BLACK);
  const silver = s.tinted(KNOB_SILVER);
  // Four small feet, then the case on them and the panel on its front.
  for (const a of [c.a0 + r.foot.inset, c.a1 - r.foot.inset])
    for (const d of [c.d0 + r.foot.inset, c.d1 - r.foot.inset])
      k.cylinder(a, d, 0, c.h0, r.foot.r, 8, black);
  k.bevelBox(c.a0, c.a1, c.d0, c.d1, c.h0, c.h1, 0.004, s.tinted(RADIO_CASE));
  k.box(
    c.a0 + 0.003,
    c.a1 - 0.003,
    c.d1 - 0.002,
    r.face,
    c.h0 + 0.003,
    c.h1 - 0.003,
    s.tinted(RADIO_PANEL),
  );
  const f = r.face;
  // The signal meter: its lit scale and a black needle leaning right.
  const m = r.meter;
  k.box(
    m.a0,
    m.a1,
    f - 0.002,
    f + 0.001,
    m.h0,
    m.h1,
    s.blink(bright(METER_FACE, LIT), 1),
  );
  k.extrude(
    tiltedBar(
      (m.a0 + m.a1) / 2 + 0.006,
      (m.h0 + m.h1) / 2,
      Math.PI / 2 - 0.5,
      0.032,
      0.0015,
    ),
    f + 0.001,
    f + 0.0018,
    black,
  );
  // The frequency window: a black bezel and six lit digit cells in it.
  const w = r.window;
  k.box(w.a0, w.a1, f - 0.002, f + 0.001, w.h0, w.h1, black);
  const cell = (w.a1 - w.a0 - 0.008) / r.digits;
  for (let i = 0; i < r.digits; i++) {
    const a0 = w.a0 + 0.004 + i * cell;
    k.box(
      a0 + 0.0015,
      a0 + cell - 0.0015,
      f + 0.001,
      f + 0.0017,
      w.h0 + 0.005,
      w.h1 - 0.005,
      s.blink(bright(WINDOW_DIGITS, LIT), 0),
    );
  }
  // The big tuning knob with a finger dimple, and the small knobs.
  const kn = r.knob;
  k.extrude(discOutline(kn.a, kn.h, kn.r, 20), f - 0.001, f + kn.d, silver);
  k.extrude(
    discOutline(kn.a + kn.r * 0.55, kn.h + kn.r * 0.3, 0.005, 8),
    f + kn.d,
    f + kn.d + 0.001,
    black,
  );
  const sm = r.small;
  for (let i = 0; i < sm.n; i++)
    k.extrude(
      discOutline(sm.a0 + i * sm.step, sm.h, sm.r, 10),
      f - 0.001,
      f + sm.d,
      silver,
    );
  // The desk microphone: base, push-to-talk bar, stem, head and cable.
  const mc = r.mic;
  k.cylinder(mc.a, mc.d, 0, 0.012, mc.base, 16, black);
  k.box(
    mc.a - 0.012,
    mc.a + 0.012,
    mc.d + mc.base - 0.014,
    mc.d + mc.base - 0.004,
    0.012,
    0.018,
    silver,
  );
  k.cylinder(mc.a, mc.d, 0.012, 0.11, mc.stem, 8, silver);
  k.lathe(
    mc.a,
    mc.d,
    ballProfile(mc.head, 0.135, 0.025),
    10,
    s.tinted(RADIO_PANEL),
  );
  k.cylinder(mc.a, mc.d, 0.131, 0.139, mc.head + 0.001, 12, silver);
  k.box(c.a1 - 0.002, mc.a - mc.base + 0.004, -0.062, -0.054, 0, 0.005, black);
}

/** The radio set: v0 the note stuck on it, v1 the sheet beside it. */
const radioSet: CurioRecipe = ({ k, kitAt, s, kind, variant }) => {
  const { hw, top } = curioHalf(kind, variant);
  const r = RADIO;
  const pen = s.tinted(NOTE_PEN);
  if (variant === 0) {
    radioBody(k, s);
    // The note stuck on the panel's top right edge, standing over the
    // case, and the writing on it.
    const n = r.note;
    const a1 = n.a0 + n.side;
    const d0 = r.face;
    const d1 = d0 + n.thick;
    k.box(n.a0, a1, d0, d1, n.h0, n.h0 + n.side, s.tinted(NOTE_YELLOW));
    const m = 0.005;
    markLines(
      k,
      MARKS.radioNote,
      [n.a0 + m, a1 - m, n.h0 + m, n.h0 + n.side - m],
      d1 + MARK_PROUD,
      pen,
    );
    if (n.h0 + n.side > top)
      throw new Error("the radio's note is taller than its box");
    return;
  }
  if (variant !== 1)
    throw new Error(`the radio set has no variant ${String(variant)}`);
  // The set at the left end and the A5 sheet beside it.
  const shift = -hw + r.block / 2;
  radioBody(kitAt(offset(ORIGIN, shift, 0)), s);
  const sh = r.sheet;
  const a0 = shift + r.block / 2 + sh.gap;
  k.box(a0, a0 + sh.w, -sh.d / 2, sh.d / 2, 0, sh.thick, s.tinted(SHEET_PAPER));
  const t = r.sheetText;
  flatText(
    MARKS.radioNote,
    [a0 + t.margin, a0 + sh.w - t.margin, t.d0, t.d1],
    (x0, x1, y0, y1) => {
      k.box(x0, x1, y0, y1, sh.thick, 2 * sh.thick, pen);
    },
  );
  for (const d of r.sheetRules)
    k.box(
      a0 + 0.01,
      a0 + sh.w - 0.01,
      d,
      d + 0.0008,
      sh.thick,
      sh.thick + 0.0002,
      s.tinted(SHEET_RULE),
    );
};

/** The figure and radio curios' recipes. */
export const FIGURE_RECIPES = {
  "penguin-figure": penguinFigure,
  "radio-set": radioSet,
} satisfies Record<
  Extract<CurioKind, "penguin-figure" | "radio-set">,
  CurioRecipe
>;
