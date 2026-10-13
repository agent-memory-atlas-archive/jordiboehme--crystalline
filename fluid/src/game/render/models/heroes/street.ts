/**
 * The street pieces: the red bike and the blue police box, two machines
 * from the street that ended up aboard, and the neon bike beside the
 * bike. All three are lit on the `breathe` bank (C13). The police box's
 * two door leaves are the one thing on any of them that moves.
 *
 * - The bike (`BIKE`) is a long racing motorcycle parked on its side
 *   stand, its length along `a` and its nose at `+a`, glossy red. Its two
 *   fat round tyres are its two ends (`BIKE_WHEELS`), each under a red
 *   domed cover that hides the hub. Over the front wheel stands the high
 *   fairing with its side skirts, the wide headlight in a black panel on
 *   its flat nose and the tall dark windscreen sweeping up and back from
 *   it to the bike's top over the dash and the handlebar. The middle is
 *   open and low: a floor pan over the black chassis and a bucket seat
 *   with a tall backrest. Behind it the rear cowl rises as high as the
 *   fairing, rounds over and slopes down over the rear wheel, ending
 *   ahead of the tyre, the tail light breathing on its slope; a white
 *   pinstripe runs under its top. The panels are built in slices, the
 *   narrower ones grown proud of the wider (`grown`), so their edges read
 *   rounded. Round engine covers sit low behind the seat, and on the left
 *   the swing arm runs to the rear axle. It stands upright (C14): the kit
 *   has no roll, so the stand is a bar from the floor pan down to the
 *   floor on its `-d` side. Its stickers (`BIKE_STICKERS`, 2.6f C13) are
 *   not mirrored, as on the original: the left side carries the watch and
 *   camera makers' on its skirt and a helmet maker's on the front wheel
 *   cover, with a star roundel; the right side the big two-line sticker
 *   and a smiley on its skirt and the other helmet maker's on the cover.
 * - The police box stands free, centred on its anchor like any free hero
 *   (2.6e: never against a wall), its doors facing `+d` (C3, C10): deep blue
 *   painted wood on a low plinth, a corner post from the plinth to the roof at
 *   each corner, a black sign band under the
 *   roof on all four sides with its words in white block pixels
 *   (`BOX_SIGN`, laid out by `boxSignLayout`), a roof in two steps under
 *   a small lamp in a white cage that breathes, and on every side two
 *   columns of raised panels under a window of small frosted panes that
 *   glow faintly. On the front the two columns are the two door leaves,
 *   each built by `boxDoor` as a slab of its own; the left one carries the
 *   white door notice with its lines in black (`MARKS.boxNotice`, 2.6f
 *   C13), which swings with it.
 *   It is built in its own terms (`BOX_BODY`), `d` running from its back
 *   (0) to the posts' front (`BOX.front`), half its depth behind the
 *   anchor, so the whole box, the back sign included, stays inside its
 *   footprint.
 * - The police box's body is hollow (2.6e C10): a back wall, two side
 *   walls lined in a pale white on the inside, a roof slab over the
 *   doorway and a floor on the plinth, and on the back wall's inner face a
 *   panel that shines white by itself (`INSIDE`), so through the open
 *   doors the box glows. Every outside face stands where the solid body's
 *   did.
 * - The leaves are movers (`boxLeafMovers`, C16): the instanced mesh
 *   leaves them out and each is a `wing` of its own in world space, hinged
 *   at its outer post (`boxHinge`) and turned inward by `BOX_SWING` at
 *   full open, the two opposite ways, both under the one key
 *   `boxKey(index)`, so they open and close together. That is the one
 *   door motion; the recipe builds them in place, closed, only when asked
 *   to (`movers`), which the model checks are.
 * - The neon bike (`CYCLE`) is the enclosed racing cycle from inside the
 *   computer, parked like the red bike: its length along `a`, its nose at
 *   `+a`, built to the film model's proportions. Two fat wheels of one
 *   size, a quarter of its length across, are its ends (`CYCLE_WHEELS`),
 *   each a glowing tread under a dark cover on each side, so only the rim
 *   glows. The shell (`CYCLE_SHELL`) is dark and glossy, its top 1.8
 *   wheels high, and its flank splits as on the original: an arched band
 *   (`CYCLE_BAND`) hoods both wheels over their tops and runs over the
 *   top, and a lower panel (`CYCLE_PANEL`) set in from it, a shade
 *   lighter (`CYCLE_LOWER`), runs low between the wheels, its front
 *   following the front arch and its corners on the belly rounded, to a
 *   square back edge that hides the rear wheel's front, so the split
 *   reads through its glowing line and the recess.
 *   Narrower crests are grown over both like the bike's panels (`grown`).
 *   The back (`CYCLE_SPINE`) rises from a short tail over the rear wheel,
 *   runs low under the canopy, climbs to a crown a little ahead of the
 *   middle and falls in a long curve to the nose. A short smoked canopy
 *   sits on the back over the hidden rider, behind the crown and clear of
 *   the nose: a rounded dome 12 to 15 cm over the crests (0.25.2,
 *   `CANOPY_ROUND`), its front and back ends rounded; the flanks carry no
 *   window. Glowing lines trace the band's outline a little inside it on
 *   both sides, so one runs along the split (`cycleLine`, laid by
 *   `profileLine`, which the red bike's pinstripe shares), and the
 *   canopy's ridge. Every light is in one group and breathes; the body
 *   carries no text. That is variant 0, the closed one.
 * - The neon bike's variant 1 is the open one (`CYCLE_OPEN`, 0.25.2): the
 *   same length and footprint, lower, with no canopy and no rider. Its
 *   wheels (`OPEN_WHEELS`) are hubless: fat black tyre rings with a dark
 *   face on each side and a glowing inner rim round an open middle, so
 *   the floor shows through them. A low glossy body (`OPEN_BODY`)
 *   bridges them as a long flat wedge, dipping into each ring's open
 *   middle over its upper inner part only, and rising to its highest
 *   point at the tail behind the empty rider's place: a saddle hollow
 *   (`OPEN_SADDLE`) with a seat pad and a glowing seat line, two short
 *   handles at the front and two footrests at the back. Thin glowing
 *   lines run along each flank and over the top, in the closed one's
 *   light group.
 *
 * The numbers each kind is built to are named above its recipe: `BIKE`,
 * `BIKE_WHEELS` and the profiles (`CORE`, `SKIRT`, `COWL`) for the bike,
 * `BOX` for the box, `CYCLE`, `CYCLE_WHEELS`, `CYCLE_SPINE` and `CYCLE_SHELL`
 * for the neon bike, `CYCLE_OPEN`, `OPEN_WHEELS` and `OPEN_BODY` for its
 * open variant. Round parts use few facets, as in every batch.
 */

import { boxKey } from "../../../world/box";
import { turnedPoint } from "../../../world/footprints";
import type { Hero, HeroKind } from "../../../world/types";
import { CELL } from "../../../world/units";
import { createBuilder, type Surface } from "../../geometry";
import {
  DECAL_LIFT,
  createKit,
  frameAt,
  type Frame,
  type Kit,
} from "../../kit";
import type { Look, Rgb } from "../../looks";
import {
  discOutline,
  offset,
  shade,
  sideways,
  surfaces,
  tiltedBar,
  yawed,
  type KitAt,
  type Mover,
  type Surfaces,
} from "../common";
import { heroHalf, type HeroRecipe } from "./common";
import { MARKS } from "../marks";
import { fit, markLines, pixelPanel, textBlock, textRows } from "./pixels";

/** The recipe's own frame: the origin, facing north. */
const ORIGIN: Frame = frameAt([0, 0, 0], 0);

/** The bike's glossy red. */
const BIKE_RED: Rgb = [0.9, 0.08, 0.06];

/**
 * The gloss on the crests: a lighter red on the narrowest slice of each
 * body panel and on the wheel covers' inner domes, where the light
 * catches the curve.
 */
const BIKE_SHINE: Rgb = [0.98, 0.22, 0.16];

/** The bike's tyres: a near black rubber. */
const TYRE: Rgb = [0.06, 0.06, 0.07];

/** The tyres' tread: a darker rubber than their side walls. */
const TREAD: Rgb = [0.025, 0.025, 0.03];

/** The bike's chassis, handlebar, swing arm's pivot and stand: black. */
const BIKE_BLACK: Rgb = [0.05, 0.05, 0.05];

/**
 * The bezels round the lamps, the dash, the grips and the mirrors: a dark
 * grey.
 */
const BIKE_DARK: Rgb = [0.14, 0.14, 0.16];

/** The bucket seat: a dark reddish brown. */
const SADDLE: Rgb = [0.3, 0.14, 0.1];

/** The seat's backrest and rolled edges: a darker brown than its top. */
const SADDLE_EDGE: Rgb = [0.16, 0.08, 0.06];

/** The bike's tinted windscreen: nearly black with a cold blue cast. */
const SCREEN: Rgb = [0.06, 0.07, 0.11];

/** The bike's headlight: a steady warm white. */
const HEADLIGHT: Rgb = [1.0, 0.97, 0.85];

/** The bike's tail light: a red that breathes. */
const TAIL_LIGHT: Rgb = [0.95, 0.1, 0.08];

/** The indicator lenses beside the headlight: amber, off while parked. */
const INDICATOR: Rgb = [0.95, 0.55, 0.1];

/** The pinstripe along the rear cowl: an off white. */
const ACCENT: Rgb = [0.88, 0.88, 0.84];

/** The round caps on the wheel covers, the swing arm and the engine. */
export const HUB_SILVER: Rgb = [0.72, 0.72, 0.75];

/** The star roundel's blue disc, white star and red bars. */
const ROUNDEL = {
  blue: [0.1, 0.2, 0.55],
  white: [0.96, 0.96, 0.96],
  red: [0.75, 0.1, 0.12],
} as const satisfies Record<string, Rgb>;

/** The smiley sticker's yellow face and its black eyes and mouth. */
const SMILEY = {
  face: [1.0, 0.85, 0.15],
  ink: [0.04, 0.04, 0.04],
} as const satisfies Record<string, Rgb>;

/**
 * The bike's overall size, in metres: `length` from the front tyre's nose
 * to the rear tyre's back along `a`, `width` across its widest parts
 * along `d`, and `screenTop`, the top of its windscreen and so of the
 * bike. These are the original's sourced measures (2947 mm, 831 mm and
 * 1171 mm with the shield).
 */
export const BIKE = { length: 2.95, width: 0.83, screenTop: 1.17 } as const;

/** A point of a side profile: `[a, h]`. */
type P2 = readonly [number, number];

/**
 * One wheel: its axle at `a` (at height `r`, the tyre on the floor), `r`
 * the tyre's radius and `half` the tyre's half width. The original's
 * wheelbase is 2194 mm on an 18 inch front and a 19 inch rear rim; the
 * two tyres are the bike's two ends, so their radii and axles give
 * `BIKE.length` exactly.
 */
