/**
 * The optics heroes' recipes: the turret, the black slab, the eye panel,
 * the photo console and the laser desk. What they share is a lens or a
 * screen: a glowing eye or lens set in a housing (the turret, the eye
 * panel, the laser desk's emitter), a screen bank on a desk (the photo
 * console, the laser desk's terminal), and the slab, which is all housing
 * and no light.
 *
 * This file sets the hero style the other batches follow:
 * - The footprint and top come from `heroHalf`; the heights and positions
 *   a kind is built to are the plan's, named in an `as const` table right
 *   above its recipe (`TURRET`, `EYE_PANEL`, `PHOTO_CONSOLE`,
 *   `LASER_DESK`), so a recipe reads its numbers by name.
 * - Housings are bevelled boxes (`HOUSING_BEVEL`, a thin chamfer that
 *   catches the light), except where a crisp edge is the point (the slab)
 *   and on the eye panel's small plate, which keeps a bevel of its own.
 * - Round parts use few facets: 10 to 16 around a body, a housing or a
 *   drum, 6 to 8 around a small post, pad or caster, 4 around a ring's
 *   tube, so every hero stays well under the 4000 hero cap and its own
 *   triangle pin.
 * - A lens is always `lens`: a dark bezel ring with a glowing disc set just
 *   in front of its middle, so every eye in the station is built the same
 *   way and blinks with its kind's bank. Extras may sit on top of a `lens`
 *   (the eye panel's red dome and yellow centre dot), but the ring and disc
 *   under them always come from it.
 * - Colours are the look's surfaces, or the named tints below for what no
 *   palette carries (a white shell, a red lens, a screen's own hue).
 */

import type { HeroKind } from "../../../world/types";
import type { Surface } from "../../geometry";
import { DECAL_LIFT, frameAt, type Frame, type Kit } from "../../kit";
import { LAYER } from "../../layers";
import type { Rgb } from "../../looks";
import {
  discOutline,
  profileAlong,
  tiltedBar,
  yawed,
  type KitAt,
  type Surfaces,
} from "../common";
import { MARKS } from "../marks";
import {
  ALUMINIUM,
  heroHalf,
  STATUS_AMBER,
  STATUS_GREEN,
  type HeroRecipe,
} from "./common";
import { fit, MARK_PROUD, markLines, pixelPanel, textRows } from "./pixels";

/** The turret's shell: a clean glossy white, the same in every look. */
const WHITE_SHELL: Rgb = [0.92, 0.92, 0.9];

/**
 * The turret's black trim: its legs, hub, seam, eye socket and the gaps
 * round its side panels, a near black with a hint of blue.
 */
const TURRET_BLACK: Rgb = [0.12, 0.12, 0.13];

/**
 * A deep warning red, for every red light here: the lenses and the red
 * status lights.
 */
const SIGNAL_RED: Rgb = [1.0, 0.1, 0.06];

/** The slab's finish: a flat matte black (lit, so it still takes a faint edge). */
const SLAB_BLACK: Rgb = [0.02, 0.02, 0.02];

/**
 * The eye panel's face: a warm brushed metal, champagne rather than
 * steel, drawn on the metal layer so its grain shows.
 */
const FACEPLATE_CHAMPAGNE: Rgb = [0.75, 0.7, 0.6];

/** The eye panel's round bezel, name badge and grille backing: a deep black. */
const BEZEL_BLACK: Rgb = [0.05, 0.05, 0.055];

/** The eye panel's grille slats: a plain brushed aluminium. */
const GRILLE_GREY: Rgb = ALUMINIUM;

/** The small bright dot in the middle of the eye panel's lens. */
const LENS_YELLOW: Rgb = [1.0, 0.85, 0.25];

/**
 * The blue field on the right of the eye panel's name badge, under the
 * badge's second word (`MARKS.panelName`).
 */
export const BADGE_BLUE: Rgb = [0.16, 0.32, 0.72];

/**
 * The eye panel's badge letters: a warm white, both words in it, the first
 * on the badge's black and the second on its blue field (2.6f C13). No
 * other part of the panel wears it, so a test can count the letters.
 */
export const BADGE_INK: Rgb = [0.94, 0.93, 0.88];

/**
 * The photo console's wordmark (`MARKS.deskBadge`): a dark brown-black
 * printed straight on the cream lip beside the print slot (2.6f C13). No
 * other part of the console wears it, so a test can count the letters.
 */
export const DESK_BADGE_INK: Rgb = [0.1, 0.085, 0.075];

/** The photo console's casing: an old cream plastic, gone warm with age. */
const CASING_CREAM: Rgb = [0.84, 0.79, 0.66];

/** The photo console's base, cheeks and knobs: a dark brown, like old wood-effect trim. */
const CASING_BROWN: Rgb = [0.24, 0.16, 0.1];

/** The photo console's picture: a cold grey blue, a still under a scanning tube. */
const SCREEN_GREY_BLUE: Rgb = [0.44, 0.54, 0.62];

/**
 * The tones of the photograph on the photo console's picture, all in the
 * picture's grey blue: a pale window, a mid-grey floor and a dark shape.
 */
const PHOTO_TONES = {
  light: [0.64, 0.72, 0.78],
  mid: [0.34, 0.42, 0.5],
  shadow: [0.2, 0.25, 0.32],
} as const satisfies Record<string, Rgb>;

/** The photo console's trackball: a smoky grey, lighter than its brown pad so its roundness shows. */
const TRACKBALL_GREY: Rgb = [0.6, 0.6, 0.62];

/** The photo console's grid lines over the picture: a paler blue. */
const SCREEN_GRID: Rgb = [0.72, 0.82, 0.9];

/**
 * The laser desk's laser and its pedestal, cabinet and stool seat: an
 * off-white, a little warm, like painted lab equipment.
 */
const LAB_WHITE: Rgb = [0.86, 0.86, 0.83];

/** The laser's vacuum chamber and ports: a polished stainless steel. */
const STAINLESS: Rgb = [0.74, 0.75, 0.77];

/** The laser's tall can, the stool's post and the beam pipe's bands: chrome. */
const CHROME: Rgb = [0.84, 0.85, 0.87];

/** The red band round the laser's pedestal post. */
const BAND_RED: Rgb = [0.75, 0.12, 0.1];

/** The laser desk's control box: a cream instrument case. */
const CONTROL_CREAM: Rgb = [0.85, 0.82, 0.72];

/** The control box's post: a dark blue steel. */
const POST_BLUE: Rgb = [0.12, 0.2, 0.42];

/** The yellow tape round the beam pipe's post. */
const TAPE_YELLOW: Rgb = [0.92, 0.78, 0.15];

/** The white hose that loops from the laser's head to its foot. */
const HOSE_WHITE: Rgb = [0.9, 0.9, 0.88];

/** The laser's beam guide: a cyan blue-white. */
const BEAM_CYAN: Rgb = [0.45, 0.85, 1.0];

/** The laser's lens: the violet-white glare at its port. */
const GLARE_VIOLET: Rgb = [0.8, 0.7, 1.0];

/** The laser desk's table: a light grey. */
const DESK_GREY: Rgb = [0.78, 0.79, 0.8];

/** The laser desk's terminal, keyboard and side unit: a pale cream plastic. */
const TERMINAL_CREAM: Rgb = [0.85, 0.84, 0.79];

/** The terminal's screen glass: near black. */
const SCREEN_BLACK: Rgb = [0.03, 0.03, 0.04];

/**
 * The terminal's text: a bright blue on the black screen. No other part of
 * the desk wears it, so a test can count the letters.
 */
export const SCREEN_BLUE: Rgb = [0.35, 0.65, 1.0];

