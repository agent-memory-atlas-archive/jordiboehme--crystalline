/**
 * The street heroes' shape tests: the bike's sourced size, its two
 * lights, its tyres as its ends under their domed covers, its silhouette,
 * its triangle pin and its stickers each on its own side; the police box's sign
 * layout, its sign on all four sides, the lines of its door notice, and
 * its door leaves handed over as two swinging movers, and its hollow
 * inside lit white behind them; the neon bike's size inside its
 * footprint, its proportions (wheels against length and top, wheelbase,
 * canopy span, belly), its two wheels of one size as its ends on the
 * floor, its glowing rims and lines in one group, its dark band and
 * short canopy and no side window, its flank split into the dark arched
 * band and the lighter recessed lower panel with a line along the split,
 * and its triangle pin.
 */

import { describe, expect, it } from "vitest";

import { boxFront } from "../../../world/box";
import { heroFootprint } from "../../../world/footprints";
import type { Hero } from "../../../world/types";
import { FLAG, blinkFlag, createBuilder, type V3 } from "../../geometry";
import { createKit, frameAt } from "../../kit";
import { LOOK } from "../../looks";
import {
  inked,
  partsOf,
  positions,
  recordingKitAt,
  runsOfLines,
  toLocal,
  type Part,
} from "../../modelChecks";
import { swungPoint } from "../../parts";
import { surfaces } from "../common";
import { MARKS } from "../marks";
import { buildHero, buildHeroMesh } from ".";
import { heroHalf } from "./common";
import {
  BIKE,
  BIKE_STICKERS,
  BIKE_WHEELS,
  BOX_SIGN,
  CANOPY_SPAN,
  CYCLE,
  CYCLE_BODY,
  CYCLE_CANOPY,
  CYCLE_GLOW,
  CYCLE_LOWER,
  CYCLE_WHEELS,
  HUB_SILVER,
  NOTICE_INK,
  boxDoor,
  boxLeafMovers,
  boxSignLayout,
} from "./street";
import { textRows } from "./pixels";

const local = (p: Part): V3[] =>
  p.points.map((q) => toLocal(frameAt([0, 0, 0], 0), q));

/** The low end, high end and middle of some points along axis `i`. */
const span = (pts: readonly V3[], i: 0 | 1 | 2) => {
  const v = pts.map((q) => q[i]);
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return { lo, hi, mid: (lo + hi) / 2 };
};

/**
 * The police box's depth range in the recipe's terms: it stands free,
 * centred on its anchor (2.6e), so `d` runs from `BACK` to `FRONT`.
 */
const { d0: BACK, d1: FRONT } = heroHalf("police-box", 0);

/** The height of a panel part: its pixel size, for a mark's run. */
const heightOf = (p: Part): number => {
  const hs = local(p).map((q) => q[2]);
  return Math.max(...hs) - Math.min(...hs);
};

/**
 * The sign of `a` of the door leaf that carries the notice: `boxDoor`
 * builds the left leaf (`facePanels(..., leaf === "left")`) at
 * `sign * edge` with `sign` -1, so its whole column lies at negative `a`.
 */
const LEFT_LEAF_SIGN = -1;