interface BikeWheel {
  a: number;
  r: number;
  half: number;
}

/** The front wheel and the rear one. */
export const BIKE_WHEELS = {
  front: { a: 1.115, r: 0.36, half: 0.15 },
  rear: { a: -1.085, r: 0.39, half: 0.17 },
} as const satisfies Record<string, BikeWheel>;

/**
 * A tyre's three slices, `[radius in from the tread, half width in from
 * the side wall]`: the full round tread in the middle, a shoulder and the
 * side wall, so the fat tyre reads round from the front and the side.
 */
const TYRE_SLICES: readonly (readonly [number, number])[] = [
  [0, 0.045],
  [0.025, 0.015],
  [0.07, 0],
];

/**
 * A wheel cover's two domes on each side, `[radius as a share of the
 * tyre's, how far out from the side wall]`: the outer red one on the
 * wall and the inner glossy one on it, the face the wheel stickers sit
 * on. The rear wheel's cover carries a round silver cap (`CAP`) on the
 * `+d` side; on the `-d` side the swing arm covers it.
 */
const DOMES: readonly (readonly [number, number])[] = [
  [0.75, 0.02],
  [0.58, 0.035],
];

/** The silver caps' radius and thickness. */
const CAP = { r: 0.075, t: 0.012 } as const;

/** Facets round a tyre, and round a wheel cover's dome. */
const TYRE_SIDES = 20;
const DOME_SIDES = 16;

/** How much room each arch leaves round its tyre. */
const ARCH = 0.05;

/** The front wheel's arch radius and the rear one's. */
const FRONT_ARCH = BIKE_WHEELS.front.r + ARCH;
const REAR_ARCH = BIKE_WHEELS.rear.r + ARCH;

/**
 * `n + 1` points on the circle of radius `r` round `(a, h)` from `from`
 * to `to` degrees (counter-clockwise from `+a`), both ends included: a
 * wheel arch.
 */
function arc(
  a: number,
  h: number,
  r: number,
  from: number,
  to: number,
  n: number,
): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    return [a + r * Math.cos(t), h + r * Math.sin(t)];
  });
}

/**
 * `n` points on the quadratic curve from `p0` to `p1` pulled towards `c`,
 * `p0` left out and `p1` included, so curves chain without a repeated
 * point.
 */
function curve(p0: P2, c: P2, p1: P2, n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    const u = 1 - t;
    return [
      u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
      u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
    ];
  });
}

/**
 * The angle, in degrees, of the point on the circle of radius `r` round
 * `(a0, h0)` at `a`, on its upper half: where an arch meets a straight
 * edge at `a`.
 */
function archAngle(a0: number, r: number, a: number): number {
  return (Math.acos((a - a0) / r) * 180) / Math.PI;
}

/**
 * The outline `poly` grown by `g` outward (or shrunk, for a negative
 * `g`): each corner moved along the mitre of its two edges' normals, the
 * mitre held to twice `g` at a sharp corner. The body panels are built in
 * slices, the narrower slices grown so their outline stands proud of the
 * wider ones all round: each edge steps down in two or three facets and
 * reads rounded, as the robot head's jaw does.
 */
function grown(poly: readonly P2[], g: number): [number, number][] {
  const n = poly.length;
  let area = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % n] ?? p;
    area += p[0] * q[1] - q[0] * p[1];
  });
  const out = area > 0 ? 1 : -1;
  const normal = (p: P2, q: P2): [number, number] => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [(out * (q[1] - p[1])) / len, (-out * (q[0] - p[0])) / len];
  };
  return poly.map((p, i) => {
    const prev = poly[(i + n - 1) % n] ?? p;
    const next = poly[(i + 1) % n] ?? p;
    const [n0, n1] = [normal(prev, p), normal(p, next)];
    const k = g / Math.max(1 + n0[0] * n1[0] + n0[1] * n1[1], 0.5);
    return [p[0] + (n0[0] + n1[0]) * k, p[1] + (n0[1] + n1[1]) * k];
  });
}

/**
 * A line along the side profile `pts` (`[a, h]`, open), `width` wide, laid
 * on the face between depths `d0` and `d1`: one flat bar per pair of
 * points, each a little longer than its piece so the joints close. The
 * red bike's pinstripe and the neon bike's glowing lines.
 */
function profileLine(
  k: Kit,
  pts: readonly P2[],
  width: number,
  d0: number,
  d1: number,
  surf: Surface,
): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (!p || !q) continue;
    const bar = tiltedBar(
      (p[0] + q[0]) / 2,
      (p[1] + q[1]) / 2,
      Math.atan2(q[1] - p[1], q[0] - p[0]),
      Math.hypot(q[0] - p[0], q[1] - p[1]) + width,
      width,
    );
    k.extrude(bar, d0, d1, surf);
  }
}

/**
 * The front fairing's middle, `[a, h]`: the arch over the front wheel
 * from the nose back down to the floor pan, the floor pan back to the
 * seat, the rear edge rising in a curve to the dash, and the top running
 * forward, falling a little, to the nose, whose flat front carries the
 * headlight. It is built in slices (`CORE_SLICES`).
 */
const CORE: readonly P2[] = [
  ...arc(
    BIKE_WHEELS.front.a,
    BIKE_WHEELS.front.r,
    FRONT_ARCH,
    archAngle(BIKE_WHEELS.front.a, FRONT_ARCH, 1.31),
    360 - archAngle(BIKE_WHEELS.front.a, FRONT_ARCH, 0.8),
    12,
  ),
  [0.24, 0.1],
  [0.24, 0.3],
  ...curve([0.24, 0.3], [0.36, 0.6], [0.4, 0.88], 4),
  [0.44, 0.935],
  [0.52, 0.95],
  ...curve([0.52, 0.95], [0.95, 0.925], [1.27, 0.855], 4),
  [1.31, 0.83],
];

/**
 * The front fairing's middle slices, `[half width, growth]`: the wide one
 * on the outline and a narrower glossy crest grown proud of it.
 */
const CORE_SLICES: readonly (readonly [number, number])[] = [
  [0.2, 0],
  [0.17, 0.015],
];

/**
 * The fairing's side skirts, `[a, h]`: the flat side panels from the nose
 * back to the dash, over the front wheel's upper rear quarter, as wide as
 * the bike's shell gets. Their outer face carries the left side's
 * stickers and the right side's.
 */
const SKIRT: readonly P2[] = [
  [1.3, 0.5],
  [1.315, 0.7],
  [1.31, 0.825],
  [1.27, 0.85],
  ...curve([1.27, 0.85], [0.95, 0.918], [0.52, 0.945], 4),
  [0.45, 0.93],
  [0.42, 0.88],
  ...curve([0.42, 0.88], [0.41, 0.6], [0.44, 0.47], 3),
  [0.8, 0.43],
  [1.1, 0.44],
  [1.25, 0.47],
];

/**
 * The skirts' depths: the panel from `in` to `mid` on the outline and its
 * face plate from `mid` to `out`, shrunk by `inset` all round, so the
 * panel's edge steps down to the face.
 */
const SKIRT_D = { in: 0.2, mid: 0.235, out: 0.25, inset: 0.015 } as const;

/**
 * The floor pan between the fairing and the rear cowl, `[a, h]`, the seat
 * standing on its raised back: a shade darker than the panels, and
 * narrower (`BELLY_HALF`).
 */
const BELLY: readonly P2[] = [
  [0.3, 0.1],
  [0.3, 0.24],
  [-0.02, 0.24],
  [-0.05, 0.3],
  [-0.46, 0.3],
  [-0.5, 0.1],
];

/** The floor pan's half width. */
const BELLY_HALF = 0.16;

/**
 * The rear cowl, `[a, h]`: the front face rising from the floor and
 * leaning back behind the seat, the rounded top as high as the fairing's
 * dash, the tail sloping down to its tip over the rear tyre, which it
 * ends ahead of, and the arch round the rear wheel's top and front.
 */
const COWL: readonly P2[] = [
  [-0.42, 0.1],
  [-0.36, 0.3],
  ...curve([-0.36, 0.3], [-0.44, 0.75], [-0.53, 0.99], 5),
  [-0.58, 1.035],
  [-0.68, 1.05],
  [-0.82, 1.04],
  [-0.94, 1.0],
  [-1.06, 0.93],
  [-1.18, 0.86],
  [-1.24, 0.83],
  ...arc(
    BIKE_WHEELS.rear.a,
    BIKE_WHEELS.rear.r,
    REAR_ARCH,
    archAngle(BIKE_WHEELS.rear.a, REAR_ARCH, -1.25),
    -40,
    12,
  ),
];

/**
 * The rear cowl's slices, `[half width, growth]`: three, the narrowest the
 * glossy crest, the tail light on its slope.
 */
const COWL_SLICES: readonly (readonly [number, number])[] = [
  [0.22, 0],
  [0.2, 0.015],
  [0.17, 0.03],
];

/**
 * The tail's slope the tail light lies on: the cowl's edge from `from` to
 * `to`, the light `length` long on its middle and `half` wide.
 */
const TAIL = {
  from: [-1.06, 0.93],
  to: [-1.18, 0.86],
  length: 0.1,
  half: 0.12,
} as const;

/**
 * The pinstripe along each side of the rear cowl, `[a, h]`: a line under
 * the top from the front face round to the tail.
 */
const PINSTRIPE: readonly P2[] = [
  [-0.49, 0.88],
  [-0.56, 0.96],
  [-0.68, 0.98],
  [-0.82, 0.97],
  [-0.94, 0.93],
  [-1.08, 0.85],
];

/**
 * The left side's swing arm, `[a, h]`: from its pivot under the seat's
 * back to the rear axle, outboard of the cowl (`ARM_D`); the silver cap
 * sits on its end over the axle.
 */
const ARM: readonly P2[] = [
  [-0.36, 0.31],
  [-0.36, 0.47],
  [BIKE_WHEELS.rear.a, 0.465],
  [BIKE_WHEELS.rear.a, 0.315],
];

/** The swing arm's depths on the `-d` side. */
const ARM_D = [0.215, 0.255] as const;

/**
 * The windscreen's side profile, `[a, h]`: a tall swept shield from the
 * nose's top up and back to `BIKE.screenTop` over the dash, its foot sunk
 * a little into the fairing's top. It is a hair wider than the skirts
 * (`SCREEN_HALF`), so it wraps over their top edge.
 */
const SCREEN_PROFILE: readonly P2[] = [
  [1.28, 0.835],
  ...curve([1.28, 0.835], [0.9, 0.97], [0.56, BIKE.screenTop], 5),
  [0.52, BIKE.screenTop],
  [0.49, 1.12],
  [0.47, 1.04],
  [0.5, 0.93],
  [0.95, 0.9],
];

/** The windscreen's half width: 5 mm wider than the skirts on each side. */
const SCREEN_HALF = 0.255;