/**
 * The terminal's mark in its screen's corner and its box: a light grey. No
 * other part of the desk wears it, so a test can count the letters.
 */
export const MARK_GREY: Rgb = [0.7, 0.7, 0.72];

/** The stool's seat: a white vinyl. */
const STOOL_WHITE: Rgb = [0.9, 0.9, 0.88];

/** The stool's column and its small back: a black. */
const STOOL_BLACK: Rgb = [0.08, 0.08, 0.09];

/** The chamfer of a hero's housings, in metres. */
const HOUSING_BEVEL = 0.02;

/** A lens bezel's tube radius as a share of the lens's radius. */
const BEZEL_SHARE = 0.25;

/**
 * The thinnest a lens bezel's tube gets, in metres, unless a recipe
 * passes its own tube to `lens` (only the eye panel does, to keep its
 * ring the original's width on a plate this small).
 */
const BEZEL_MIN = 0.012;

/** Facets around a lens: its bezel ring's segments and its disc's sides. */
const LENS_SIDES = 12;

/** Every recipe's main frame: at the origin, facing north (`frameAt([0, 0, 0], 0)`). */
const ORIGIN = frameAt([0, 0, 0], 0);

/** Which way a lens looks: out of the frame's wall plane, up or down. */
export type LensFacing = "front" | "up" | "down";

/**
 * A lens: a dark bezel ring of tube `max(BEZEL_MIN, radius * BEZEL_SHARE)`
 * (or the `tube` a caller passes) whose hole is exactly `radius`, centred at `(a, d, h)`, with a glowing
 * disc of `radius` in it, drawn with `s.blink(tint, group)` so it pulses
 * with its hero's blink bank. The disc stands from the bezel's back to
 * half a tube in front of the bezel's middle plane, so it sits recessed in
 * the ring and touches it all round (the glow check's host).
 *
 * `facing` `"front"` (the default) stands the ring in the frame's wall
 * plane, looking along `+d`; the disc is a thin extruded `LENS_SIDES`-gon.
 * A `Frame` is always upright, so no sub-frame can look up or down:
 * `"up"` and `"down"` lay the ring flat instead and make the disc a thin
 * upright cylinder, standing out of the ring on the side it looks to.
 */
export function lens(
  k: Kit,
  s: Surfaces,
  a: number,
  d: number,
  h: number,
  radius: number,
  tint: Rgb,
  group: number,
  facing: LensFacing = "front",
  tube: number = Math.max(BEZEL_MIN, radius * BEZEL_SHARE),
): void {
  const light = s.blink(tint, group);
  if (facing === "front") {
    k.ring(a, d, h, radius + tube, tube, 4, LENS_SIDES, s.dark, "inward");
    k.extrude(
      discOutline(a, h, radius, LENS_SIDES),
      d - tube,
      d + tube / 2,
      light,
    );
    return;
  }
  const out = facing === "up" ? 1 : -1;
  k.ring(a, d, h, radius + tube, tube, 4, LENS_SIDES, s.dark, "up");
  k.cylinder(
    a,
    d,
    h - out * tube,
    h + (out * tube) / 2,
    radius,
    LENS_SIDES,
    light,
  );
}

/**
 * The lab stool's measures, in metres: its seat (`seat`, bottom to top of
 * the round white seat, and its radius), the small black back (its height
 * band, half width and depth range behind the column, `-d` of the stool's
 * own frame), the chrome post that carries it (its half width, its arm
 * under the seat and its upright behind the seat's edge) and the reach of
 * the five-star base's arms. Exported so the laser desk's test can find
 * the seat and the back among the parts.
 */
export const LAB_STOOL = {
  seat: [0.44, 0.5],
  seatR: 0.2,
  back: { h0: 0.66, h1: 0.9, half: 0.16, d0: -0.27, d1: -0.24 },
  post: { half: 0.018, h0: 0.4, d0: -0.24, d1: -0.2 },
  arm: 0.27,
} as const;

/**
 * A lab stool centred at `(a, d)` of the frame `f`: a five-star base on
 * casters, one black column, a round white seat with a rounded rim, and a
 * chrome post that runs back under the seat and up behind it to a small
 * black back. It faces `+d` of `f` at `turn` 0 (its back towards `-d`)
 * and is turned about its column by `turn` quarter turns the way `yawed`
 * turns (each quarter swings its front from `+d` towards `-a`), so 2 faces
 * `-d`. It takes `kitAt` and a frame, not a kit: the base's arms run at
 * fifths of a turn, which only a yawed sub-frame can build.
 */
export function labStool(
  kitAt: KitAt,
  f: Frame,
  s: Surfaces,
  a: number,
  d: number,
  turn: number,
): void {
  const C = LAB_STOOL;
  const fc = yawed(f, a, d, (turn * Math.PI) / 2);
  const k = kitAt(fc);
  const black = s.tinted(STOOL_BLACK);
  const chrome = s.tinted(CHROME, LAYER.metal);
  for (let i = 0; i < 5; i++) {
    const arm = kitAt(yawed(fc, 0, 0, (2 * Math.PI * i) / 5));
    arm.box(-0.02, 0.02, 0.03, C.arm, 0.04, 0.07, s.dark);
    arm.cylinder(0, C.arm - 0.02, 0, 0.04, 0.025, 6, s.dark);
  }
  k.cylinder(0, 0, 0.03, 0.09, 0.05, 8, s.dark);
  const [s0, s1] = C.seat;
  k.cylinder(0, 0, 0.09, s0, 0.025, 8, black);
  const r = C.seatR;
  k.lathe(
    0,
    0,
    [
      [0, s0],
      [r - 0.03, s0],
      [r, s0 + 0.02],
      [r, s1 - 0.015],
      [r - 0.02, s1],
      [0, s1],
    ],
    14,
    s.tinted(STOOL_WHITE),
  );
  const P = C.post;
  k.box(-P.half, P.half, P.d1 - 0.02, -0.02, P.h0, s0, chrome);
  k.box(-P.half, P.half, P.d0, P.d1, P.h0, C.back.h0 + 0.08, chrome);
  const B = C.back;
  k.bevelBox(-B.half, B.half, B.d0, B.d1, B.h0, B.h1, 0.012, black);
}

/**
 * The turret's measures, in metres: the legs' hub and foot ends (`[d, h]`
 * in a leg's own side view, the foot's `d` measured in from the box's
 * edge), their width, the foot pads and the hub; the egg's profile
 * (`[r, h]`, a flat-ish base, widest at the shoulders near h 1.0) and its
 * facets; the vertical seam (how far it stands proud of the shell, the
 * share of the radius its inner edge keeps, its half thickness, its foot
 * and `apex`, the height where its inner edge meets over the crown, just
 * under the crown's point so the band keeps some thickness there); the
 * side panels (their foot and head, the yaw of the two seam planes that
 * bound them, a lathe corner's multiple so they ride ridges, and the
 * middle yaws of the two facets between those planes, where the black
 * bars that close each panel at its foot and head lie); and the eye: its
 * height, its plane (`d`, just proud of the shell), its socket's back and
 * radius, and the lens radius.
 */
const TURRET = {
  legHub: [0.03, 0.42],
  legFootIn: 0.06,
  legFootH: 0.03,
  legWidth: 0.03,
  pad: { r: 0.04, h: 0.03 },
  hub: { r: 0.06, h0: 0.36, h1: 0.46 },
  egg: [
    [0, 0.38],
    [0.1, 0.39],
    [0.17, 0.44],
    [0.215, 0.53],
    [0.25, 0.66],
    [0.27, 0.82],
    [0.276, 0.98],
    [0.26, 1.1],
    [0.215, 1.2],
    [0.14, 1.27],
    [0, 1.3],
  ],
  eggSides: 12,
  seam: { out: 0.008, inner: 0.9, half: 0.005, h0: 0.4, apex: 1.285 },
  pod: {
    h0: 0.62,
    h1: 1.08,
    yaw: Math.PI / 3,
    facets: [(5 * Math.PI) / 12, (7 * Math.PI) / 12],
  },
  eye: { h: 1.04, d: 0.27, socketBack: 0.15, socketR: 0.09, r: 0.06 },
} as const;