describe("street hero models", () => {
  it("builds the bike at the original's size: 2.95 long, 0.83 wide, the windscreen at 1.17", () => {
    // Mutation caught: a bike shorter than `BIKE.length`.
    const pts = partsOf("red-bike").flatMap(local);
    const as = pts.map((q) => q[0]);
    expect(Math.max(...as) - Math.min(...as)).toBeCloseTo(BIKE.length, 2);
    const body = partsOf("red-bike")
      .filter((p) => p.method === "extrude")
      .flatMap(local);
    const ds = body.map((q) => q[1]);
    expect(Math.max(...ds) - Math.min(...ds)).toBeLessThanOrEqual(
      BIKE.width + 1e-6,
    );
    expect(Math.max(...pts.map((q) => q[2]))).toBeGreaterThanOrEqual(
      BIKE.screenTop - 1e-6,
    );
  });

  it("lights the bike with a steady headlight on the nose and a breathing tail light high on the rear cowl", () => {
    // Mutation caught: the tail light made steady (two steady lights),
    // the two lights swapped end for end, or the tail light dropped below
    // the cowl's slope onto the tyre.
    const parts = partsOf("red-bike");
    const head = parts.filter((p) => p.flag === FLAG.signal);
    const tail = parts.filter((p) => p.flag === blinkFlag(0));
    expect(head).toHaveLength(1);
    expect(tail).toHaveLength(1);
    const hp = local(head[0] as Part);
    expect(Math.min(...hp.map((q) => q[0]))).toBeGreaterThan(1.3);
    // Wide: more than three times as wide as it is tall.
    const hs = hp.map((q) => q[2]);
    const hd = hp.map((q) => q[1]);
    expect(Math.max(...hd) - Math.min(...hd)).toBeGreaterThan(
      3 * (Math.max(...hs) - Math.min(...hs)),
    );
    const rear = BIKE_WHEELS.rear;
    for (const q of local(tail[0] as Part)) {
      expect(q[0]).toBeLessThan(-1.0);
      expect(q[0]).toBeGreaterThan(rear.a - rear.r);
      expect(q[2]).toBeGreaterThan(2 * rear.r);
    }
  });

  it("makes the two tyres the bike's ends, the rear one larger, under red domed covers", () => {
    // Mutation caught: the bodywork reaching past a tyre (the old
    // capsule), the wheels swapped, a cover missing on one side, or the
    // silver caps on the wrong wheel. The guard: the tread is found, so
    // the test cannot pass on a bike with none.
    const parts = partsOf("red-bike");
    const all = parts.flatMap(local).map((q) => q[0]);
    const tread = inked(parts, [0.025, 0.025, 0.03], "extrude");
    expect(tread).toHaveLength(2);
    const ends = tread.map((p) => local(p).map((q) => q[0]));
    expect(Math.max(...ends.flat())).toBeCloseTo(Math.max(...all), 9);
    expect(Math.min(...ends.flat())).toBeCloseTo(Math.min(...all), 9);
    const { front, rear } = BIKE_WHEELS;
    expect(rear.r).toBeGreaterThan(front.r);
    expect(front.a - rear.a).toBeCloseTo(2.2, 2);
    // Each wheel's covers: red discs round its axle on both sides, outboard
    // of its tyre and smaller than it.
    for (const w of [front, rear]) {
      const covers = parts.filter((p) => {
        const pts = local(p);
        const as = pts.map((q) => q[0]);
        const ds = pts.map((q) => Math.abs(q[1]));
        return (
          p.method === "extrude" &&
          Math.abs((Math.max(...as) + Math.min(...as)) / 2 - w.a) < 1e-6 &&
          Math.min(...ds) >= w.half - 1e-6 &&
          Math.max(...as) - Math.min(...as) < 2 * w.r &&
          (p.tint?.[0] ?? 0) > 0.85 &&
          (p.tint?.[1] ?? 1) < 0.3
        );
      });
      const sides = new Set(
        covers.map((p) => Math.sign(local(p)[0]?.[1] ?? 0)),
      );
      expect([...sides].sort()).toEqual([-1, 1]);
      expect(covers.length).toBeGreaterThanOrEqual(4);
    }
    // The silver caps: one on the rear cover's `+d` side, one on the
    // swing arm's end on `-d`, both over the rear axle, and one on each
    // engine cover.
    const caps = inked(parts, HUB_SILVER, "extrude");
    expect(caps).toHaveLength(4);
    const onAxle = caps.filter((p) => {
      const as = local(p).map((q) => q[0]);
      return Math.abs((Math.max(...as) + Math.min(...as)) / 2 - rear.a) < 1e-6;
    });
    expect(onAxle.map((p) => Math.sign(local(p)[0]?.[1] ?? 0)).sort()).toEqual([
      -1, 1,
    ]);
  });

  it("builds the silhouette: a high fairing and windscreen in front, a low bucket seat, a tall rear cowl", () => {
    // Mutation caught: the seat raised back to a saddle, the backrest or
    // the rear cowl dropped, or the fairing's front sunk into the tyre.
    const parts = partsOf("red-bike");
    const seat = inked(parts, [0.3, 0.14, 0.1]).flatMap(local);
    expect(seat.length).toBeGreaterThan(0);
    // The cushion is low, the backrest stands tall behind it.
    const cushion = inked(parts, [0.3, 0.14, 0.1], "bevelBox").flatMap(local);
    expect(cushion.length).toBeGreaterThan(0);
    expect(Math.max(...cushion.map((q) => q[2]))).toBeLessThanOrEqual(0.45);
    expect(Math.max(...seat.map((q) => q[2]))).toBeGreaterThan(0.8);
    // The highest red behind the seat stands over 1 m; the screen is the top.
    const red = parts
      .filter((p) => p.tint !== null && p.tint[0] > 0.85 && p.tint[1] < 0.3)
      .flatMap(local);
    const cowl = red.filter((q) => q[0] < -0.5).map((q) => q[2]);
    expect(Math.max(...cowl)).toBeGreaterThan(1.0);
    expect(Math.max(...cowl)).toBeLessThan(BIKE.screenTop);
    // Over the front tyre the fairing leaves its arch clear.
    const { front } = BIKE_WHEELS;
    const overTyre = red.filter(
      (q) =>
        Math.abs(q[1]) < front.half &&
        Math.hypot(q[0] - front.a, q[2] - front.r) < front.r + 0.02,
    );
    expect(overTyre).toEqual([]);
  });

  it("stays under its triangle pin", () => {
    // Mutation caught: a slice or a tyre built with far more facets.
    expect(buildHeroMesh("red-bike", 0, LOOK).count / 3).toBeLessThan(3200);
  });

  it("lays the sign out as on the original: POLICE, PUBLIC over CALL, BOX, inside the band", () => {
    // Mutation caught: the words reordered, the stack side by side, or
    // the sign wider than its band.
    const words = boxSignLayout(1.1, 2.17);
    expect(words.map((w) => w.rows)).toEqual(
      [BOX_SIGN.left, BOX_SIGN.upper, BOX_SIGN.lower, BOX_SIGN.right].map(
        textRows,
      ),
    );
    const [left, upper, lower, right] = words;
    if (!left || !upper || !lower || !right) throw new Error("four words");
    expect(upper.a0).toBeCloseTo(lower.a0, 9);
    expect(upper.h1).toBeGreaterThan(lower.h1);
    expect(upper.px).toBeLessThan(left.px);
    const span = (w: (typeof words)[number]) => [
      w.a0,
      w.a0 + (w.rows[0]?.length ?? 0) * w.px,
    ];
    expect(span(left)[1]).toBeLessThan(upper.a0);
    expect(span(upper)[1]).toBeLessThan(right.a0);
    expect(left.a0).toBeGreaterThanOrEqual(-0.55 - 1e-9);
    expect(span(right)[1]).toBeLessThanOrEqual(0.55 + 1e-9);
  });

  it("puts the sign on all four sides of the box, the back one inside the envelope", () => {
    // Mutation caught: the back sign dropped, or drawn behind the box's
    // footprint.
    const letters = partsOf("police-box").filter(
      (p) => p.flag === FLAG.signal && p.method === "panel",
    );
    const faces = new Set<string>();
    for (const p of letters) {
      const pts = local(p);
      const hs = pts.map((q) => q[2]);
      if (Math.min(...hs) < 2.0) continue; // the windows glow too, lower down
      const as = pts.map((q) => q[0]);
      const ds = pts.map((q) => q[1]);
      if (Math.max(...ds) - Math.min(...ds) < 1e-6)
        faces.add((ds[0] ?? 0) > 0 ? "front" : "back");
      else if (Math.max(...as) - Math.min(...as) < 1e-6)
        faces.add((as[0] ?? 0) > 0 ? "a+" : "a-");
      for (const q of pts) expect(q[1]).toBeGreaterThanOrEqual(BACK - 1e-9);
    }
    expect([...faces].sort()).toEqual(["a+", "a-", "back", "front"]);
    expect(BACK).toBeCloseTo(-0.65, 9);
  });

  it("keeps the box's use point clear: nothing reaches past its front", () => {
    // Mutation caught: a handle, a panel or the sign standing out past the
    // corner posts' front into the use point. The guard: the posts do
    // reach the front, so the test cannot pass on a box built short.
    const ds = partsOf("police-box")
      .flatMap(local)
      .map((q) => q[1]);
    expect(Math.max(...ds)).toBeGreaterThanOrEqual(FRONT - 1e-6);
    for (const d of ds) expect(d).toBeLessThanOrEqual(FRONT + 1e-6);
  });
  it("puts each sticker on its own side of the bike, from the approved list (2.6f C13)", () => {
    // Mutation caught: a sticker mirrored onto both sides or set on the
    // wrong one, a sticker set from an unapproved string, or a sticker off
    // the skirts and the front wheel cover. The guard: both sides carry
    // stickers, so the test cannot pass on none.
    const approved = [...MARKS.bikeStickers, MARKS.bikeBigOne];
    expect(BIKE_STICKERS.map((s) => s.mark).sort()).toEqual(
      [...approved].sort(),
    );
    expect(new Set(BIKE_STICKERS.map((s) => s.side))).toEqual(new Set([-1, 1]));
    const parts = partsOf("red-bike");
    const { front } = BIKE_WHEELS;
    for (const s of BIKE_STICKERS) {
      const name = typeof s.mark === "string" ? s.mark : s.mark.join(" ");
      expect(runsOfLines(s.mark)).toBeGreaterThan(3);
      const ink = inked(parts, s.ink, "panel");
      expect(ink, name).toHaveLength(runsOfLines(s.mark));
      for (const p of ink) {
        const [a0, a1] = s.a;
        const [h0, h1] = s.h;
        for (const q of local(p)) {
          expect(Math.sign(q[1]), name).toBe(s.side);
          expect(q[0]).toBeGreaterThanOrEqual(a0 - 1e-6);
          expect(q[0]).toBeLessThanOrEqual(a1 + 1e-6);
          expect(q[2]).toBeGreaterThanOrEqual(h0 - 1e-6);
          expect(q[2]).toBeLessThanOrEqual(h1 + 1e-6);
          expect(Math.abs(q[1])).toBeGreaterThan(s.face);
          // A wheel sticker stays inside the cover's inner dome.
          if (s.face < 0.2)
            expect(Math.hypot(q[0] - front.a, q[2] - front.r)).toBeLessThan(
              0.58 * front.r * Math.cos(Math.PI / 16),
            );
        }
        expect(heightOf(p)).toBeGreaterThanOrEqual(0.003 - 1e-9);
      }
    }
    // The left flank's three and the right flank's two, as on the original.
    const sideOf = (m: string) => BIKE_STICKERS.find((s) => s.mark === m)?.side;
    const [leftFirst, leftSecond, right, leftThird] = MARKS.bikeStickers;
    expect([leftFirst, leftSecond, leftThird].map((m) => sideOf(m))).toEqual([
      -1, -1, -1,
    ]);
    expect(sideOf(right)).toBe(1);
  });

  it("sets the notice's lines in black on the left door leaf's white notice (2.6f C13)", () => {
    // Mutation caught: the notice left blank, set on the right leaf, or a
    // line dropped.
    expect(runsOfLines(MARKS.boxNotice)).toBeGreaterThan(20);
    const parts = partsOf("police-box");
    const ink = inked(parts, NOTICE_INK, "panel");
    expect(ink).toHaveLength(runsOfLines(MARKS.boxNotice));
    const pts = ink.flatMap(local);
    expect(Math.min(...pts.map((q) => q[2]))).toBeGreaterThanOrEqual(
      1.3 - 1e-6,
    );
    expect(Math.max(...pts.map((q) => q[2]))).toBeLessThanOrEqual(1.52 + 1e-6);
    // The left leaf, seen from the front: its `a` is below 0 in the
    // recipe's frame (turn 0 faces north, `along` runs west).
    const mid =
      (Math.min(...pts.map((q) => q[0])) + Math.max(...pts.map((q) => q[0]))) /
      2;
    expect(Math.sign(mid)).toBe(LEFT_LEAF_SIGN);
    for (const p of ink)
      expect(heightOf(p)).toBeGreaterThanOrEqual(0.003 - 1e-9);
    // Mutation caught: the notice built into the body instead of the left
    // leaf, which the position check above cannot tell apart from the leaf
    // sitting at the same spot. Built apart: the body without its leaves
    // (`movers: false`) carries no notice ink, and the left leaf alone
    // (`boxDoor`) carries all of it.
    const bodyParts: Part[] = [];
    buildHero(
      recordingKitAt(createBuilder(), bodyParts),
      "police-box",
      0,
      LOOK,
      false,
    );
    expect(inked(bodyParts, NOTICE_INK, "panel")).toHaveLength(0);
    const leafParts: Part[] = [];
    boxDoor(recordingKitAt(createBuilder(), leafParts), surfaces(LOOK), "left");
    expect(inked(leafParts, NOTICE_INK, "panel")).toHaveLength(
      runsOfLines(MARKS.boxNotice),
    );
  });
});