/**
 * The engine's round covers low on each side of the rear cowl, behind the
 * seat: centre `[a, h]`, radius, the depths it stands out between, and a
 * silver cap on it.
 */
const ENGINE = { at: [-0.55, 0.2], r: 0.1, d: [0.2, 0.245] } as const;

/**
 * The side stand's side profile, `[a', h]` in the `sideways` frame, where
 * `a'` is `-d`: a bar from inside the floor pan's `-d` side down and out
 * to a flat foot on the floor.
 */
const STAND_PROFILE: readonly P2[] = [
  [0.15, 0.27],
  [0.175, 0.27],
  [0.435, 0],
  [0.41, 0],
];

/**
 * The headlight on the nose's flat front under the screen's foot: a wide
 * rectangle `half` wide and from `h0` to `h1`, in a black front panel
 * (`frame`, `[half, h0, h1]`), with an amber indicator at each of the
 * nose's corners.
 */
const HEADLAMP = {
  half: 0.14,
  h: [0.755, 0.815],
  frame: [0.165, 0.735, 0.835],
  indicator: { d: 0.185, h: 0.79, r: 0.012 },
} as const;

/**
 * One sticker on the bike: its mark, which side (`1` for `+d`, `-1` for
 * `-d`), the depth of the face it is laid on, its plate and ink, and
 * where it sits: `a` along the bike and `h` in height. The stickers are
 * not mirrored, as on the original.
 */
export interface BikeSticker {
  mark: string | readonly string[];
  side: 1 | -1;
  face: number;
  /** The plate's colour; `null`: the letters print straight on the paint. */
  plate: Rgb | null;
  ink: Rgb;
  a: readonly [number, number];
  h: readonly [number, number];
}

/** The front wheel cover's inner dome face, where its sticker sits. */
const WHEEL_FACE = BIKE_WHEELS.front.half + (DOMES[1]?.[1] ?? 0);

/**
 * The bike's five lettered stickers (2.6f C13), as on the original:
 * - on the left (`-d`) skirt the watch maker's white on a black plate,
 *   above the camera maker's red on a white plate, the largest; on the
 *   front wheel cover, under its middle, the helmet maker's black on a
 *   white plate;
 * - on the right (`+d`) skirt the big two-line sticker, orange on black;
 *   on the front wheel cover the other helmet maker's blue on white.
 * Every ink is its sticker's own, used by no other part of the bike.
 */
export const BIKE_STICKERS: readonly BikeSticker[] = [
  {
    mark: MARKS.bikeStickers[1],
    side: -1,
    face: SKIRT_D.out,
    plate: [0.03, 0.03, 0.035],
    ink: [0.97, 0.97, 0.97],
    a: [0.56, 0.98],
    h: [0.67, 0.77],
  },
  {
    mark: MARKS.bikeStickers[0],
    side: -1,
    face: SKIRT_D.out,
    plate: [0.96, 0.96, 0.93],
    ink: [0.8, 0.05, 0.05],
    a: [0.62, 1.1],
    h: [0.52, 0.64],
  },
  {
    mark: MARKS.bikeStickers[3],
    side: -1,
    face: WHEEL_FACE,
    plate: [0.94, 0.94, 0.91],
    ink: [0.02, 0.02, 0.03],
    a: [BIKE_WHEELS.front.a - 0.13, BIKE_WHEELS.front.a + 0.13],
    h: [BIKE_WHEELS.front.r - 0.15, BIKE_WHEELS.front.r - 0.06],
  },
  {
    mark: MARKS.bikeBigOne,
    side: 1,
    face: SKIRT_D.out,
    plate: [0.04, 0.04, 0.045],
    ink: [1.0, 0.55, 0.1],
    a: [0.64, 0.92],
    h: [0.5, 0.82],
  },
  {
    mark: MARKS.bikeStickers[2],
    side: 1,
    face: WHEEL_FACE,
    plate: [0.98, 0.98, 0.97],
    ink: [0.1, 0.3, 0.75],
    a: [BIKE_WHEELS.front.a - 0.13, BIKE_WHEELS.front.a + 0.13],
    h: [BIKE_WHEELS.front.r - 0.15, BIKE_WHEELS.front.r - 0.06],
  },
];

/**
 * The round stickers high on each skirt's nose end, at `at` with radius
 * `r`: the star roundel on the left, the smiley on the right.
 */
const BADGE = { at: [1.13, 0.74], r: 0.045 } as const;

/**
 * A five-pointed star outline round `(a, h)`, its outer points at radius
 * `r` and the inner corners at `inner`, one point straight up.
 */
function star(a: number, h: number, r: number, inner: number): P2[] {
  return Array.from({ length: 10 }, (_, i): P2 => {
    const t = Math.PI / 2 + (i * Math.PI) / 5;
    const q = i % 2 === 0 ? r : inner;
    return [a + q * Math.cos(t), h + q * Math.sin(t)];
  });
}

/**
 * A mark's box inset by one pixel of the block fitted into it, so the
 * letters stand clear of its plate's (or notice's) edge.
 */
function insetBox(
  lines: string | readonly string[],
  [a0, a1, h0, h1]: readonly [number, number, number, number],
): [number, number, number, number] {
  const rows = textBlock(typeof lines === "string" ? [lines] : lines);
  const m = fit(rows, a0, a1, h0, h1).px;
  return [a0 + m, a1 - m, h0 + m, h1 - m];
}

/**
 * One wheel: the round tyre in three slices and on each side the red
 * cover's two domes; the rear one's silver cap on the `+d` side.
 */
function bikeWheel(k: Kit, s: Surfaces, w: BikeWheel, cap: boolean): void {
  const [tread, wall] = [s.tinted(TREAD), s.tinted(TYRE)];
  TYRE_SLICES.forEach(([inR, inD], i) =>
    k.extrude(
      discOutline(w.a, w.r, w.r - inR, TYRE_SIDES, "top"),
      -(w.half - inD),
      w.half - inD,
      i === 0 ? tread : wall,
    ),
  );
  let d0 = w.half;
  DOMES.forEach(([share, out], i) => {
    const disc = discOutline(w.a, w.r, w.r * share, DOME_SIDES, "top");
    const paint = s.tinted(i === 0 ? BIKE_RED : BIKE_SHINE);
    k.extrude(disc, d0, w.half + out, paint);
    k.extrude(disc, -(w.half + out), -d0, paint);
    d0 = w.half + out;
  });
  if (cap)
    k.extrude(
      discOutline(w.a, w.r, CAP.r, 12),
      d0,
      d0 + CAP.t,
      s.tinted(HUB_SILVER),
    );
}

/**
 * The red bike: two fat round tyres at the ends with red domed covers;
 * the front fairing over the front wheel in slices, its side skirts, the
 * tall swept windscreen, the wide headlight in its black front panel
 * between two indicators, the dash, the handlebar and the mirrors; the
 * low floor pan over the black chassis with the bucket seat and its tall
 * backrest; the tall rear cowl in slices with its pinstripe and the tail
 * light on its slope; the engine covers, the left swing arm and the side
 * stand; and the stickers, each on its own side.
 */