/** The turret egg's radius at height `h`, read off its profile by straight lines. */
function eggRadius(h: number): number {
  const p = TURRET.egg;
  for (let i = 0; i + 1 < p.length; i++) {
    const [r0, h0] = p[i] ?? [0, 0];
    const [r1, h1] = p[i + 1] ?? [0, 0];
    if (h >= h0 && h <= h1) return r0 + ((h - h0) * (r1 - r0)) / (h1 - h0);
  }
  return 0;
}

/** The heights a seam run samples from `h0` up to `h1`: both ends and every egg profile height between them. */
function eggHeights(h0: number, h1: number): number[] {
  return [
    h0,
    ...TURRET.egg.map(([, h]) => h).filter((h) => h > h0 && h < h1),
    h1,
  ];
}

/** A seam's outer edge at height `h`: `seam.out` proud of the egg, pushed out sideways only. */
function seamOuter(h: number): number {
  return eggRadius(h) + TURRET.seam.out;
}

/** A seam's inner edge at height `h`: a share of the egg's radius, inside the shell. */
function seamInner(h: number): number {
  return eggRadius(h) * TURRET.seam.inner;
}

/**
 * A straight run of the turret's seam in the side view (`[d, h]`), from
 * `h0` up to `h1` on the `+d` face (`side` 1) or the `-d` face (`side`
 * -1): a band from `seamOuter` to `seamInner`, pushed across a plane
 * through the egg's axis.
 */
function seamBand(h0: number, h1: number, side: 1 | -1): [number, number][] {
  const hs = eggHeights(h0, h1);
  return [
    ...hs.map((h): [number, number] => [side * seamOuter(h), h]),
    ...[...hs].reverse().map((h): [number, number] => [side * seamInner(h), h]),
  ];
}

/**
 * The turret's vertical seam as two outlines in the side view (`[d, h]`),
 * to push a hair across the plane `a = 0`: `below`, on the front from the
 * seam's foot up to the eye socket (a `seamBand`), and `over`, from the
 * socket's top up over the crown and down the back to the foot, its inner
 * edge meeting at `seam.apex` so the crown stays at the top. The lathe
 * puts a corner on `+d` and `-d`, so the band rides that ridge.
 */
function seamOutlines(): {
  below: [number, number][];
  over: [number, number][];
} {
  const { seam, eye, egg } = TURRET;
  const crown = egg[egg.length - 1]?.[1] ?? 0;
  const neck = egg[egg.length - 2]?.[1] ?? 0;
  const lo = eye.h - eye.socketR;
  const hi = eye.h + eye.socketR;
  const over: [number, number][] = [
    ...eggHeights(hi, crown).map((h): [number, number] => [seamOuter(h), h]),
    ...eggHeights(seam.h0, crown)
      .reverse()
      .map((h): [number, number] => [-seamOuter(h), h]),
    ...eggHeights(seam.h0, neck).map((h): [number, number] => [
      -seamInner(h),
      h,
    ]),
    [0, seam.apex],
    ...eggHeights(hi, neck)
      .reverse()
      .map((h): [number, number] => [seamInner(h), h]),
  ];
  return { below: seamBand(seam.h0, lo, 1), over };
}

/**
 * The turret: a glossy white egg on three thin black legs, with one red
 * eye.
 * - The legs run from a black hub under the egg (h 0.42) out to near the
 *   box's edge on the floor, 120 degrees apart with one pointing back
 *   (`-d`), each a `tiltedBar` in a yawed frame's side view on a small
 *   foot pad.
 * - The egg is a 12-sided lathe from h 0.38 to 1.3 with a flat-ish base,
 *   widest (r 0.276) at the shoulders near h 1.0.
 * - A thin black seam splits it front to back in the plane `a = 0`, over
 *   the crown and down both faces, broken only by the eye socket.
 * - A small side panel on `+a` and on `-a` (h 0.62 to 1.08), closed all
 *   round in black: two seams 60 and 120 degrees round from the front, and
 *   a short bar across each of the two facets between them at the panel's
 *   foot and head, so the sides look as if they could swing open.
 * - The eye sits high on the front (h 1.04) in a black socket: a red
 *   `lens` of r 0.06, blink group 0, which the breathe bank pulses slowly.
 */
const turret: HeroRecipe = ({ k, kitAt, s, variant, kind }) => {
  const T = TURRET;
  const black = s.tinted(TURRET_BLACK);
  const white = s.tinted(WHITE_SHELL);
  const { d1 } = heroHalf(kind, variant);
  const [d0, h0] = T.legHub;
  const [dF, hF] = [d1 - T.legFootIn, T.legFootH];
  const leg = tiltedBar(
    (d0 + dF) / 2,
    (h0 + hF) / 2,
    Math.atan2(hF - h0, dF - d0),
    Math.hypot(dF - d0, hF - h0),
    T.legWidth,
  );
  const half = T.legWidth / 2;
  for (const yaw of [Math.PI, Math.PI / 3, -Math.PI / 3]) {
    const fl = yawed(ORIGIN, 0, 0, yaw);
    profileAlong(kitAt, fl, leg, -half, half, black);
    kitAt(fl).cylinder(0, dF, 0, T.pad.h, T.pad.r, 8, black);
  }
  k.cylinder(0, 0, T.hub.h0, T.hub.h1, T.hub.r, 10, black);
  k.lathe(0, 0, T.egg, T.eggSides, white);
  const { below, over } = seamOutlines();
  for (const band of [below, over])
    profileAlong(kitAt, ORIGIN, band, -T.seam.half, T.seam.half, black);
  const P = T.pod;
  for (const yaw of [P.yaw, -P.yaw]) {
    const fp = yawed(ORIGIN, 0, 0, yaw);
    for (const side of [1, -1] as const)
      profileAlong(
        kitAt,
        fp,
        seamBand(P.h0, P.h1, side),
        -T.seam.half,
        T.seam.half,
        black,
      );
  }
  // The bars: each lies on a facet's flat face (its apothem, `cos` of the
  // facet's half angle times the radius), spanning it corner to corner, so
  // its ends meet the two seams on the ridges.
  const halfAngle = Math.PI / T.eggSides;
  for (const mid of P.facets)
    for (const yaw of [mid, -mid]) {
      const kb = kitAt(yawed(ORIGIN, 0, 0, yaw));
      for (const h of [P.h0, P.h1]) {
        const [lo, hi] = [h - T.seam.half, h + T.seam.half];
        const rLo = Math.min(eggRadius(lo), eggRadius(hi));
        const rHi = Math.max(eggRadius(lo), eggRadius(hi));
        const w = eggRadius(h) * Math.sin(halfAngle);
        kb.box(
          -w,
          w,
          rLo * T.seam.inner * Math.cos(halfAngle),
          rHi * Math.cos(halfAngle) + T.seam.out,
          lo,
          hi,
          black,
        );
      }
    }
  const e = T.eye;
  k.extrude(
    discOutline(0, e.h, e.socketR, LENS_SIDES),
    e.socketBack,
    e.d,
    black,
  );
  lens(k, s, 0, e.d, e.h, e.r, SIGNAL_RED, 0);
};

/**
 * The black slab: one plain box over the whole footprint from the floor
 * to its top, exactly 1 : 4 : 9 (0.3 by 1.2 by 2.7 m), a flat matte black
 * and lit. No bevel, no seam, no light: its crisp edges are the whole of
 * it. Every measure is the catalogue's, so it needs no table.
 */