describe("the police box's doors (2.6e C10, C16)", () => {
  const hero: Hero = {
    kind: "police-box",
    variant: 0,
    x: 4.5,
    y: 6,
    turn: 0,
    seed: 1,
  };

  it("leaves the leaves out of the instanced mesh and hands them over as two wings", () => {
    // Mutation caught: buildHeroMesh still building the leaves (they would
    // be drawn twice, one copy never opening), or a leaf mover missing.
    const whole = createBuilder();
    buildHero((f) => createKit(whole, f), "police-box", 0, LOOK, true);
    const body = buildHeroMesh("police-box", 0, LOOK);
    const wings = boxLeafMovers(hero, 7, LOOK);
    expect(wings.map((m) => m.part)).toEqual(["wing", "wing"]);
    expect(new Set(wings.map((m) => m.key))).toEqual(new Set(["box:7"]));
    expect(wings.every((m) => m.fixture === -1)).toBe(true);
    expect(body.count + wings.reduce((n, m) => n + m.mesh.count, 0)).toBe(
      whole.build().count,
    );
  });

  it("swings each leaf's inner edge deep into the box, never out of its front", () => {
    // Mutation caught: a swing sign that opens a leaf outward, both leaves
    // turning the same way, or a swing of 0 (the doors never open).
    const wings = boxLeafMovers(hero, 0, LOOK);
    expect(wings.length).toBe(2);
    expect((wings[0]?.swing ?? 0) * (wings[1]?.swing ?? 0)).toBeLessThan(0);
    const box = heroFootprint(hero);
    for (const m of wings) {
      const pivot = m.pivot ?? [0, 0, 0];
      const points = positions(m.mesh);
      expect(points.length).toBeGreaterThan(0);
      for (const p of points) {
        const q = swungPoint(p, pivot, m.swing);
        // turn 0: the front faces north (-z), so the front plane is box.z0
        // and "deeper into the box" is a larger z.
        expect(q[2]).toBeGreaterThanOrEqual(box.z0 - 1e-6);
        expect(q[0]).toBeGreaterThanOrEqual(box.x0 - 1e-6);
        expect(q[0]).toBeLessThanOrEqual(box.x1 + 1e-6);
      }
      // The leaf's inner edge: its vertex farthest from the hinge along x.
      const inner = points.reduce((a, b) =>
        Math.abs(b[0] - pivot[0]) > Math.abs(a[0] - pivot[0]) ? b : a,
      );
      const swung = swungPoint(inner, pivot, m.swing);
      expect(swung[2] - inner[2]).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("keeps both leaves inside the free-standing box's footprint at every turn, swinging deeper in (2.6e)", () => {
    // Mutation caught: a leaf's frame or pivot that ignores the box's turn
    // or its centring on the anchor (a leaf drawn or hinged half a box
    // away, or outside the box at turns 1 to 3), or a swing that opens a
    // leaf outward at some turn.
    for (const turn of [0, 1, 2, 3]) {
      const h: Hero = { ...hero, turn };
      const box = heroFootprint(h);
      const front = boxFront(h);
      const depth = (q: V3) =>
        (q[0] - front.x) * front.inward[0] + (q[2] - front.z) * front.inward[1];
      const wings = boxLeafMovers(h, 0, LOOK);
      expect(wings.length).toBe(2);
      for (const m of wings) {
        const pivot = m.pivot ?? [0, 0, 0];
        const points = positions(m.mesh);
        expect(points.length).toBeGreaterThan(0);
        for (const p of points)
          for (const q of [p, swungPoint(p, pivot, m.swing)]) {
            expect(q[0], `turn ${String(turn)}`).toBeGreaterThanOrEqual(
              box.x0 - 1e-6,
            );
            expect(q[0], `turn ${String(turn)}`).toBeLessThanOrEqual(
              box.x1 + 1e-6,
            );
            expect(q[2], `turn ${String(turn)}`).toBeGreaterThanOrEqual(
              box.z0 - 1e-6,
            );
            expect(q[2], `turn ${String(turn)}`).toBeLessThanOrEqual(
              box.z1 + 1e-6,
            );
          }
        // The hinge stands on the box's front, just behind the door plane.
        const hinge: V3 = [pivot[0], 0, pivot[2]];
        expect(depth(hinge)).toBeLessThan(0);
        expect(depth(hinge)).toBeGreaterThan(-0.1);
        const inner = points.reduce((a, b) =>
          Math.hypot(b[0] - pivot[0], b[2] - pivot[2]) >
          Math.hypot(a[0] - pivot[0], a[2] - pivot[2])
            ? b
            : a,
        );
        const swung = swungPoint(inner, pivot, m.swing);
        expect(
          depth(inner) - depth(swung),
          `turn ${String(turn)}`,
        ).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it("lights the hollow inside white behind the doors", () => {
    // Mutation caught: the body left solid (the open doorway would show a
    // blue wall), or the inside lit with a lit surface that reads dark.
    // Only a light inside the body counts: behind the door leaves, in
    // front of the back wall and between the side walls, under the sign
    // band, so the sign's white words on the four faces never pass it.
    const inside = partsOf("police-box").filter(
      (p) =>
        p.flag === FLAG.signal &&
        p.tint !== null &&
        p.tint[2] > 0.85 &&
        p.tint[0] > 0.9 &&
        local(p).every(
          (q) =>
            Math.abs(q[0]) < 0.6 &&
            q[1] > BACK &&
            q[1] < FRONT - 0.1 &&
            q[2] < 2.08,
        ),
    );
    expect(inside.length).toBeGreaterThan(0);
  });
});

describe("the neon bike (0.25.1)", () => {
  const parts = partsOf("neon-bike");
  const all = parts.flatMap(local);
  const along = all.map((q) => q[0]);
  const { front, rear } = CYCLE_WHEELS;
  const D = 2 * front.r;

  it("is its length from tyre to tyre, inside its footprint, on the floor and up to its top", () => {
    // Mutation caught: the cycle scaled past its footprint, a nose or
    // tail run out past the tyres, or the top off the catalogue's.
    const { hw, d1, top } = heroHalf("neon-bike", 0);
    expect(front.a + front.r - (rear.a - rear.r)).toBeCloseTo(CYCLE.length, 6);
    expect(Math.max(...along)).toBeGreaterThan(front.a + front.r);
    expect(Math.max(...along)).toBeLessThan(front.a + front.r + 0.03);
    expect(Math.min(...along)).toBeGreaterThanOrEqual(rear.a - rear.r - 0.03);
    expect(Math.max(...along.map(Math.abs))).toBeLessThanOrEqual(hw);
    expect(Math.max(...all.map((q) => Math.abs(q[1])))).toBeLessThanOrEqual(d1);
    expect(Math.min(...all.map((q) => q[2]))).toBeCloseTo(0, 6);
    expect(Math.max(...all.map((q) => q[2]))).toBeCloseTo(CYCLE.top, 2);
    expect(top).toBe(CYCLE.top);
    expect(CYCLE.top).toBeLessThan(3.0 - 0.05);
  });

  it("keeps its sourced proportions: wheels a quarter of its length, its top 1.8 wheels high, a short canopy behind the crown", () => {
    // Mutation caught: the wheels grown or shrunk against the body, the
    // wheels moved in under it, the top raised or lowered, or the canopy
    // grown long again or moved forward over the nose.
    expect(D / CYCLE.length).toBeGreaterThan(0.23);
    expect(D / CYCLE.length).toBeLessThan(0.27);
    expect(CYCLE.top / D).toBeGreaterThan(1.7);
    expect(CYCLE.top / D).toBeLessThan(1.9);
    expect((front.a - rear.a) / CYCLE.length).toBeGreaterThan(0.73);
    expect((front.a - rear.a) / CYCLE.length).toBeLessThan(0.77);
    const fromRear = (a: number) => (a - (rear.a - rear.r)) / CYCLE.length;
    // The canopy runs from 0.38 to 0.53 of the length from the rear: from
    // behind the crown (0.55) forward to it, behind the original's longer
    // strip (0.55 to 0.9), so it covers a sixth of the length and stays
    // clear of the nose.
    expect(fromRear(CANOPY_SPAN.from)).toBeCloseTo(0.379, 3);
    expect(fromRear(CANOPY_SPAN.to)).toBeCloseTo(0.534, 3);
    expect(fromRear(CANOPY_SPAN.to)).toBeLessThanOrEqual(0.55);
    expect((CANOPY_SPAN.to - CANOPY_SPAN.from) / CYCLE.length).toBeLessThan(
      0.2,
    );
    // The shell's lowest point, its belly between the wheels, sits about
    // a quarter wheel up.
    const belly = Math.min(
      ...[...inked(parts, CYCLE_BODY), ...inked(parts, CYCLE_LOWER)]
        .flatMap(local)
        .map((q) => q[2]),
    );
    expect(belly / D).toBeGreaterThan(0.18);
    expect(belly / D).toBeLessThan(0.3);
  });

  it("stands on its two wheels of one size, its treads on the floor and glowing", () => {
    // Mutation caught: a wheel off the floor, the two of different sizes,
    // or a tread left unlit.
    expect(front.r).toBe(rear.r);
    expect(front.a).toBeCloseTo(-rear.a, 6);
    const glow = inked(parts, CYCLE_GLOW, "extrude");
    const treads = glow.filter(
      (p) => span(local(p), 2).hi - span(local(p), 2).lo > 0.9 * D,
    );
    expect(treads).toHaveLength(2);
    for (const t of treads) {
      const pts = local(t);
      expect(span(pts, 2).lo).toBeCloseTo(0, 6);
      expect(span(pts, 2).hi).toBeCloseTo(D, 6);
    }
    expect(treads.map((t) => Math.sign(span(local(t), 0).mid)).sort()).toEqual([
      -1, 1,
    ]);
  });

  it("lights its rims and lines in one breathing group, on both sides, and nothing else", () => {
    // Mutation caught: a line in another group, a steady light, or the
    // lines on one side only.
    const lit = parts.filter((p) => p.flag !== FLAG.lit);
    expect(lit.length).toBeGreaterThan(40);
    for (const p of lit) {
      expect(p.flag).toBe(blinkFlag(0));
      expect(p.tint).toEqual([...CYCLE_GLOW]);
    }
    const lines = lit.filter(
      (p) => span(local(p), 2).hi - span(local(p), 2).lo < 0.9 * D,
    );
    const sides = new Set(lines.map((p) => Math.sign(span(local(p), 1).mid)));
    expect([...sides].sort()).toEqual([-1, 1]);
    const left = lines.filter((p) => span(local(p), 1).mid < 0).length;
    expect(lines.length).toBe(2 * left);
  });

  it("keeps the band and canopy dark, the canopy on top of it and no window on either flank", () => {
    // Mutation caught: a lit or bright band, the canopy sunk under the
    // back, or a side window (or any other unlit part) standing on a
    // flank past the band's face.
    for (const c of [CYCLE_BODY, CYCLE_CANOPY])
      expect(Math.max(...c)).toBeLessThan(0.2);
    const band = inked(parts, CYCLE_BODY);
    const smoked = inked(parts, CYCLE_CANOPY);
    expect(band).toHaveLength(1);
    expect(smoked).toHaveLength(1);
    const [b] = band;
    const [c] = smoked;
    if (b === undefined || c === undefined)
      throw new Error("no band or canopy");
    expect(span(local(c), 1).lo).toBeLessThan(0);
    expect(span(local(c), 1).hi).toBeGreaterThan(0);
    expect(span(local(c), 2).hi).toBeGreaterThan(span(local(b), 2).hi);
    expect(span(local(c), 1).hi).toBeLessThan(span(local(b), 1).hi);
    expect(span(local(c), 0).lo).toBeCloseTo(CANOPY_SPAN.from, 6);
    expect(span(local(c), 0).hi).toBeCloseTo(CANOPY_SPAN.to, 6);
    // Over the rider's place, behind the crown, the canopy stands well
    // clear of the shell and its crests, so it reads as a dark piece.
    const rearEnd = (q: V3) =>
      q[0] > CANOPY_SPAN.from - 0.05 && q[0] < CANOPY_SPAN.from + 0.1;
    const shell = parts
      .filter((p) => p !== c && p.flag === FLAG.lit)
      .flatMap(local)
      .filter(rearEnd);
    const over = local(c).filter(rearEnd);
    expect(
      Math.max(...over.map((q) => q[2])) - Math.max(...shell.map((q) => q[2])),
    ).toBeGreaterThan(0.05);
    // Only the glowing lines stand past the band's face.
    const face = span(local(b), 1).hi;
    for (const p of parts.filter((q) => q.flag === FLAG.lit)) {
      const y = span(local(p), 1);
      expect(Math.max(-y.lo, y.hi)).toBeLessThanOrEqual(face + 1e-9);
    }
  });

  it("splits its flank into the dark arched band over the top and the lighter lower panel set in under it, a glowing line along the split", () => {
    // Mutation caught: the panel flush with the band or standing proud,
    // the panel in the band's dark (one tone), the band not hooding both
    // wheels, the split up into the top half, or no line along the split.
    const [band] = inked(parts, CYCLE_BODY);
    const panels = inked(parts, CYCLE_LOWER);
    expect(panels).toHaveLength(1);
    const [panel] = panels;
    if (band === undefined || panel === undefined)
      throw new Error("no band or panel");
    // Two tones: the panel a lighter grey than the dark band.
    expect(Math.min(...CYCLE_LOWER)).toBeGreaterThan(
      Math.max(...CYCLE_BODY) + 0.1,
    );
    expect(Math.max(...CYCLE_LOWER) - Math.min(...CYCLE_LOWER)).toBeLessThan(
      0.06,
    );
    const [bp, pp] = [local(band), local(panel)];
    // The panel is set in from the band on both sides.
    expect(span(pp, 1).hi).toBeLessThan(span(bp, 1).hi - 0.02);
    expect(span(pp, 1).lo).toBeGreaterThan(span(bp, 1).lo + 0.02);
    // The band runs over both wheels' tops, from end to end.
    expect(span(bp, 0).lo).toBeLessThan(rear.a);
    expect(span(bp, 0).hi).toBeGreaterThan(front.a);
    for (const w of [front, rear]) {
      const over = bp.filter((q) => Math.abs(q[0] - w.a) < 0.05);
      expect(Math.min(...over.map((q) => q[2]))).toBeGreaterThan(2 * w.r);
    }
    // The panel is the lower part: from the belly up to the split, which
    // stays under 0.7 of the top and runs between the wheels.
    const foot = 0.7 * CYCLE.top;
    expect(span(pp, 2).lo).toBeLessThan(D / 2);
    expect(span(pp, 2).hi).toBeLessThan(foot - 0.05);
    expect(span(pp, 2).hi).toBeGreaterThan(D);
    expect(span(pp, 0).lo).toBeGreaterThan(rear.a);
    expect(span(pp, 0).hi).toBeLessThan(front.a);
    // A glowing line runs along the split on each side, over the panel's
    // top between the wheels, on the band's face.
    const lit = parts.filter((p) => p.flag !== FLAG.lit);
    for (const sg of [-1, 1]) {
      const split = lit.filter((p) => {
        const q = local(p);
        const z = span(q, 2);
        return (
          Math.abs(span(q, 0).mid) < 0.5 &&
          Math.sign(span(q, 1).mid) === sg &&
          z.lo > span(pp, 2).hi - 0.01 &&
          z.hi < foot
        );
      });
      expect(split.length).toBeGreaterThan(0);
      for (const p of split)
        expect(Math.abs(span(local(p), 1).mid)).toBeGreaterThan(
          span(bp, 1).hi - 0.001,
        );
    }
  });

  it("stays under its triangle pin", () => {
    expect(buildHeroMesh("neon-bike", 0, LOOK).count / 3).toBeLessThan(2500);
  });
});