const redBike: HeroRecipe = ({ k, kitAt, s }) => {
  const red = s.tinted(BIKE_RED);
  const shine = s.tinted(BIKE_SHINE);
  const lower = s.tinted(shade(BIKE_RED, 0.75));
  const black = s.tinted(BIKE_BLACK);
  const dark = s.tinted(BIKE_DARK);
  const silver = s.tinted(HUB_SILVER);
  const side = kitAt(sideways(ORIGIN));
  // The back view, for the `-d` side's decals: a' is -a, d' is -d.
  const back = kitAt(yawed(ORIGIN, 0, 0, Math.PI));
  const L = DECAL_LIFT;

  bikeWheel(k, s, BIKE_WHEELS.front, false);
  bikeWheel(k, s, BIKE_WHEELS.rear, true);

  // The front fairing: the middle in slices, the skirts and their faces.
  CORE_SLICES.forEach(([half, g], i) =>
    k.extrude(grown(CORE, g), -half, half, i === 0 ? red : shine),
  );
  const face = grown(SKIRT, -SKIRT_D.inset);
  for (const d of [-1, 1]) {
    k.extrude(SKIRT, d * SKIRT_D.in, d * SKIRT_D.mid, red);
    k.extrude(face, d * SKIRT_D.mid, d * SKIRT_D.out, red);
  }
  k.extrude(SCREEN_PROFILE, -SCREEN_HALF, SCREEN_HALF, s.tinted(SCREEN));

  // The dash behind the screen, the handlebar, its grips and the mirrors.
  k.box(0.4, 0.47, -0.12, 0.12, 0.93, 1.03, dark);
  k.box(0.37, 0.43, -0.3, 0.3, 0.98, 1.01, black);
  for (const d of [-1, 1]) {
    k.box(0.36, 0.42, d * 0.25, d * 0.33, 0.975, 1.015, dark);
    k.box(0.38, 0.4, d * 0.3, d * 0.32, 1.0, 1.09, black);
    k.box(0.375, 0.405, d * 0.27, d * 0.37, 1.075, 1.13, dark);
  }

  // The headlight in its black front panel, and the indicators.
  const nose = 1.31 + (CORE_SLICES[1]?.[1] ?? 0);
  const rect = (half: number, h0: number, h1: number): P2[] => [
    [-half, h0],
    [half, h0],
    [half, h1],
    [-half, h1],
  ];
  const [fHalf, fh0, fh1] = HEADLAMP.frame;
  side.extrude(rect(fHalf, fh0, fh1), nose, nose + 0.005, black);
  side.extrude(
    rect(HEADLAMP.half, HEADLAMP.h[0], HEADLAMP.h[1]),
    nose + 0.005,
    nose + 0.009,
    s.signal(HEADLIGHT),
  );
  const ind = HEADLAMP.indicator;
  for (const d of [-1, 1])
    side.extrude(
      discOutline(-d * ind.d, ind.h, ind.r, 8),
      1.31,
      1.316,
      s.tinted(INDICATOR),
    );

  // The floor pan over the black chassis, the seat and its backrest.
  k.extrude(BELLY, -BELLY_HALF, BELLY_HALF, lower);
  k.box(-0.45, 0.75, -0.12, 0.12, 0.076, 0.1, black);
  k.bevelBox(-0.39, -0.01, -0.18, 0.18, 0.3, 0.38, 0.02, s.tinted(SADDLE_EDGE));
  k.bevelBox(-0.38, -0.02, -0.16, 0.16, 0.31, 0.42, 0.03, s.tinted(SADDLE));
  k.extrude(
    tiltedBar(-0.38, 0.65, Math.atan2(0.46, -0.1), 0.47, 0.07),
    -0.16,
    0.16,
    s.tinted(SADDLE_EDGE),
  );
  k.extrude(
    tiltedBar(-0.365, 0.66, Math.atan2(0.46, -0.1), 0.42, 0.05),
    -0.13,
    0.13,
    s.tinted(SADDLE),
  );

  // The rear cowl in slices, its pinstripe and the tail light.
  COWL_SLICES.forEach(([half, g], i) =>
    k.extrude(
      grown(COWL, g),
      -half,
      half,
      i === COWL_SLICES.length - 1 ? shine : red,
    ),
  );
  const outer = COWL_SLICES[0]?.[0] ?? 0;
  const accent = s.tinted(ACCENT);
  for (const d of [-1, 1])
    profileLine(k, PINSTRIPE, 0.012, d * outer, d * (outer + 0.004), accent);
  // The tail light lies on the crest's slope: the slope's edge moved out
  // along its normal (up and back) by the crest's growth, then the dark
  // bezel and the light, each standing proud of the one under it.
  const [, crestGrow] = COWL_SLICES[COWL_SLICES.length - 1] ?? [0, 0];
  const [p, q] = [TAIL.from, TAIL.to];
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const [nx, nh] = [(q[1] - p[1]) / len, -(q[0] - p[0]) / len];
  const tilt = Math.atan2(q[1] - p[1], q[0] - p[0]);
  const [ma, mh] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const onSlope = (out: number, length: number, width: number) =>
    tiltedBar(ma + nx * out, mh + nh * out, tilt, length, width);
  k.extrude(
    onSlope(crestGrow + 0.004, TAIL.length + 0.03, 0.008),
    -TAIL.half - 0.015,
    TAIL.half + 0.015,
    dark,
  );
  k.extrude(
    onSlope(crestGrow + 0.011, TAIL.length, 0.008),
    -TAIL.half,
    TAIL.half,
    s.blink(TAIL_LIGHT, 0),
  );

  // The engine covers and their caps, the left swing arm and its cap.
  const [ea, eh] = ENGINE.at;
  const [ed0, ed1] = ENGINE.d;
  for (const d of [-1, 1]) {
    k.extrude(discOutline(ea, eh, ENGINE.r, 12), d * ed0, d * ed1, red);
    k.extrude(
      discOutline(ea, eh, ENGINE.r * 0.55, 10),
      d * ed1,
      d * (ed1 + CAP.t),
      silver,
    );
  }
  k.extrude(ARM, -ARM_D[0], -ARM_D[1], lower);
  const ra = BIKE_WHEELS.rear;
  k.extrude(discOutline(ra.a, ra.r, 0.09, 12), -ARM_D[0], -ARM_D[1], lower);
  k.extrude(
    discOutline(ra.a, ra.r, CAP.r, 12),
    -ARM_D[1],
    -ARM_D[1] - CAP.t,
    silver,
  );
  side.extrude(STAND_PROFILE, -0.22, -0.18, black);

  // The lettered stickers, each on its own side: a plate one lift proud
  // of its face and its letters one more. The `-d` side is laid from the
  // back view, so its letters read left to right from that side.
  for (const st of BIKE_STICKERS) {
    const [a0, a1] = st.a;
    const [h0, h1] = st.h;
    const kk = st.side === 1 ? k : back;
    const [s0, s1] = st.side === 1 ? [a0, a1] : [-a1, -a0];
    if (st.plate !== null)
      kk.panel(s0, s1, st.face + L, h0, h1, s.tinted(st.plate));
    markLines(
      kk,
      st.mark,
      insetBox(st.mark, [s0, s1, h0, h1]),
      st.face + (st.plate === null ? 1 : 2) * L,
      s.tinted(st.ink),
    );
  }

  // The round stickers on the skirts' nose ends: the star roundel with its
  // two bars on the left, the smiley on the right.
  const [ba, bh] = BADGE.at;
  const r = BADGE.r;
  const f = SKIRT_D.out;
  back.extrude(discOutline(-ba, bh, r, 14), f, f + L, s.tinted(ROUNDEL.blue));
  back.extrude(
    star(-ba, bh, r * 0.78, r * 0.31),
    f + L,
    f + 2 * L,
    s.tinted(ROUNDEL.white),
  );
  for (const sg of [-1, 1]) {
    // Each bar from the disc's rim outward, its low end first.
    const [x0, x1] = [-ba + sg * r, -ba + sg * 2.2 * r];
    const [b0, b1] = [Math.min(x0, x1), Math.max(x0, x1)];
    back.panel(
      b0,
      b1,
      f + L,
      bh - 0.35 * r,
      bh + 0.35 * r,
      s.tinted(ROUNDEL.white),
    );
    back.panel(
      b0,
      b1,
      f + 2 * L,
      bh - 0.12 * r,
      bh + 0.12 * r,
      s.tinted(ROUNDEL.red),
    );
  }
  k.extrude(discOutline(ba, bh, r, 14), f, f + L, s.tinted(SMILEY.face));
  const smile = s.tinted(SMILEY.ink);
  for (const sg of [-1, 1]) {
    k.panel(
      ba + sg * 0.35 * r - 0.004,
      ba + sg * 0.35 * r + 0.004,
      f + 2 * L,
      bh + 0.15 * r,
      bh + 0.5 * r,
      smile,
    );
    k.panel(
      ba + sg * 0.55 * r - 0.004,
      ba + sg * 0.55 * r + 0.004,
      f + 2 * L,
      bh - 0.4 * r,
      bh - 0.2 * r,
      smile,
    );
  }
  k.panel(
    ba - 0.45 * r,
    ba + 0.45 * r,
    f + 2 * L,
    bh - 0.55 * r,
    bh - 0.4 * r,
    smile,
  );
};

/** The neon bike's body: a glossy near black with a cold blue cast. */
export const CYCLE_BODY: Rgb = [0.03, 0.035, 0.06];

/** The gloss on the neon bike's crests: a lighter blue-black. */
export const CYCLE_SHINE: Rgb = [0.07, 0.08, 0.13];

/**
 * The neon bike's lower panel: a shade lighter than the band and a
 * little bluer, so it reads as part of the body and the split shows
 * through its glowing line and the recess, not through a light colour.
 */
export const CYCLE_LOWER: Rgb = [0.045, 0.052, 0.085];

/** The neon bike's canopy: a dark smoked blue. */
export const CYCLE_CANOPY: Rgb = [0.05, 0.08, 0.16];

/** The neon bike's hub covers: the body's black. */
const CYCLE_HUB: Rgb = [0.02, 0.022, 0.035];

/** The neon bike's glow: the bright cyan blue of its lines and rims. */
export const CYCLE_GLOW: Rgb = [0.3, 0.8, 1.0];

/**
 * The neon bike's size, in metres: `length` from tyre to tyre along
 * `a` and `top`, the canopy's top. No source gives the original's size,
 * so it fills the hall footprint it already had (3.0 m); its proportions
 * are the film model's, measured off a side view of a kit cut from the
 * film's own files: the wheels a quarter of its length, the top 0.44 of
 * it and so 1.8 times a wheel.
 */
export const CYCLE = { length: 2.9, top: 1.28 } as const;

/**
 * The neon bike's two wheels, the front one at `+a`: its axle at `a`
 * (at height `r`), `r` the tyre's radius and `half` its half width. They
 * are the same size and fat, and their treads are the cycle's two ends.
 */
export const CYCLE_WHEELS = {
  front: { a: 1.09, r: 0.36, half: 0.14 },
  rear: { a: -1.09, r: 0.36, half: 0.14 },
} as const satisfies Record<string, BikeWheel>;

/** The arch over each wheel: its radius round the axle. */
const CYCLE_ARCH = 0.4;

/**
 * Where the shell starts along `a` behind: its square back edge, which
 * hides the rear wheel's front, as on the original.
 */
const CYCLE_BACK = -1.0;

/** The height of the shell's flat belly between the wheels. */
const CYCLE_BELLY = 0.19;

/**
 * The shell's back, `[a, h]`, from the tail forward to the nose: it
 * rises from over the rear axle, runs nearly level under the canopy
 * over the rider's place (0.25.2: low enough that the canopy stands a
 * proper top piece over the crests), climbs to its crown a little ahead
 * of the middle and falls in a long curve to the nose over the front
 * wheel. The crests grown on it (`CYCLE_SLICES`) stand `CYCLE_CREST`
 * above it.
 */
const CYCLE_SPINE: readonly P2[] = [
  [-1.42, 0.74],
  [-1.41, 0.86],
  [-1.29, 0.97],
  [-1.0, 1.035],
  [-0.72, 1.07],
  [-0.55, 1.09],
  [-0.38, 1.1],
  [-0.13, 1.105],
  [0.1, 1.17],
  [0.38, 1.22],
  [0.6, 1.19],
  [0.74, 1.155],
  [0.89, 1.105],
  [1.1, 1.0],
  [1.25, 0.92],
  [1.39, 0.825],
  [1.43, 0.74],
];

const { front: FW, rear: RW } = CYCLE_WHEELS;

/**
 * Where the front arch is split between the band and the panel, in
 * degrees round the front axle: behind and below its top.
 */
const FRONT_SPLIT = 150;

/** The front arch's band part, from its upper front over the top. */
const FRONT_HOOD = arc(FW.a, FW.r, CYCLE_ARCH, 35, FRONT_SPLIT, 10);

/**
 * How far the lower panel's corners are rounded: `front` where the front
 * arch runs into the belly, `back` where the belly meets the back edge.
 */
const PANEL_ROUND = { front: 0.16, back: 0.1 } as const;

/**
 * The front corner's round, `[a, h]`: its centre `PANEL_ROUND.front`
 * over the belly, touching the front arch from outside, and the angle
 * (degrees round the front axle) where it meets the arch.
 */
const FRONT_ROUND = (() => {
  const r = PANEL_ROUND.front;
  const dh = CYCLE_BELLY + r - FW.r;
  const da = -Math.sqrt((CYCLE_ARCH + r) ** 2 - dh ** 2);
  return {
    a: FW.a + da,
    h: CYCLE_BELLY + r,
    at: 180 - (Math.atan2(dh, -da) * 180) / Math.PI,
  };
})();

/**
 * The front arch's panel part, from the split down along the arch, then
 * round its corner (`FRONT_ROUND`) onto the belly, so the panel's front
 * follows the wheel's hood.
 */
const FRONT_FOOT: readonly P2[] = [
  ...arc(FW.a, FW.r, CYCLE_ARCH, FRONT_SPLIT, FRONT_ROUND.at, 5),
  ...arc(
    FRONT_ROUND.a,
    FRONT_ROUND.h,
    PANEL_ROUND.front,
    FRONT_ROUND.at - 180,
    -90,
    5,
  ).slice(1),
];

/**
 * The back corner, from the belly round up onto the square back edge,
 * `PANEL_ROUND.back` in from both.
 */
const BACK_FOOT = arc(
  CYCLE_BACK + PANEL_ROUND.back,
  CYCLE_BELLY + PANEL_ROUND.back,
  PANEL_ROUND.back,
  -90,
  -180,
  4,
);