const blackSlab: HeroRecipe = ({ k, s, variant, kind }) => {
  const { hw, d0, d1, top } = heroHalf(kind, variant);
  k.box(-hw, hw, d0, d1, 0, top, s.tinted(SLAB_BLACK));
};

/**
 * The eye panel's measures, in metres, at the original's true size: the
 * faceplate's half width, depth, bottom and own small bevel (a portrait
 * plate of about 3 : 1, 0.116 by 0.346 m, h 1.454 to 1.8, so the eye sits
 * at standing eye height); the name badge at the top (half width,
 * heights, depth, its blue field's `a` range, lift and inset, the
 * margin its second word keeps inside the blue, and how far its words
 * stand proud of their field, 2.5 mm, a sixth of the letters' height), sized so both words keep
 * the 3 mm pixel floor; the eye (its height, the black bezel disc's
 * radius and depth, the lens radius and its ring's tube, so the ring is
 * 96 mm across round a 74 mm glass as on the original, the red dome's
 * radius and how far it stands out of the bezel, the yellow centre dot's
 * radius and reach); and the grille at the foot of the plate (half width,
 * heights, backing depth, the slats' count, first height, pitch, height,
 * depth and how far in from the backing's ends they stop).
 */
const EYE_PANEL = {
  half: 0.058,
  depth: 0.03,
  bottom: 1.454,
  bevel: 0.003,
  badge: {
    half: 0.046,
    h0: 1.766,
    h1: 1.788,
    depth: 0.003,
    blue: [-0.008, 0.043],
    lift: 0.001,
    inset: 0.003,
    margin: 0.0025,
    ink: 0.0025,
  },
  eye: {
    h: 1.6,
    bezelR: 0.053,
    bezel: 0.006,
    r: 0.037,
    tube: 0.0055,
    domeR: 0.022,
    domeOut: 0.018,
    dotR: 0.005,
    dotOut: 0.02,
  },
  grille: {
    half: 0.052,
    h0: 1.458,
    h1: 1.529,
    back: 0.002,
    slats: 7,
    first: 1.4625,
    pitch: 0.0095,
    slat: 0.005,
    slatDepth: 0.002,
    slatInset: 0.003,
  },
} as const;

/**
 * The eye panel, flush on its wall at the original's true size: a small
 * portrait faceplate of warm brushed metal (d 0 to 0.03, h 1.454 to the
 * top, 0.116 m wide), and on it, from the top down:
 * - a black name badge with a blue field on its right half, its two words
 *   (`MARKS.panelName`) split between them as the original splits them:
 *   the first on the black, the second on the blue, both in `BADGE_INK`
 *   2.5 mm proud of their field (`badge.ink`) and at the one pixel size the
 *   blue field allows the second, so the two read at the same height;
 * - the eye at standing eye height (h 1.6): a black round bezel disc, a
 *   red `lens` (r 0.037, on a thinner ring than `BEZEL_MIN` so it fits
 *   the plate as the original's does), a smaller red dome standing out of
 *   the lens like a fisheye's glass, and a small yellow dot at its very
 *   middle, all in blink group 0 so the whole eye breathes as one;
 * - a speaker grille of seven aluminium slats on a black backing at the
 *   foot of the plate.
 */
const eyePanel: HeroRecipe = ({ k, s, variant, kind }) => {
  const P = EYE_PANEL;
  const { top } = heroHalf(kind, variant);
  const face = P.depth;
  const black = s.tinted(BEZEL_BLACK);
  k.bevelBox(
    -P.half,
    P.half,
    0,
    face,
    P.bottom,
    top,
    P.bevel,
    s.tinted(FACEPLATE_CHAMPAGNE, LAYER.metal),
  );
  const b = P.badge;
  const [blue0, blue1] = b.blue;
  k.box(-b.half, b.half, face, face + b.depth, b.h0, b.h1, black);
  k.box(
    blue0,
    blue1,
    face + b.depth,
    face + b.depth + b.lift,
    b.h0 + b.inset,
    b.h1 - b.inset,
    s.tinted(BADGE_BLUE),
  );
  // The badge's words: the second fitted into the blue field less its
  // margin, the first on the black left of it at the same pixel size,
  // both centred on the badge's height.
  const [first = "", second = ""] = MARKS.panelName;
  const ink = s.tinted(BADGE_INK);
  const mid = (b.h0 + b.h1) / 2;
  const { px } = fit(
    textRows(second),
    blue0 + b.margin,
    blue1 - b.margin,
    b.h0 + b.inset,
    b.h1 - b.inset,
  );
  markLines(
    k,
    second,
    [blue0 + b.margin, blue1 - b.margin, mid - 2.5 * px, mid + 2.5 * px],
    face + b.depth + b.lift + b.ink,
    ink,
  );
  const blackMid = (-b.half + blue0) / 2;
  const half = ((textRows(first)[0]?.length ?? 0) * px) / 2;
  markLines(
    k,
    first,
    [blackMid - half, blackMid + half, mid - 2.5 * px, mid + 2.5 * px],
    face + b.depth + b.ink,
    ink,
  );
  // The eye: the bezel disc, the lens seated on it, the dome and the dot.
  const e = P.eye;
  const front = face + e.bezel;
  k.extrude(discOutline(0, e.h, e.bezelR, 16), face, front, black);
  lens(k, s, 0, front + e.tube, e.h, e.r, SIGNAL_RED, 0, "front", e.tube);
  k.extrude(
    discOutline(0, e.h, e.domeR, LENS_SIDES),
    front,
    front + e.domeOut,
    s.blink(SIGNAL_RED, 0),
  );
  k.extrude(
    discOutline(0, e.h, e.dotR, 8),
    front,
    front + e.dotOut,
    s.blink(LENS_YELLOW, 0),
  );
  const g = P.grille;
  const slat = s.tinted(GRILLE_GREY, LAYER.metal);
  k.box(-g.half, g.half, face, face + g.back, g.h0, g.h1, black);
  for (let i = 0; i < g.slats; i++) {
    const h = g.first + i * g.pitch;
    k.box(
      -g.half + g.slatInset,
      g.half - g.slatInset,
      face + g.back,
      face + g.back + g.slatDepth,
      h,
      h + g.slat,
      slat,
    );
  }
};

/**
 * The photo console's measures, in metres: the brown base's top; the
 * cream deck's high back edge (`d`, `h`) and its low front edge (`d`,
 * `h`); the toe recess; the hood (half width, the brown cheeks' width, the
 * lip under its screen face, the face's top corner `[d, h]` and the back
 * of its roof); the screen's bezel and picture on the sloped face (half
 * widths, heights and how far each stands off the face), the tonal
 * blocks of the photograph on it (each an `a` and `h` range and a tone of
 * `PHOTO_TONES`) and how far they stand off, and the grid lines over it;
 * the print slot in the lip and the wordmark's box beside it on the lip's
 * upright face (right of the slot); the chunky buttons; how far a slab on the
 * deck sinks under it; the knobs (with their own sink); and the trackball
 * (its place, its pad's half side and top over the deck, its radius, its
 * profile over the pad's top as `[share of the radius, height]` pairs, and
 * the share of the radius its foot keeps).
 */
const PHOTO_CONSOLE = {
  baseTop: 0.7,
  deckBack: [0.45, 0.95],
  deckFront: [0.9, 0.75],
  toe: { depth: 0.06, h: 0.1 },
  hood: {
    half: 0.52,
    cheek: 0.06,
    lip: 1.0,
    faceTop: [0.33, 1.76],
    roof: 0.25,
  },
  bezel: { half: 0.43, h0: 1.05, h1: 1.72, off0: -0.003, off1: 0.012 },
  screen: { half: 0.36, h0: 1.1, h1: 1.67, off1: 0.016 },
  photo: [
    { a0: -0.3, a1: -0.08, h0: 1.38, h1: 1.6, tone: "light" },
    { a0: -0.3, a1: 0.0, h0: 1.14, h1: 1.3, tone: "mid" },
    { a0: 0.06, a1: 0.28, h0: 1.14, h1: 1.44, tone: "shadow" },
  ],
  toneOff1: 0.0175,
  grid: { width: 0.008, off1: 0.019 },
  slot: { half: 0.2, h0: 0.962, h1: 0.99, depth: 0.006 },
  badge: { a0: 0.24, a1: 0.48, h0: 0.955, h1: 0.995 },
  buttons: { a0: -0.76, pitch: 0.13, a: 0.1, d0: 0.58, d: 0.09, above: 0.035 },
  sink: 0.005,
  knobs: { as: [0.1, 0.24], d: 0.66, r: 0.035, h: 0.035, sink: 0.01 },
  ball: {
    a: 0.56,
    d: 0.66,
    pad: 0.1,
    padTop: 0.01,
    r: 0.065,
    profile: [
      [1, 0.02],
      [0.9, 0.045],
      [0.56, 0.06],
      [0, 0.065],
    ],
    footShare: 0.9,
  },
} as const;

/** The photo console's sloped deck: its top at depth `d`, from its back edge down to its front edge. */
function deckTop(d: number): number {
  const [db, hb] = PHOTO_CONSOLE.deckBack;
  const [df, hf] = PHOTO_CONSOLE.deckFront;
  return hb + ((d - db) * (hf - hb)) / (df - db);
}

/**
 * A point of the photo console's sloped screen face in the side view
 * (`[d, h]`): on the face's line at height `h`, moved `off` out along the
 * face's normal (negative is into the hood).
 */
function screenFace(h: number, off: number): [number, number] {
  const [d0] = PHOTO_CONSOLE.deckBack;
  const { lip, faceTop } = PHOTO_CONSOLE.hood;
  const [d1, h1] = faceTop;
  const run = d1 - d0;
  const rise = h1 - lip;
  const len = Math.hypot(run, rise);
  const d = d0 + ((h - lip) * run) / rise;
  return [d + (off * rise) / len, h - (off * run) / len];
}

/** The six chunky lit buttons on the photo console's deck, one per blink group. */
const CONSOLE_LIGHTS: readonly Rgb[] = [
  STATUS_GREEN,
  STATUS_GREEN,
  STATUS_AMBER,
  STATUS_GREEN,
  SIGNAL_RED,
  STATUS_AMBER,
];

/**
 * The photo console, backed against its wall: a boxy old console in cream
 * and dark brown.
 * - A dark brown base cabinet (up to h 0.7, a toe recess under its front)
 *   carries a cream deck that slopes from 0.95 at d 0.45 down to 0.75 at
 *   the front edge (d 0.9).
 * - Behind the deck stands a big cream screen hood with brown cheeks, its
 *   face leaning back as it rises (from d 0.45 at h 1.0 to d 0.33 at h
 *   1.76), the roof sloping to the wall at the top.
 * - On that sloped face: a black bezel and a grey-blue picture (`s.glow`)
 *   with a pale grid of two lines each way over it; a dark print slot in
 *   the lip under it, and right of the slot on the lip's upright face the
 *   console's lower-case wordmark (`MARKS.deskBadge`) in `DESK_BADGE_INK`,
 *   printed straight on the cream one `DECAL_LIFT` proud.
 * - The picture carries three tonal blocks under the grid (a pale
 *   window, a mid-grey floor, a dark shape), so it reads as a photograph.
 * - On the deck: a row of six chunky lit buttons (blink groups 0 to 5 of
 *   the status bank), two brown knobs and a grey trackball on a brown pad, all
 *   following the slope.
 */
const photoConsole: HeroRecipe = ({ k, kitAt, s, variant, kind }) => {
  const C = PHOTO_CONSOLE;
  const { hw, d1, top } = heroHalf(kind, variant);
  const cream = s.tinted(CASING_CREAM);
  const brown = s.tinted(CASING_BROWN);
  const dw = hw - 0.02;
  const [backD, backH] = C.deckBack;
  // The base, with a toe recess under its front edge, and the deck on it.
  profileAlong(
    kitAt,
    ORIGIN,
    [
      [0, 0],
      [d1 - C.toe.depth, 0],
      [d1 - C.toe.depth, C.toe.h],
      [d1, C.toe.h],
      [d1, C.baseTop],
      [0, C.baseTop],
    ],
    -dw,
    dw,
    brown,
  );
  profileAlong(
    kitAt,
    ORIGIN,
    [
      [0, C.baseTop],
      [d1, C.baseTop],
      [d1, deckTop(d1)],
      [backD, backH],
      [0, backH],
    ],
    -dw,
    dw,
    cream,
  );
  // The hood, its cheeks and its sloped screen face.
  const H = C.hood;
  const hood: [number, number][] = [
    [0, backH],
    [backD, backH],
    [backD, H.lip],
    [H.faceTop[0], H.faceTop[1]],
    [H.roof, top],
    [0, top],
  ];
  profileAlong(kitAt, ORIGIN, hood, -H.half, H.half, cream);
  for (const side of [1, -1])
    profileAlong(
      kitAt,
      ORIGIN,
      hood,
      side * H.half,
      side * (H.half + H.cheek),
      brown,
    );
  const onFace = (
    a0: number,
    a1: number,
    h0: number,
    h1: number,
    off0: number,
    off1: number,
    sf: Surface,
  ) =>
    profileAlong(
      kitAt,
      ORIGIN,
      [
        screenFace(h0, off0),
        screenFace(h1, off0),
        screenFace(h1, off1),
        screenFace(h0, off1),
      ],
      a0,
      a1,
      sf,
    );
  const b = C.bezel;
  onFace(-b.half, b.half, b.h0, b.h1, b.off0, b.off1, s.tinted(BEZEL_BLACK));
  const sc = C.screen;
  onFace(
    -sc.half,
    sc.half,
    sc.h0,
    sc.h1,
    b.off1,
    sc.off1,
    s.glow(SCREEN_GREY_BLUE),
  );
  for (const blk of C.photo)
    onFace(
      blk.a0,
      blk.a1,
      blk.h0,
      blk.h1,
      sc.off1,
      C.toneOff1,
      s.glow(PHOTO_TONES[blk.tone]),
    );
  const grid = s.glow(SCREEN_GRID);
  const w = C.grid.width / 2;
  for (const third of [1, 2]) {
    const a = -sc.half + (third * 2 * sc.half) / 3;
    onFace(a - w, a + w, sc.h0, sc.h1, sc.off1, C.grid.off1, grid);
    const h = sc.h0 + (third * (sc.h1 - sc.h0)) / 3;
    onFace(-sc.half, sc.half, h - w, h + w, sc.off1, C.grid.off1, grid);
  }
  const sl = C.slot;
  k.box(-sl.half, sl.half, backD, backD + sl.depth, sl.h0, sl.h1, s.dark);
  // The wordmark, printed on the lip's upright face right of the slot.
  const wm = C.badge;
  markLines(
    k,
    MARKS.deskBadge,
    [wm.a0, wm.a1, wm.h0, wm.h1],
    backD + DECAL_LIFT,
    s.tinted(DESK_BADGE_INK),
  );
  // On the deck: buttons, knobs and the ball's pad follow the slope, as
  // sloped slabs from `below` under the deck to `above` over it.
  const slab = (
    a0: number,
    a1: number,
    e0: number,
    e1: number,
    below: number,
    above: number,
    sf: Surface,
  ) =>
    profileAlong(
      kitAt,
      ORIGIN,
      [
        [e0, deckTop(e0) - below],
        [e1, deckTop(e1) - below],
        [e1, deckTop(e1) + above],
        [e0, deckTop(e0) + above],
      ],
      a0,
      a1,
      sf,
    );
  const B = C.buttons;
  CONSOLE_LIGHTS.forEach((tint, i) => {
    const a0 = B.a0 + i * B.pitch;
    slab(a0, a0 + B.a, B.d0, B.d0 + B.d, C.sink, B.above, s.blink(tint, i));
  });
  const n = C.knobs;
  for (const a of n.as)
    k.cylinder(
      a,
      n.d,
      deckTop(n.d) - n.sink,
      deckTop(n.d) + n.h,
      n.r,
      8,
      brown,
    );
  // The trackball: a brown pad flush on the deck, and the ball, whose foot
  // reaches below the deck at its front so it never floats on the slope.
  const t = C.ball;
  slab(
    t.a - t.pad,
    t.a + t.pad,
    t.d - t.pad,
    t.d + t.pad,
    C.sink,
    t.padTop,
    brown,
  );
  const th = deckTop(t.d) + t.padTop;
  const foot = deckTop(t.d + t.r) - C.sink;
  k.lathe(
    t.a,
    t.d,
    [
      [0, foot],
      [t.r * t.footShare, foot],
      ...t.profile.map(([r, h]): [number, number] => [t.r * r, th + h]),
    ],
    12,
    s.tinted(TRACKBALL_GREY),
  );
};