/** The rear arch, from the back edge over the rear wheel's top. */
const REAR_HOOD = arc(
  RW.a,
  RW.r,
  CYCLE_ARCH,
  archAngle(RW.a, CYCLE_ARCH, CYCLE_BACK),
  125,
  6,
);

/**
 * The split between the arched band and the lower panel, `[a, h]`, its
 * inner points from the back edge forward: level along the flank a
 * little under the middle of the body, then falling to the front arch.
 * Its ends are the rear arch's first point and the front arch's split.
 */
const CYCLE_SPLIT: readonly P2[] = [
  [-0.7, 0.79],
  [-0.2, 0.8],
  [0.3, 0.78],
  [0.6, 0.72],
];

/**
 * The neon bike's arched band, `[a, h]`, the body's upper part as on
 * the original: it hoods the front wheel from its upper front round over
 * the top, runs back along the split to the back edge, hoods the rear
 * wheel over its top to behind the axle, and its back (`CYCLE_SPINE`)
 * runs from the tail forward to the nose.
 */
const CYCLE_BAND: readonly P2[] = [
  ...FRONT_HOOD,
  ...[...CYCLE_SPLIT].reverse(),
  ...REAR_HOOD,
  ...CYCLE_SPINE,
];

/**
 * The lower panel, `[a, h]`, under the band and recessed from it
 * (`PANEL_HALF`): from the front arch's split down along the arch and
 * round onto the flat belly, back to the square back edge, which hides
 * the rear wheel's front, round up that edge to the band and forward
 * along the split.
 */
export const CYCLE_PANEL: readonly P2[] = [
  ...FRONT_FOOT,
  ...BACK_FOOT,
  ...REAR_HOOD.slice(0, 1),
  ...CYCLE_SPLIT,
];

/**
 * The neon bike's whole body, `[a, h]`: the band and the panel as one
 * closed outline, which the glossy crests (`CYCLE_SLICES`) are grown
 * from.
 */
const CYCLE_SHELL: readonly P2[] = [
  ...FRONT_HOOD,
  ...FRONT_FOOT.slice(1),
  ...BACK_FOOT,
  ...REAR_HOOD,
  ...CYCLE_SPINE,
];

/** The lower panel's half width: set in from the band's. */
const PANEL_HALF = 0.17;

/** How far the highest crest stands above the back. */
const CYCLE_CREST = 0.035;

/**
 * The shell's slices, `[half width, growth]`: the wide one, which is
 * the band (the panel stands `PANEL_HALF` in from it), and two narrower
 * glossy crests grown proud of the whole shell, so its edges read
 * rounded.
 */
const CYCLE_SLICES: readonly (readonly [number, number])[] = [
  [0.2, 0],
  [0.165, 0.02],
  [0.11, CYCLE_CREST],
];

/**
 * Where the canopy runs along `a`: a short dark top piece over the
 * rider's place, from behind the back's crown forward to the crown's
 * foot, set back from the original's longer strip so the body does not
 * read as a car's roof.
 */
export const CANOPY_SPAN = { from: -0.48, to: 0.08 } as const;

/**
 * The canopy's half width: over both crests, inside the wide slice, so
 * from the side it shows as a dark piece standing on the back.
 */
const CANOPY_HALF = 0.17;

/** How far the canopy's foot sinks into the shell under the back. */
const CANOPY_SINK = 0.05;

/**
 * How the canopy's two ends are rounded (0.25.2): each end is a quarter
 * ellipse `a` long along the back and `h` tall, from where its foot
 * meets the back up to the level crown, so the piece reads as a smoked
 * dome and not as a slab. The back end runs longer than the front.
 */
const CANOPY_ROUND = {
  back: { a: 0.2, h: 0.14 },
  front: { a: 0.14, h: 0.1 },
} as const;

/** The back's height at `a`, along `CYCLE_SPINE`. */
function spineAt(a: number): number {
  for (let i = 0; i + 1 < CYCLE_SPINE.length; i++) {
    const p = CYCLE_SPINE[i];
    const q = CYCLE_SPINE[i + 1];
    if (!p || !q || a < p[0] || a > q[0]) continue;
    return p[1] + ((q[1] - p[1]) * (a - p[0])) / (q[0] - p[0]);
  }
  throw new Error(`spineAt: ${String(a)} is off the back`);
}

/** The glowing lines' width and how far they stand off their face. */
const CYCLE_LINE = { width: 0.016, out: 0.004 } as const;

/**
 * Where along `a` the canopy's foot has a point: its two ends and the
 * back's points between them, so the foot follows the back.
 */
const CANOPY_AT: readonly number[] = [
  CANOPY_SPAN.from,
  ...CYCLE_SPINE.map(([a]) => a).filter(
    (a) => a > CANOPY_SPAN.from && a < CANOPY_SPAN.to,
  ),
  CANOPY_SPAN.to,
];

/**
 * The canopy's ridge height: level, so the glowing line along it tops
 * out at the cycle's top, a few millimetres under it for the line's
 * mitres on the rounded ends. The back runs low under it, so the canopy
 * stands 12 to 15 cm over the crests (`CYCLE_CREST`) at its highest.
 */
const CANOPY_TOP = CYCLE.top - CYCLE_LINE.width / 2 - 0.003;

/** Points on each rounded end of the canopy's ridge. */
const CANOPY_ROUND_STEPS = 5;

/**
 * The canopy's ridge, `[a, h]`, from its back end to its front: a quarter
 * ellipse up from the back end (`CANOPY_ROUND.back`), level along the
 * crown, and a shorter quarter ellipse down to the front end
 * (`CANOPY_ROUND.front`).
 */
const CANOPY_RIDGE: readonly P2[] = (() => {
  const { back, front } = CANOPY_ROUND;
  const n = CANOPY_ROUND_STEPS;
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = ((Math.PI / 2) * i) / n;
    out.push([
      CANOPY_SPAN.from + back.a * (1 - Math.cos(t)),
      CANOPY_TOP - back.h * (1 - Math.sin(t)),
    ]);
  }
  for (let i = 0; i <= n; i++) {
    const t = ((Math.PI / 2) * i) / n;
    out.push([
      CANOPY_SPAN.to - front.a * (1 - Math.sin(t)),
      CANOPY_TOP - front.h * (1 - Math.cos(t)),
    ]);
  }
  return out;
})();

/**
 * The canopy over the rider, `[a, h]`: a short smoked piece on the back,
 * its ridge `CANOPY_RIDGE` and its foot following the back
 * `CANOPY_SINK` under it, inside the crests.
 */
const CYCLE_CANOPY_PROFILE: readonly P2[] = [
  ...CANOPY_RIDGE,
  ...[...CANOPY_AT].reverse().map((a): P2 => [a, spineAt(a) - CANOPY_SINK]),
];

/** How far in from the shell's outline its glowing side line runs. */
const CYCLE_LINE_IN = 0.045;

/**
 * The neon bike's glowing side lines, `[a, h]`, as open polylines: the
 * band's outline traced `CYCLE_LINE_IN` inside it, all the way round,
 * closed on itself, so a line runs over the hoods, along the back and
 * along the split over the panel.
 */
export function cycleLine(): P2[] {
  const inner = grown(CYCLE_BAND, -CYCLE_LINE_IN);
  const first = inner[0];
  return first === undefined ? inner : [...inner, first];
}

/**
 * One neon bike wheel: the tread a solid glowing disc, under a dark
 * cover on each side that leaves only its rim lit, and the axle through
 * the body from side to side.
 */
function cycleWheel(k: Kit, s: Surfaces, w: BikeWheel, glow: Surface): void {
  k.extrude(discOutline(w.a, w.r, w.r, 24, "top"), -w.half, w.half, glow);
  const hub = s.tinted(CYCLE_HUB);
  for (const sg of [-1, 1]) {
    k.extrude(
      discOutline(w.a, w.r, w.r - 0.05, 20, "top"),
      sg * w.half,
      sg * (w.half + 0.012),
      hub,
    );
    k.extrude(
      discOutline(w.a, w.r, w.r - 0.15, 14, "top"),
      sg * (w.half + 0.012),
      sg * (w.half + 0.02),
      s.tinted(CYCLE_SHINE),
    );
  }
  const half = (CYCLE_SLICES[0]?.[0] ?? 0) - 0.01;
  k.extrude(discOutline(w.a, w.r, 0.05, 10), -half, half, hub);
}

/**
 * The neon bike: two fat wheels of one size at its ends, their rims
 * glowing; the dark glossy shell, its arched band hooding both wheels
 * and running over the top, the lower panel a shade lighter recessed
 * under it low between the wheels, its front and bottom rounded, and the crests over both; the short smoked
 * canopy on its back over the rider, behind the crown; and the glowing
 * lines tracing the band's outline on both sides and the canopy's
 * ridge. Every light is in one group and breathes.
 */
const neonBikeClosed: HeroRecipe = ({ k, s }) => {
  const glow = s.blink(CYCLE_GLOW, 0);
  cycleWheel(k, s, CYCLE_WHEELS.front, glow);
  cycleWheel(k, s, CYCLE_WHEELS.rear, glow);

  const [body, shine] = [s.tinted(CYCLE_BODY), s.tinted(CYCLE_SHINE)];
  const outer = CYCLE_SLICES[0]?.[0] ?? 0;
  k.extrude(CYCLE_BAND, -outer, outer, body);
  k.extrude(CYCLE_PANEL, -PANEL_HALF, PANEL_HALF, s.tinted(CYCLE_LOWER));
  for (const [half, g] of CYCLE_SLICES.slice(1))
    k.extrude(grown(CYCLE_SHELL, g), -half, half, shine);
  const canopy = s.tinted(CYCLE_CANOPY);
  k.extrude(CYCLE_CANOPY_PROFILE, -CANOPY_HALF, CANOPY_HALF, canopy);

  const { width, out } = CYCLE_LINE;
  const line = cycleLine();
  for (const d of [-1, 1]) {
    profileLine(k, line, width, d * outer, d * (outer + out), glow);
    profileLine(
      k,
      CANOPY_RIDGE,
      width,
      d * CANOPY_HALF,
      d * (CANOPY_HALF + out),
      glow,
    );
  }
};

/**
 * The open variant's size, in metres: `length` from tyre to tyre, the
 * same as the closed one's, and `top`, the crown of its tail behind the
 * empty rider's place. The full size cycle it follows has no canopy and
 * no roof: its highest point is the rider's back, and without a rider
 * the tail behind the seat, about a third of its length up. That is
 * lower than the kind's catalogue top (`CYCLE.top`), which the closed
 * variant sets.
 */
export const CYCLE_OPEN = { length: 2.9, top: 0.93 } as const;

/** One hubless wheel of the open variant. */
interface OpenWheel {
  a: number;
  r: number;
  open: number;
  rim: number;
  half: number;
}