/** How far a small status light stands out of its face, in metres. */
const LIGHT_DEPTH = 0.01;

/**
 * One straight square bar of `width` from `p` to `q` (each `[a, d, h]` in
 * the recipe's frame): a bar extruded in the upright plane through both
 * points, so it may run at any slope and heading, and a bar's width past
 * each end so two bars meeting at a point close the joint. The laser
 * desk's hose is a chain of these.
 */
function strut(
  kitAt: KitAt,
  p: readonly [number, number, number],
  q: readonly [number, number, number],
  width: number,
  s: Surface,
): void {
  const run = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const rise = q[2] - p[2];
  const fs = yawed(ORIGIN, p[0], p[1], Math.atan2(q[1] - p[1], q[0] - p[0]));
  kitAt(fs).extrude(
    tiltedBar(
      run / 2,
      (p[2] + q[2]) / 2,
      Math.atan2(rise, run),
      Math.hypot(run, rise) + width,
      width,
    ),
    -width / 2,
    width / 2,
    s,
  );
}

/**
 * The laser desk's measures, in metres (0.25.1, after the film's frames).
 * The desk: its top's depth range, underside and top, the legs' inset and
 * half side, and the rails' height band. The terminal: the front case and
 * the deeper, narrower back, the screen glass, the text's pixel size and
 * places (the first line's left edge and top, the gap before the second
 * line), the mark's pixel size and its box's right and bottom edges and
 * line; the keyboard and its key field; the low side unit and its green
 * readout. The stool's place. The laser: its place (`a`, `d`), the foot,
 * column and post of its pedestal and the red band, the port axis height
 * `axis`, the chamber and its two rims, the front port and its flange (the flange's front
 * is the lens plane), the lens, the two angled ports (angle in the `a, h`
 * plane, length, width) and the side port, the top block, its valves, the
 * neck, the can and its flanges; the beam guide (how far into the lens it
 * starts, and its width: it runs level from there to the stool's back); the hose's points; the beam
 * pipe (its `a` range, height, radius, the bands' places) and its post;
 * the control box and its post; and the tall cabinet with its round port.
 */
export const LASER_DESK = {
  desk: { d0: -0.3, d1: 0.5, under: 0.7, top: 0.74, leg: 0.05, legHalf: 0.02 },
  rails: { h0: 0.12, h1: 0.15 },
  monitor: { a0: 0.1, a1: 0.7, d0: -0.02, d1: 0.16, top: 1.22 },
  monitorBack: { a0: 0.18, a1: 0.62, d0: -0.27, top: 1.12 },
  screen: { a0: 0.15, a1: 0.65, h0: 0.8, h1: 1.17, depth: 0.004 },
  text: { px: 0.005, a0: 0.2, top: 1.11, gap: 0.01, indent: 0.015 },
  mark: { px: 0.004, a1: 0.625, h0: 0.83, pad: 0.005, line: 0.003 },
  keyboard: { a0: 0.15, a1: 0.65, d0: 0.2, d1: 0.42, h: 0.025 },
  keys: { inset: 0.02, d0: 0.23, d1: 0.38, h: 0.01 },
  unit: { a0: 0.78, a1: 1.12, d0: -0.2, d1: 0.3, top: 0.86 },
  readout: { a0: 1.0, a1: 1.07, h0: 0.8, h1: 0.825 },
  stool: { a: 0.4, d: 0.66 },
  laser: { a: 0.4, d: 1.3 },
  foot: { r: 0.16, h: 0.035, bolts: 6, boltAt: 0.13, boltR: 0.012 },
  column: [
    [0, 0.035],
    [0.08, 0.035],
    [0.06, 0.09],
    [0.055, 0.38],
    [0.07, 0.38],
    [0.07, 0.42],
    [0, 0.42],
  ],
  post: { r: 0.035, h1: 0.78 },
  band: { r: 0.04, h0: 0.6, h1: 0.63 },
  axis: 0.86,
  chamber: { r: 0.08, h0: 0.76, h1: 0.98, rim: 0.095, rimT: 0.015 },
  port: { r: 0.05, d1: 1.25 },
  flange: { r: 0.085, d0: 1.12, d1: 1.155 },
  lensR: 0.045,
  arms: [
    { angle: (3 * Math.PI) / 4, length: 0.2 },
    { angle: (-3 * Math.PI) / 4, length: 0.24 },
  ],
  armWidth: 0.05,
  armHalfDepth: 0.025,
  armFlange: { length: 0.025, width: 0.09, halfDepth: 0.045 },
  sidePort: { a1: 0.6, r: 0.03, h: 0.84, flange: 0.048, flangeLength: 0.025 },
  block: { half: 0.08, d0: 1.22, d1: 1.38, h1: 1.06 },
  valves: [
    [0.05, -0.04],
    [-0.05, 0.04],
  ],
  valve: { r: 0.015, h1: 1.11, capR: 0.018, cap: 0.015 },
  neck: { r: 0.045, h1: 1.14 },
  canFlange: { r: 0.075, t: 0.025 },
  can: { r: 0.065, h1: 1.4 },
  beam: { into: 0.005, width: 0.02 },
  hose: [
    [0.05, 0, 0.79],
    [0.14, -0.03, 0.68],
    [0.17, -0.04, 0.48],
    [0.15, -0.03, 0.25],
    [0.1, 0, 0.03],
  ],
  hoseWidth: 0.022,
  pipe: {
    a0: -0.95,
    a1: 0.33,
    h: 1.02,
    r: 0.035,
    bands: [-0.7, -0.45, -0.2, 0.05],
    band: 0.03,
  },
  pipePost: { a: -0.9, r: 0.045, foot: 0.09, tape: [0.4, 0.75], tapeH: 0.03 },
  control: { a0: 0.63, a1: 0.86, d0: 1.26, d1: 1.42, h0: 0.72, h1: 0.89 },
  controlPost: { a: 0.745, d: 1.36, r: 0.025, foot: 0.06 },
  controlLights: { a0: 0.67, pitch: 0.05, w: 0.03, h0: 0.83, h1: 0.855 },
  buttons: { a0: 0.67, pitch: 0.035, w: 0.022, h0: 0.76, h1: 0.782, n: 5 },
  card: { a0: 0.68, a1: 0.8, d0: 1.33, d1: 1.34, h1: 0.96 },
  cabinet: { a0: 0.86, a1: 1.18, d0: 1.34, d1: 1.48, top: 2.15 },
  drum: { a: 1.03, h: 1.55, r: 0.11, inner: 0.065, out: 0.04 },
  seams: [0.9, 1.9],
} as const;

/**
 * The laser desk, standing free: `d` from -1.5 to 1.5, its front at `+d`.
 * Rebuilt in 0.25.1 after the film's laser bay: the laser stands on the
 * floor behind the person at the terminal and fires into their back.
 * - A lab table: a thin light-grey top (h 0.70 to 0.74) over `a` -1.2 to
 *   1.2 and `d` -0.3 to 0.5 on four slim legs with side and back rails
 *   low down. The top from `a` -1.1 to -0.35 stays clear, and so does the
 *   space under it: they are the catalogue's surface and under space.
 * - A chunky cream terminal on its right (`a` 0.1 to 0.7) facing `+d`: a
 *   black screen glass with two lines of blue text and the light-grey
 *   mark in a thin box in its lower right corner, a cream keyboard with a
 *   dark key field in front, and a low cream unit with a green readout
 *   at the table's right end.
 * - A lab stool at `a` 0.4, `d` 0.66, facing the terminal (`-d`), its
 *   back towards the laser.
 * - The laser at `a` 0.4, `d` 1.3, right behind the stool: a white
 *   pedestal (a flanged foot with bolt heads, a column, a post with a red
 *   band) under a stainless vacuum chamber. Its front port looks along
 *   `-d` at the stool's back, its flange ringing a violet-white lens; two
 *   ports stand out at angles on its left and one to its right; on top a
 *   block with two valves, a neck and a tall chrome can. The port's axis
 *   is at a sitter's mid back (h 0.86), level with the stool's back. A
 *   thin cyan beam guide runs level along `-d` from inside the lens to
 *   the rear face of the stool's back, where a sitter's back would be,
 *   and a white hose loops from the chamber down to the foot.
 * - On the laser's left a long beam pipe with chrome bands runs into its
 *   top block from a grey post with yellow tape; on its right a cream
 *   control box on a blue post, with three status lights, a row of
 *   buttons and a white card on top; behind that, in the corner, a tall
 *   off-white cabinet with a round dark port, which takes the model to
 *   its catalogue top.
 * Lights: the lens is blink group 0, the beam guide group 1 and the
 * control box's lights groups 2 to 4, all in the breathe bank. The
 * screen's text and the readout glow steadily.
 */