/**
 * The open variant's hubless wheels, the front one at `+a`: the axle
 * line at `a` (at height `r`), `r` the tyre's outer radius, `open` the
 * radius of the open middle, which the glowing inner rim (`rim` thick)
 * lines, and `half` the tyre's half width. A quarter of the length
 * across, at the same places as the closed variant's wheels.
 */
export const OPEN_WHEELS = {
  front: { a: 1.09, r: 0.36, open: 0.245, rim: 0.02, half: 0.17 },
  rear: { a: -1.09, r: 0.36, open: 0.245, rim: 0.02, half: 0.17 },
} as const satisfies Record<string, OpenWheel>;

/** The tyres' rubber: a black a shade off the body's. */
export const OPEN_TYRE: Rgb = [0.02, 0.021, 0.028];

/** The tyres' side faces: a dark grey with the body's blue cast. */
const OPEN_SIDE: Rgb = [0.07, 0.075, 0.1];

/** The seat pad in the saddle hollow: the lower panel's shade. */
export const OPEN_SEAT: Rgb = CYCLE_LOWER;

/** The handles and the footrests: a dark metal. */
export const OPEN_METAL: Rgb = [0.16, 0.17, 0.2];

/** Facets round a whole tyre ring; each half ring takes half of them. */
const OPEN_SIDES = 20;

/**
 * The glowing inner rim on each side of a tyre: how far it reaches into
 * the open middle's wall from the side (`deep`), so the wall itself stays
 * black and the hole reads open from an angle, and how far it stands
 * proud of the tyre's side and of its open middle (`proud`).
 */
const OPEN_RIM = { deep: 0.03, proud: 0.003 } as const;

/** How far a tyre's side face stands proud of the tyre and how far in. */
const OPEN_FACE = { t: 0.008, in: 0.012 } as const;

/**
 * One half of a flat ring round `(a, h)` from radius `r0` to `r1`, its
 * upper half (`up`) or its lower one: the outer arc one way and the
 * inner arc back, a simple outline the kit can extrude, so two halves
 * make a ring that is open in the middle.
 */
function halfRing(
  a: number,
  h: number,
  r0: number,
  r1: number,
  up: boolean,
): P2[] {
  const n = OPEN_SIDES / 2;
  const [from, to] = up ? [0, 180] : [180, 360];
  return [...arc(a, h, r1, from, to, n), ...arc(a, h, r0, to, from, n)];
}

/** A flat ring from `r0` to `r1`, open in the middle, between `d0` and `d1`. */
function openRing(
  k: Kit,
  w: OpenWheel,
  r0: number,
  r1: number,
  d0: number,
  d1: number,
  surf: Surface,
): void {
  for (const up of [true, false])
    k.extrude(halfRing(w.a, w.r, r0, r1, up), d0, d1, surf);
}

/**
 * One hubless wheel: a fat black tyre ring from the open middle's rim
 * out to the tread, a dark side face set on each of its sides, and the
 * glowing inner rim lining the open middle, a little narrower than the
 * tyre, so from the side it shows as a lit ring round the hole and the
 * floor shows through the middle.
 */
function openWheel(k: Kit, s: Surfaces, w: OpenWheel, glow: Surface): void {
  const inner = w.open + w.rim;
  openRing(k, w, w.open, w.r, -w.half, w.half, s.tinted(OPEN_TYRE));
  const face = s.tinted(OPEN_SIDE);
  for (const sg of [-1, 1]) {
    openRing(
      k,
      w,
      w.open - OPEN_RIM.proud,
      inner,
      sg * (w.half - OPEN_RIM.deep),
      sg * (w.half + OPEN_RIM.proud),
      glow,
    );
    openRing(
      k,
      w,
      inner + OPEN_FACE.in,
      w.r - OPEN_FACE.in,
      sg * w.half,
      sg * (w.half + OPEN_FACE.t),
      face,
    );
  }
}

/** The open body's half width: inside the tyres'. */
const OPEN_HALF = 0.13;

/**
 * The glossy crest grown over the open body (`grown`), `g` proud of its
 * outline and `half` wide, so its edges read rounded.
 */
const OPEN_CREST = { half: 0.085, g: 0.02 } as const;

/**
 * The open variant's saddle hollow, `[a, h]`, from its front lip back
 * to its back lip: the dip in the top where the empty rider's place is,
 * between the tank in front and the tail behind.
 */
export const OPEN_SADDLE: readonly P2[] = [
  [0.3, 0.8],
  [0.2, 0.765],
  [0.08, 0.74],
  [-0.12, 0.74],
  [-0.26, 0.765],
  [-0.36, 0.82],
];

/**
 * The open body's top, `[a, h]`, from the front ring back to the tail:
 * up out of the front ring's open middle over its upper back, along the
 * tank past the handles, down into the saddle hollow, up to the crown
 * behind it and back over the rear wheel's top to the tail's tip.
 */
const OPEN_TOP: readonly P2[] = [
  [1.06, 0.58],
  [1.03, 0.69],
  [0.92, 0.76],
  [0.7, 0.79],
  [0.45, 0.805],
  ...OPEN_SADDLE,
  [-0.5, 0.885],
  [-0.68, 0.92],
  [-0.86, CYCLE_OPEN.top],
  [-1.04, 0.92],
  [-1.2, 0.885],
  [-1.32, 0.82],
  [-1.38, 0.76],
];

/**
 * The open variant's body, `[a, h]`: a long low wedge bridging the two
 * rings. Its top (`OPEN_TOP`) runs from the front ring to the tail's
 * tip; under the tail it runs forward over the rear tyre, dips into the
 * rear ring's open middle over its upper front, down along its rim to
 * the axle line and onto the flat belly, then up into the front ring the
 * same way. Each ring's middle stays open below the axle and on its
 * outer side, so the floor shows through.
 */
export const OPEN_BODY: readonly P2[] = [
  ...OPEN_TOP,
  [-1.3, 0.735],
  [-1.18, 0.76],
  [-1.1, 0.74],
  [-1.06, 0.58],
  [-0.99, 0.47],
  [-0.88, 0.37],
  [-0.8, 0.28],
  [-0.68, 0.21],
  [-0.5, 0.19],
  [0.5, 0.19],
  [0.68, 0.21],
  [0.8, 0.28],
  [0.88, 0.37],
  [0.99, 0.47],
];

/**
 * The seat pad in the hollow, `[a, h]`: its top `OPEN_SEAT_LIFT` over
 * the hollow and its foot sunk into the body under it.
 */
const OPEN_SEAT_LIFT = 0.032;

/** The seat pad's half width: inside the body's. */
const OPEN_SEAT_HALF = 0.1;

/** The seat pad's top, along the hollow, the glowing seat line's path. */
const OPEN_SEAT_TOP: readonly P2[] = OPEN_SADDLE.slice(1, -1).map(
  ([a, h]): P2 => [a, h + OPEN_SEAT_LIFT],
);

/** The seat pad's outline, its top and its foot 6 cm under the hollow. */
const OPEN_SEAT_PROFILE: readonly P2[] = [
  ...OPEN_SEAT_TOP,
  ...[...OPEN_SADDLE.slice(1, -1)].reverse().map(([a, h]): P2 => [a, h - 0.06]),
];

/**
 * The handles, two short bars out of the body's flanks at the front,
 * behind the front ring: along `a` from `a0` to `a1`, at `h`, `t` thick,
 * reaching out to `out` on each side.
 */
const OPEN_HANDLES = {
  a0: 0.6,
  a1: 0.7,
  h: 0.74,
  t: 0.04,
  out: 0.3,
} as const;

/**
 * The footrests, two short pegs out of the flanks at the back, low and
 * ahead of the rear ring: along `a` from `a0` to `a1`, at `h`, `t`
 * thick, reaching out to `out` on each side.
 */
const OPEN_FOOTRESTS = {
  a0: -0.72,
  a1: -0.6,
  h: 0.36,
  t: 0.03,
  out: 0.24,
} as const;

/** How far in from the body's outline its glowing flank line runs. */
const OPEN_LINE_IN = 0.04;

/**
 * The open variant's glowing flank line, `[a, h]`, as an open polyline:
 * the body's top traced `OPEN_LINE_IN` under it, from the front ring
 * back to the tail, dipping with the saddle hollow.
 */
function openFlankLine(): P2[] {
  return grown(OPEN_BODY, -OPEN_LINE_IN).slice(1, OPEN_TOP.length - 1);
}

/**
 * The open variant's lower light line on each flank, `[a, h]`: from
 * under the handles it sweeps down and back to the belly and runs along
 * it to the footrests, the long curve the full size cycle's flank
 * carries.
 */
const OPEN_SWEEP: readonly P2[] = [
  [0.86, 0.66],
  [0.72, 0.56],
  [0.56, 0.42],
  [0.38, 0.31],
  [0.16, 0.255],
  [-0.2, 0.245],
  [-0.5, 0.25],
  [-0.64, 0.29],
];

/**
 * The open variant of the neon bike: two hubless wheels, fat black tyre
 * rings with a dark side face and a glowing inner rim round an open
 * middle; the low glossy body bridging them as a long wedge, dipping
 * into each ring's open middle over its upper half; the empty rider's
 * place, a saddle hollow with a seat pad and its glowing seat line, two
 * short handles at the front and two footrests at the back; on each
 * flank a glowing line under the top and a lower one sweeping down to
 * the belly (`OPEN_SWEEP`), and one over the top's middle.
 * Every light is in one group and breathes, as on the closed variant.
 */
const neonBikeOpen: HeroRecipe = ({ k, s }) => {
  const glow = s.blink(CYCLE_GLOW, 0);
  openWheel(k, s, OPEN_WHEELS.front, glow);
  openWheel(k, s, OPEN_WHEELS.rear, glow);

  k.extrude(OPEN_BODY, -OPEN_HALF, OPEN_HALF, s.tinted(CYCLE_BODY));
  const crest = grown(OPEN_BODY, OPEN_CREST.g);
  k.extrude(crest, -OPEN_CREST.half, OPEN_CREST.half, s.tinted(CYCLE_SHINE));
  k.extrude(
    OPEN_SEAT_PROFILE,
    -OPEN_SEAT_HALF,
    OPEN_SEAT_HALF,
    s.tinted(OPEN_SEAT),
  );

  const metal = s.tinted(OPEN_METAL);
  for (const sg of [-1, 1]) {
    const H = OPEN_HANDLES;
    k.box(
      H.a0,
      H.a1,
      sg * (OPEN_HALF - 0.01),
      sg * H.out,
      H.h - H.t / 2,
      H.h + H.t / 2,
      metal,
    );
    const F = OPEN_FOOTRESTS;
    k.box(
      F.a0,
      F.a1,
      sg * (OPEN_HALF - 0.01),
      sg * F.out,
      F.h - F.t / 2,
      F.h + F.t / 2,
      metal,
    );
  }

  const { width, out } = CYCLE_LINE;
  const flank = openFlankLine();
  for (const d of [-1, 1]) {
    profileLine(k, flank, width, d * OPEN_HALF, d * (OPEN_HALF + out), glow);
    profileLine(
      k,
      OPEN_SWEEP,
      width,
      d * OPEN_HALF,
      d * (OPEN_HALF + out),
      glow,
    );
    profileLine(
      k,
      OPEN_SEAT_TOP,
      width,
      d * (OPEN_SEAT_HALF - 0.004),
      d * (OPEN_SEAT_HALF + out),
      glow,
    );
  }
  // Over the top: one line along the middle of the tank and one along
  // the tail, laid on the top, the seat pad between them.
  const ridge = crest.map(([a, h]): P2 => [a, h + out]);
  const tank = ridge.slice(1, 5);
  const tail = ridge.slice(OPEN_SADDLE.length + 5, OPEN_TOP.length - 1);
  for (const line of [tank, tail])
    profileLine(k, line, width, -width, width, glow);
};

/**
 * The neon bike: variant 0 the closed racing cycle with its canopy
 * (`neonBikeClosed`), variant 1 the open one with hubless wheels and an
 * empty rider's place (`neonBikeOpen`).
 */
const neonBike: HeroRecipe = (ctx) =>
  ctx.variant === 0 ? neonBikeClosed(ctx) : neonBikeOpen(ctx);

/** The box's deep blue paint. */
const BLUE: Rgb = [0.05, 0.15, 0.35];

/** The sign band's black. */
const SIGN_BLACK: Rgb = [0.05, 0.05, 0.05];

/**
 * The white of the sign's words, the window frames, the notice and the
 * lamp's cage.
 */
const WHITE: Rgb = [0.95, 0.95, 0.92];

/** The frosted panes' faint steady glow. */
const PANE: Rgb = [0.62, 0.62, 0.55];

/** The roof lamp's warm white, which breathes. */
const LAMP: Rgb = [1.0, 0.95, 0.8];

/** The door handles: a dark iron. */
const HANDLE: Rgb = [0.08, 0.08, 0.09];

/** The door notice's black ink. */
export const NOTICE_INK: Rgb = [0.05, 0.05, 0.06];

/**
 * The light inside the hollow body, on the back wall's inner face: a
 * white that shines by itself, seen through the open doors (C10).
 */
const INSIDE: Rgb = [0.95, 0.95, 0.9];

/**
 * How far each door leaf turns about its hinge at full open, in radians:
 * 75 degrees, inward, the left and right leaves opposite ways (C10).
 */
export const BOX_SWING = (5 * Math.PI) / 12;

/**
 * The thickness of the hollow body's back wall and of each side wall with
 * its lining, in metres. Each side wall's inner face stands on the
 * leaves' hinge line, so a leaf swings clear of it.
 */
const SHELL = 0.04;

/**
 * The thickness of the white lining on each side wall's inner face, in
 * metres.
 */
const LINING = 0.005;

/**
 * The police box's measures, in metres, `a` across its front and `d` from
 * its back (0) to its front, in the box's own terms (`BOX_BODY`):
 * - `half`: the half width of the plinth, the posts' outer faces and the
 *   cornice; `front`: their front, the footprint's depth;
 * - `plinth`: the plinth's height;
 * - `post`: a corner post's side; the posts run from the plinth up to
 *   `eave`, under the cornice;
 * - `wall`: the body's half width, `post / 2` inside the posts, and
 *   `face`: the plane of the front doors, as far inside the posts' front;
 * - `leaf`: a door leaf's thickness; the body's front stands this far
 *   behind `face`, so the leaves are slabs of their own and share no
 *   plane with the body;
 * - `band0` and `band1`: the sign band's bottom and top, `bandT` how far
 *   it stands proud of its face;
 * - `cornice`, `tier1` and `tier2`: the tops of the roof's three steps,
 *   `inset1` and `inset2` how far the upper two are set in; they stay
 *   thin, so the lamp (`ROOF_LAMP`) stands clear of the cornice's edge
 *   seen from the floor;
 * - `signW`: the width every face's sign is laid out to, a little inside
 *   the narrowest clear span between two posts (the sides, 1.04 m).
 */
const BOX = {
  half: 0.65,
  front: 1.3,
  plinth: 0.1,
  post: 0.1,
  eave: 2.3,
  wall: 0.6,
  face: 1.25,
  leaf: 0.03,
  band0: 2.08,
  band1: 2.26,
  bandT: 0.03,
  cornice: 2.37,
  tier1: 2.43,
  tier2: 2.47,
  inset1: 0.07,
  inset2: 0.15,
  signW: 1.0,
} as const;

/**
 * The frame the police box's body is built in: the recipe's origin moved
 * half the box's depth back, so `BOX`'s `d` from 0 (the back) to
 * `BOX.front` spans the free footprint (`heroFootprint`, centred on the
 * anchor) exactly.
 */
const BOX_BODY: Frame = offset(ORIGIN, 0, -BOX.front / 2);

/**
 * Half the width of the meeting stile between the two door leaves, in
 * metres.
 */
const STILE = 0.02;

/**
 * The roof lamp's measures, in metres: a blue base from the roof's top
 * step up to `glass0`, `rim` in radius; the breathing lamp glass from
 * there to `glass1`, `glass` in radius; four white cage bars `bar` square
 * round it, their centres `bars` from its axis; a white cap from `glass1`
 * to `cap`, as wide as the base, and a small finial on it up to the top.
 */
const ROOF_LAMP = {
  glass0: 2.5,
  glass1: 2.64,
  cap: 2.67,
  rim: 0.075,
  glass: 0.055,
  bars: 0.068,
  bar: 0.01,
  finial: 0.02,
} as const;

/**
 * A panel column's measures, in metres over its face: `inset` from the
 * column's sides to its raised panels and its window; the three raised
 * panels' heights `panels`, standing `raised` proud of the face; the
 * window's frame from `win0` to `win1`, `frameT` proud of the face, with
 * `paneCols` by `paneRows` panes in it, `bar` apart (the white glazing
 * bars that show between them) and as far in from the frame's edge.
 */
const COLUMN = {
  inset: 0.05,
  panels: [
    [0.2, 0.65],
    [0.72, 1.15],
    [1.22, 1.6],
  ],
  raised: 0.015,
  win0: 1.66,
  win1: 2.02,
  frameT: 0.01,
  paneCols: 3,
  paneRows: 2,
  bar: 0.02,
} as const;

/**
 * The shades of the box's blue, as painted wood weathers unevenly: each
 * raised panel of a column a little lighter than the face, each in its
 * own shade, the posts and the roof's steps each their own.
 */
const PANEL_SHADES = [1.1, 1.02, 1.06] as const;

/** Half the width of the white notice on the left door leaf, in metres. */
const NOTICE_HALF = 0.14;

/**
 * One word of the sign as `boxSignLayout` places it: its pixel rows
 * (`textRows`), the left edge `a0`, the top `h1` and the pixel size `px`,
 * ready for `pixelPanel`.
 */
export interface SignWord {
  rows: string[];
  a0: number;
  h1: number;
  px: number;
}

/**
 * The words on the police box's sign band: one of the three approved
 * exceptions to the no-markings rule, with the core wall's nameplate and
 * the block's mark. These four words only, set in the station's block
 * pixels; every identifier and test round them stays generic.
 */
export const BOX_SIGN = {
  left: "POLICE",
  upper: "PUBLIC",
  lower: "CALL",
  right: "BOX",
} as const;

/**
 * The sign laid out across a band `width` wide, centred on `a` 0 and on
 * the height `mid`, as the original sets it (C12): the first and last
 * words large at either end, and the two middle words stacked, the upper
 * over the lower, in smaller pixels between them, left aligned in their
 * slot. The two small words and the gap between them (one small pixel
 * row) are exactly as tall as a large word, since a small pixel is 5/11 of
 * a large one; the large words are 23 and 11 columns wide, and each gap
 * between the three blocks is 3 large pixels. Returned in reading order:
 * the left word, the upper, the lower, the right.
 */
export function boxSignLayout(width: number, mid: number): SignWord[] {
  const big = width / (23 + 11 + 6 + (23 * 5) / 11);
  const small = (big * 5) / 11;
  const top = mid + 2.5 * big;
  const stack = -width / 2 + 26 * big;
  return [
    { rows: textRows(BOX_SIGN.left), a0: -width / 2, h1: top, px: big },
    { rows: textRows(BOX_SIGN.upper), a0: stack, h1: top, px: small },
    {
      rows: textRows(BOX_SIGN.lower),
      a0: stack,
      h1: top - 6 * small,
      px: small,
    },
    {
      rows: textRows(BOX_SIGN.right),
      a0: width / 2 - 11 * big,
      h1: top,
      px: big,
    },
  ];
}

/**
 * One column of the box's panelling on a face at depth `d` of `k`, from
 * `c0` to `c1` along it: three raised panels in their own shades of blue,
 * the white window frame over them and its frosted panes, which glow
 * faintly and leave the frame's white showing between them as glazing
 * bars. With `notice`, the white notice sits on the top raised panel,
 * its lines (`MARKS.boxNotice`) set on it in black. The door leaves and
 * the other three sides share it.
 */
function facePanels(
  k: Kit,
  s: Surfaces,
  d: number,
  c0: number,
  c1: number,
  notice: boolean,
): void {
  const C = COLUMN;
  const p0 = c0 + C.inset;
  const p1 = c1 - C.inset;
  C.panels.forEach(([h0, h1], i) =>
    k.box(
      p0,
      p1,
      d,
      d + C.raised,
      h0,
      h1,
      s.tinted(shade(BLUE, PANEL_SHADES[i] ?? 1)),
    ),
  );
  k.box(p0, p1, d, d + C.frameT, C.win0, C.win1, s.tinted(WHITE));
  const pw = (p1 - p0 - (C.paneCols + 1) * C.bar) / C.paneCols;
  const ph = (C.win1 - C.win0 - (C.paneRows + 1) * C.bar) / C.paneRows;
  const glass = s.signal(PANE);
  for (let i = 0; i < C.paneCols; i++)
    for (let j = 0; j < C.paneRows; j++) {
      const a = p0 + C.bar + i * (pw + C.bar);
      const h = C.win0 + C.bar + j * (ph + C.bar);
      k.panel(a, a + pw, d + C.frameT + DECAL_LIFT, h, h + ph, glass);
    }
  if (!notice) return;
  const n = (p0 + p1) / 2;
  k.box(
    n - NOTICE_HALF,
    n + NOTICE_HALF,
    d + C.raised,
    d + C.raised + DECAL_LIFT,
    1.3,
    1.52,
    s.tinted(WHITE),
  );
  markLines(
    k,
    MARKS.boxNotice,
    insetBox(MARKS.boxNotice, [n - NOTICE_HALF, n + NOTICE_HALF, 1.3, 1.52]),
    d + C.raised + 2 * DECAL_LIFT,
    s.tinted(NOTICE_INK),
  );
}