const laserDesk: HeroRecipe = ({ k, kitAt, s, variant, kind }) => {
  const L = LASER_DESK;
  const { hw } = heroHalf(kind, variant);
  const white = s.tinted(LAB_WHITE);
  const steel = s.tinted(STAINLESS, LAYER.metal);
  const chrome = s.tinted(CHROME, LAYER.metal);
  const cream = s.tinted(TERMINAL_CREAM);
  // The table.
  const D = L.desk;
  const grey = s.tinted(DESK_GREY);
  k.bevelBox(-hw, hw, D.d0, D.d1, D.under, D.top, 0.008, grey);
  const legA = hw - D.leg;
  const legDs = [D.d0 + D.leg, D.d1 - D.leg] as const;
  const q = D.legHalf;
  for (const a of [-legA, legA])
    for (const d of legDs)
      k.box(a - q, a + q, d - q, d + q, 0, D.under, s.metal);
  const R = L.rails;
  for (const a of [-legA, legA])
    k.box(a - q, a + q, legDs[0] + q, legDs[1] - q, R.h0, R.h1, s.metal);
  k.box(-legA + q, legA - q, legDs[0] - q, legDs[0] + q, R.h0, R.h1, s.metal);
  // The terminal: front case, deeper back, screen glass, text and mark.
  const M = L.monitor;
  const MB = L.monitorBack;
  k.bevelBox(MB.a0, MB.a1, MB.d0, M.d0, D.top, MB.top, HOUSING_BEVEL, cream);
  k.bevelBox(M.a0, M.a1, M.d0, M.d1, D.top, M.top, HOUSING_BEVEL, cream);
  const sc = L.screen;
  const glass = M.d1 + sc.depth;
  k.box(sc.a0, sc.a1, M.d1, glass, sc.h0, sc.h1, s.tinted(SCREEN_BLACK));
  const T = L.text;
  const ink = s.glow(SCREEN_BLUE);
  const [first, second] = MARKS.terminalLines;
  const firstRows = textRows(first);
  pixelPanel(k, firstRows, T.a0, T.top, T.px, glass + MARK_PROUD, (ch) =>
    ch === "#" ? ink : null,
  );
  pixelPanel(
    k,
    textRows(second),
    T.a0 + (firstRows[0]?.length ?? 0) * T.px + T.indent,
    T.top - firstRows.length * T.px - T.gap,
    T.px,
    glass + MARK_PROUD,
    (ch) => (ch === "#" ? ink : null),
  );
  const MK = L.mark;
  const markRows = textRows(MARKS.terminalMark);
  const markA0 = MK.a1 - (markRows[0]?.length ?? 0) * MK.px;
  const markH1 = MK.h0 + markRows.length * MK.px;
  const grey2 = s.tinted(MARK_GREY);
  pixelPanel(k, markRows, markA0, markH1, MK.px, glass + MARK_PROUD, (ch) =>
    ch === "#" ? grey2 : null,
  );
  // The mark's thin box, a line `MK.line` wide `MK.pad` outside its letters.
  const [ba0, ba1] = [markA0 - MK.pad, MK.a1 + MK.pad];
  const [bh0, bh1] = [MK.h0 - MK.pad, markH1 + MK.pad];
  const line = MK.line;
  const lineD = glass + MARK_PROUD;
  k.panel(ba0, ba1, lineD, bh0, bh0 + line, grey2);
  k.panel(ba0, ba1, lineD, bh1 - line, bh1, grey2);
  k.panel(ba0, ba0 + line, lineD, bh0 + line, bh1 - line, grey2);
  k.panel(ba1 - line, ba1, lineD, bh0 + line, bh1 - line, grey2);
  // The keyboard and the side unit.
  const kb = L.keyboard;
  k.box(kb.a0, kb.a1, kb.d0, kb.d1, D.top, D.top + kb.h, cream);
  const ky = L.keys;
  k.box(
    kb.a0 + ky.inset,
    kb.a1 - ky.inset,
    ky.d0,
    ky.d1,
    D.top + kb.h,
    D.top + kb.h + ky.h,
    s.dark,
  );
  const U = L.unit;
  k.bevelBox(U.a0, U.a1, U.d0, U.d1, D.top, U.top, 0.01, cream);
  const ro = L.readout;
  k.panel(ro.a0, ro.a1, U.d1 + DECAL_LIFT, ro.h0, ro.h1, s.glow(STATUS_GREEN));
  // The stool, pulled in to the terminal, its back to the laser.
  labStool(kitAt, ORIGIN, s, L.stool.a, L.stool.d, 2);
  // The laser's pedestal.
  const { a: la, d: ld } = L.laser;
  const F = L.foot;
  k.cylinder(la, ld, 0, F.h, F.r, 16, white);
  for (let i = 0; i < F.bolts; i++) {
    const t = (2 * Math.PI * (i + 0.5)) / F.bolts;
    k.cylinder(
      la + F.boltAt * Math.cos(t),
      ld + F.boltAt * Math.sin(t),
      F.h,
      F.h + 0.012,
      F.boltR,
      6,
      steel,
    );
  }
  k.lathe(la, ld, L.column, 12, white);
  const lastColumn = L.column[L.column.length - 1];
  k.cylinder(la, ld, lastColumn?.[1] ?? 0, L.post.h1, L.post.r, 12, white);
  k.cylinder(la, ld, L.band.h0, L.band.h1, L.band.r, 12, s.tinted(BAND_RED));
  // The chamber, its front port and flange, and the lens looking at -d.
  const H = L.axis;
  const ch = L.chamber;
  k.cylinder(la, ld, ch.h0, ch.h1, ch.r, 12, steel);
  k.cylinder(la, ld, ch.h0, ch.h0 + ch.rimT, ch.rim, 12, steel);
  k.cylinder(la, ld, ch.h1 - ch.rimT, ch.h1, ch.rim, 12, steel);
  k.extrude(discOutline(la, H, L.port.r, 12), L.flange.d1, L.port.d1, steel);
  k.extrude(
    discOutline(la, H, L.flange.r, 12),
    L.flange.d0,
    L.flange.d1,
    steel,
  );
  lens(
    kitAt(yawed(ORIGIN, la, L.flange.d0, Math.PI)),
    s,
    0,
    0,
    H,
    L.lensR,
    GLARE_VIOLET,
    0,
  );
  // The angled ports on the left, each with a square flange at its end.
  for (const { angle, length } of L.arms) {
    const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
    k.extrude(
      tiltedBar(
        la + (ca * length) / 2,
        H + (sa * length) / 2,
        angle,
        length,
        L.armWidth,
      ),
      ld - L.armHalfDepth,
      ld + L.armHalfDepth,
      steel,
    );
    const AF = L.armFlange;
    k.extrude(
      tiltedBar(la + ca * length, H + sa * length, angle, AF.length, AF.width),
      ld - AF.halfDepth,
      ld + AF.halfDepth,
      steel,
    );
  }
  // The side port on the right.
  const SP = L.sidePort;
  k.cylinderAlong(la, SP.a1, ld, SP.h, SP.r, 10, steel);
  k.cylinderAlong(
    SP.a1,
    SP.a1 + SP.flangeLength,
    ld,
    SP.h,
    SP.flange,
    12,
    steel,
  );
  // The top block, its valves, the neck and the can.
  const BK = L.block;
  k.bevelBox(
    la - BK.half,
    la + BK.half,
    BK.d0,
    BK.d1,
    ch.h1,
    BK.h1,
    0.01,
    steel,
  );
  const V = L.valve;
  for (const [va, vd] of L.valves) {
    k.cylinder(la + va, ld + vd, BK.h1, V.h1, V.r, 8, chrome);
    k.cylinder(
      la + va,
      ld + vd,
      V.h1,
      V.h1 + V.cap,
      V.capR,
      8,
      s.tinted(BAND_RED),
    );
  }
  const N = L.neck;
  k.cylinder(la, ld, BK.h1, N.h1, N.r, 12, steel);
  const CF = L.canFlange;
  k.cylinder(la, ld, N.h1, N.h1 + CF.t, CF.r, 12, steel);
  k.cylinder(la, ld, N.h1 + CF.t, L.can.h1, L.can.r, 12, chrome);
  k.cylinder(la, ld, L.can.h1, L.can.h1 + CF.t, CF.r, 12, steel);
  // The beam guide: one level line of light along -d, from inside the
  // lens to the rear face of the stool's back.
  const B = L.beam;
  const backFace = L.stool.d - LAB_STOOL.back.d0;
  const w = B.width / 2;
  k.box(
    la - w,
    la + w,
    backFace,
    L.flange.d0 + B.into,
    H - w,
    H + w,
    s.blink(BEAM_CYAN, 1),
  );
  // The hose, from the chamber's underside in a loop down to the foot.
  const hose = s.tinted(HOSE_WHITE);
  for (let i = 0; i + 1 < L.hose.length; i++) {
    const p = L.hose[i];
    const q2 = L.hose[i + 1];
    if (!p || !q2) continue;
    strut(
      kitAt,
      [la + p[0], ld + p[1], p[2]],
      [la + q2[0], ld + q2[1], q2[2]],
      L.hoseWidth,
      hose,
    );
  }
  // The beam pipe, its chrome bands and its taped post.
  const PP = L.pipe;
  k.cylinderAlong(PP.a0, PP.a1, ld, PP.h, PP.r, 10, steel);
  for (const a of PP.bands)
    k.cylinderAlong(a, a + PP.band, ld, PP.h, PP.r + 0.006, 10, chrome);
  const PO = L.pipePost;
  k.cylinder(PO.a, ld, 0, 0.02, PO.foot, 10, s.dark);
  k.cylinder(PO.a, ld, 0.02, PP.h - PP.r + 0.005, PO.r, 10, s.metal);
  for (const h of PO.tape)
    k.cylinder(
      PO.a,
      ld,
      h,
      h + PO.tapeH,
      PO.r + 0.004,
      10,
      s.tinted(TAPE_YELLOW),
    );
  // The control box on its blue post, its lights, buttons and card.
  const CP = L.controlPost;
  const CB = L.control;
  k.box(
    CP.a - CP.foot,
    CP.a + CP.foot,
    CP.d - CP.foot,
    CP.d + CP.foot,
    0,
    0.02,
    s.dark,
  );
  k.cylinder(CP.a, CP.d, 0.02, CB.h0, CP.r, 8, s.tinted(POST_BLUE));
  k.bevelBox(
    CB.a0,
    CB.a1,
    CB.d0,
    CB.d1,
    CB.h0,
    CB.h1,
    0.01,
    s.tinted(CONTROL_CREAM),
  );
  const CL = L.controlLights;
  [STATUS_GREEN, STATUS_AMBER, SIGNAL_RED].forEach((tint, i) => {
    const a = CL.a0 + i * CL.pitch;
    k.box(
      a,
      a + CL.w,
      CB.d0 - LIGHT_DEPTH,
      CB.d0,
      CL.h0,
      CL.h1,
      s.blink(tint, 2 + i),
    );
  });
  const BT = L.buttons;
  for (let i = 0; i < BT.n; i++) {
    const a = BT.a0 + i * BT.pitch;
    k.box(a, a + BT.w, CB.d0 - LIGHT_DEPTH, CB.d0, BT.h0, BT.h1, s.dark);
  }
  const CD = L.card;
  k.box(CD.a0, CD.a1, CD.d0, CD.d1, CB.h1, CD.h1, s.tinted(STOOL_WHITE));
  // The tall cabinet in the corner, its seams and its round port.
  const CA = L.cabinet;
  k.bevelBox(CA.a0, CA.a1, CA.d0, CA.d1, 0, CA.top, HOUSING_BEVEL, white);
  for (const h of L.seams)
    k.box(
      CA.a0 + 0.02,
      CA.a1 - 0.02,
      CA.d0 - 0.003,
      CA.d0,
      h,
      h + 0.006,
      s.dark,
    );
  const DR = L.drum;
  k.extrude(discOutline(DR.a, DR.h, DR.r, 14), CA.d0 - DR.out, CA.d0, s.dark);
  k.extrude(
    discOutline(DR.a, DR.h, DR.inner, 12),
    CA.d0 - DR.out - 0.006,
    CA.d0 - DR.out,
    s.tinted(POST_BLUE),
  );
};

/** The optics kinds' recipes. */
export const OPTICS_RECIPES = {
  turret,
  "black-slab": blackSlab,
  "eye-panel": eyePanel,
  "photo-console": photoConsole,
  "laser-desk": laserDesk,
} satisfies Record<
  Extract<
    HeroKind,
    "turret" | "black-slab" | "eye-panel" | "photo-console" | "laser-desk"
  >,
  HeroRecipe
>;