/**
 * Where a door leaf's hinge stands in the recipe's terms (the hero's own,
 * centred on its anchor): the vertical line at the leaf's outer edge,
 * just inside its corner post, on the leaf's inner face (the body's front,
 * `BOX.face - BOX.leaf` in `BOX_BODY`'s terms, half the box's depth less
 * in the hero's). `a` is at `+a` for the right leaf, `-a` for the left.
 */
export function boxHinge(leaf: "left" | "right"): { a: number; d: number } {
  const edge = BOX.half - BOX.post + 0.01;
  return {
    a: (leaf === "right" ? 1 : -1) * edge,
    d: BOX.face - BOX.leaf - BOX.front / 2,
  };
}

/**
 * One door leaf of the police box, closed, built into the kits `kitAt`
 * makes in the frame `base`: the box's own frame at its anchor and turn
 * (the recipe's origin by default, or the hero's place in the world for a
 * mover, `boxLeafMovers`).
 *
 * The leaf is built in a frame whose origin is its hinge (`boxHinge`):
 * the vertical line at its outer edge on the leaf's inner face, so
 * swinging it is a turn about that frame's origin. It is a slab `BOX.leaf`
 * thick from the body's front out to the door plane, with its column of panels
 * (`facePanels`) on the slab's front and a dark handle at its inner edge.
 * The right leaf (at `+a`, the viewer's right) carries the meeting stile
 * that covers the joint between the two; the left one the door notice.
 * Nothing else of the box is built here, so the call carries the whole
 * leaf and only it.
 */
export function boxDoor(
  kitAt: KitAt,
  s: Surfaces,
  leaf: "left" | "right",
  base: Frame = ORIGIN,
): void {
  const hinge = boxHinge(leaf);
  const edge = Math.abs(hinge.a);
  const sign = leaf === "right" ? 1 : -1;
  const k = kitAt(offset(base, hinge.a, hinge.d));
  // Along the leaf from its hinge (0) to its inner edge (`inner`).
  const inner = sign * -(edge - STILE);
  const [c0, c1] = inner < 0 ? [inner, 0] : [0, inner];
  const h1 = BOX.band0;
  k.box(c0, c1, 0, BOX.leaf, BOX.plinth, h1, s.tinted(shade(BLUE, 0.86)));
  facePanels(k, s, BOX.leaf, c0, c1, leaf === "left");
  const hand = inner + sign * 0.01;
  k.box(
    Math.min(hand, hand + sign * 0.025),
    Math.max(hand, hand + sign * 0.025),
    BOX.leaf,
    BOX.leaf + 0.025,
    1.07,
    1.13,
    s.tinted(HANDLE),
  );
  if (leaf === "right")
    k.box(
      -edge - STILE,
      -edge + STILE,
      0,
      BOX.leaf + 0.008,
      BOX.plinth,
      h1,
      s.tinted(shade(BLUE, 0.85)),
    );
}

/**
 * The blue police box: the plinth, the hollow body lit white inside, the
 * four corner posts, the sign band with its words on all four sides, the
 * two door leaves on the front (`boxDoor`, only with `movers`: otherwise
 * `boxLeafMovers` builds them) and the matching panels on the other three
 * sides, the roof's three steps and the lamp in its cage on top.
 */
const policeBox: HeroRecipe = ({ kitAt, s, variant, kind, movers }) => {
  const { top } = heroHalf(kind, variant);
  const B = BOX;
  const k = kitAt(BOX_BODY);
  const blue = (f: number) => s.tinted(shade(BLUE, f));
  k.box(-B.half, B.half, 0, B.front, 0, B.plinth, blue(0.8));
  // The body, hollow: its outside faces where a solid body's would be (the
  // front behind the door leaves, the top under the cornice), a back wall,
  // two side walls whose inner faces stand on the hinge line, a floor on
  // the plinth and a roof slab down to the top of the doorway.
  const d0 = B.post / 2;
  const front = B.face - B.leaf;
  const inner = B.wall - SHELL;
  const floor = B.plinth + DECAL_LIFT;
  k.box(-B.wall, B.wall, d0, d0 + SHELL, B.plinth, B.eave, blue(0.84));
  for (const a of [-1, 1]) {
    const [w0, w1] =
      a < 0 ? [-B.wall, -inner - LINING] : [inner + LINING, B.wall];
    k.box(w0, w1, d0 + SHELL, front, B.plinth, B.eave, blue(0.84));
  }
  k.box(-inner, inner, d0 + SHELL, front, B.plinth, floor, blue(0.84));
  k.box(-inner, inner, d0 + SHELL, front, B.band0, B.eave, blue(0.84));
  // Inside: the side walls lined in pale white, and the back wall's inner
  // face shining white, so the open doorway reads bright.
  const lining = s.tinted(shade(WHITE, 0.8));
  for (const a of [-1, 1]) {
    const [l0, l1] =
      a < 0 ? [-inner - LINING, -inner] : [inner, inner + LINING];
    k.box(l0, l1, d0 + SHELL, front, floor, B.band0, lining);
  }
  const glowHalf = B.wall - 0.05;
  k.panel(
    -glowHalf,
    glowHalf,
    d0 + SHELL + DECAL_LIFT,
    0.2,
    2.0,
    s.signal(INSIDE),
  );
  const ph = B.half - B.post;
  for (const a of [-1, 1])
    for (const [p0, p1] of [
      [0, B.post],
      [B.front - B.post, B.front],
    ] as const)
      k.box(a * ph, a * B.half, p0, p1, B.plinth, B.eave, blue(1.0));

  // Every face seen from the body's middle: the front, the back and the
  // two sides, each with its half width to the posts and its depth.
  const mid = (d0 + B.face) / 2;
  const centre = offset(BOX_BODY, 0, mid);
  const halfD = (B.face - d0) / 2;
  const faces: { f: Frame; depth: number; clear: number; front: boolean }[] = [
    { f: BOX_BODY, depth: B.face, clear: ph, front: true },
    { f: yawed(centre, 0, 0, Math.PI), depth: halfD, clear: ph, front: false },
    {
      f: yawed(centre, 0, 0, Math.PI / 2),
      depth: B.wall,
      clear: B.front - B.post - mid,
      front: false,
    },
    {
      f: yawed(centre, 0, 0, -Math.PI / 2),
      depth: B.wall,
      clear: B.front - B.post - mid,
      front: false,
    },
  ];
  const band = s.tinted(SIGN_BLACK);
  const white = s.signal(WHITE);
  const words = boxSignLayout(B.signW, (B.band0 + B.band1) / 2);
  for (const { f, depth, clear, front } of faces) {
    const fk = kitAt(f);
    // The front's band closes the gap over the leaves down to the body.
    const b0 = front ? depth - B.leaf : depth;
    fk.box(-clear, clear, b0, depth + B.bandT, B.band0, B.band1, band);
    for (const w of words)
      pixelPanel(
        fk,
        w.rows,
        w.a0,
        w.h1,
        w.px,
        depth + B.bandT + DECAL_LIFT,
        (ch) => (ch === "#" ? white : null),
      );
    if (front) continue;
    facePanels(fk, s, depth, -clear, -STILE, false);
    facePanels(fk, s, depth, STILE, clear, false);
  }
  if (movers) {
    boxDoor(kitAt, s, "left");
    boxDoor(kitAt, s, "right");
  }

  // The roof: the cornice over the posts, then two smaller steps.
  k.box(-B.half, B.half, 0, B.front, B.eave, B.cornice, blue(1.0));
  const i1 = B.inset1;
  k.box(
    -B.half + i1,
    B.half - i1,
    i1,
    B.front - i1,
    B.cornice,
    B.tier1,
    blue(0.88),
  );
  const i2 = B.inset2;
  k.box(
    -B.half + i2,
    B.half - i2,
    i2,
    B.front - i2,
    B.tier1,
    B.tier2,
    blue(0.78),
  );

  // The lamp in its white cage.
  const L = ROOF_LAMP;
  const lampD = B.front / 2;
  const cage = s.tinted(WHITE);
  k.cylinder(0, lampD, B.tier2, L.glass0, L.rim, 10, blue(0.9));
  k.cylinder(0, lampD, L.glass0, L.glass1, L.glass, 10, s.blink(LAMP, 0));
  for (let i = 0; i < 4; i++) {
    const t = (i * Math.PI) / 2 + Math.PI / 4;
    const a = L.bars * Math.cos(t);
    const d = lampD + L.bars * Math.sin(t);
    const w = L.bar / 2;
    k.box(a - w, a + w, d - w, d + w, L.glass0, L.glass1, cage);
  }
  k.cylinder(0, lampD, L.glass1, L.cap, L.rim, 10, cage);
  k.cylinder(0, lampD, L.cap, top, L.finial, 6, cage);
};

/**
 * The police box's two door leaves as movers, for the hero at `index` in
 * `room.heroes`: each a `wing` of its own (`boxDoor` built in the hero's
 * frame at its anchor and turn, in world metres, closed), hinged at its
 * outer post (`boxHinge` turned into the world by `turnedPoint`, at the
 * floor), turned by `swing` about that vertical line at full open. The
 * left leaf turns by `+BOX_SWING` and the right by `-BOX_SWING`, so each
 * inner edge swings into the box whatever the hero's turn (a quarter turn
 * does not change which way a turn about the vertical goes). Both share
 * the key `boxKey(index)`, so one door state opens both; `fixture` is -1,
 * which no fault frame names; `axis` and `travel` are unused (a wing does
 * not slide) and `rest` is 1.
 */
export function boxLeafMovers(hero: Hero, index: number, look: Look): Mover[] {
  const base = frameAt([hero.x * CELL, 0, hero.y * CELL], hero.turn);
  const s = surfaces(look);
  return (["left", "right"] as const).map((leaf) => {
    const b = createBuilder();
    boxDoor((f) => createKit(b, f), s, leaf, base);
    const hinge = boxHinge(leaf);
    const p = turnedPoint(hero.x, hero.y, hero.turn, hinge.a, hinge.d);
    return {
      key: boxKey(index),
      part: "wing",
      fixture: -1,
      mesh: b.build(),
      axis: [0, 0, 0],
      travel: 0,
      pivot: [p.x, 0, p.z],
      rest: 1,
      swing: leaf === "left" ? BOX_SWING : -BOX_SWING,
    };
  });
}

/** The street kinds' recipes. */
export const STREET_RECIPES = {
  "red-bike": redBike,
  "police-box": policeBox,
  "neon-bike": neonBike,
} satisfies Record<
  Extract<HeroKind, "red-bike" | "police-box" | "neon-bike">,
  HeroRecipe
>;
