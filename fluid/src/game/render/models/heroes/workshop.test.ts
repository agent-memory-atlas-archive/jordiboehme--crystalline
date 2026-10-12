/**
 * The workshop heroes' shape tests: what `heroModels.test.ts` does not
 * check for every kind. The core wall's lamps cover all eight twinkle
 * groups and never overlap; the big gun, taken from the built rack and
 * bench, is the same parts only moved, nothing else meets its grip, and
 * it ends in a round dark aperture with the green glow in its middle, in
 * a silver-grey shell;
 * the tube bench's three tubes meet at one round hub, two arms up and the
 * stem down, and its box carries its two warning labels on red tape, one
 * on the bottom rail and one over the status lights; and the field pack's
 * chase climbs its cell one light per group and runs round its cyclotron
 * in ring order, its cyclotron is a stepped round housing with the bumper
 * across its lower half, its wand hangs tip down on its right side, its
 * cables and straps keep their colours, and both variants stay in their
 * footprints, on their stands and under their triangle pin. Whether a workshop
 * hero's parts float, and whether the gun bench's and the tube bench's
 * catalogue tops lie on a real, clear upward face, are
 * `heroModels.test.ts`'s checks now, for every kind, not only these.
 */

import { describe, expect, it } from "vitest";

import { HERO_CATALOGUE } from "../../../world/heroes";
import { FLAG, type V3 } from "../../geometry";
import { DECAL_LIFT, frameAt } from "../../kit";
import {
  inked,
  partsOf,
  reaches,
  runsOfLines,
  shape,
  sub,
  toLocal,
  type Part,
} from "../../modelChecks";
import { MARKS } from "../marks";
import { buildHeroMesh } from ".";
import { LOOK } from "../../looks";
import { heroHalf } from "./common";
import {
  BUMPER,
  COPPER,
  CYCLOTRON,
  LABEL_INK,
  LABEL_TAPE,
  PACK_D,
  PACK_W,
  RIBBON,
  STRAP_OLIVE,
  TIP_ORANGE,
  WAND_GREY,
  WARNING_PLATE,
  WIRE,
} from "./workshop";

/** A part's points in the recipe's local `[a, d, h]`. */
const local = (p: Part): V3[] =>
  p.points.map((q) => toLocal(frameAt([0, 0, 0], 0), q));

/** The height of a panel part: its pixel size, for a mark's run. */
const heightOf = (p: Part): number => {
  const hs = local(p).map((q) => q[2]);
  return Math.max(...hs) - Math.min(...hs);
};

/**
 * The tube bench's box front, as `tubeBox` builds it: its `a` range and
 * its face's depth; the bottom rail's heights (on the bench top at 0.9);
 * and the top of the status lights' row and the box's top, the strip
 * between them the second label's.
 */
const BOX_FRONT = { a0: 0.1, a1: 0.7, d: 0.7 };
const BOTTOM_RAIL = { h0: 0.9, h1: 0.94 };
const OVER_LIGHTS = { h0: 1.372, h1: 1.4 };

/** Whether a part is a light in one of the eight blink groups. */
const blinks = (p: Part) => p.flag >= FLAG.blink && p.flag < FLAG.blink + 8;

/** How far two points lie apart. */
const gap = (p: V3, q: V3) => Math.hypot(...sub(p, q));

/** The offset that moves part `p` onto part `q` (their first points). */
const offsetOf = (p: Part, q: Part): V3 =>
  sub(q.points[0] ?? [0, 0, 0], p.points[0] ?? [0, 0, 0]);

/**
 * Whether part `q` is part `p` moved by one vector: the same primitive,
 * the same flag and every point shifted by the same offset (to 1e-6).
 */
function sameMoved(p: Part, q: Part): boolean {
  if (p.method !== q.method || p.flag !== q.flag) return false;
  if (p.points.length === 0 || p.points.length !== q.points.length)
    return false;
  const shift = offsetOf(p, q);
  return p.points.every((a, i) => {
    const b = q.points[i];
    return b !== undefined && gap(sub(b, a), shift) < 1e-6;
  });
}

/**
 * The big gun inside the built gun rack and gun bench: the longest run of
 * parts, in build order, that the bench repeats from the rack, each moved
 * by one and the same offset. Returns both part lists, where the run
 * starts in each and its length.
 */
function gunRun() {
  const rack = partsOf("gun-rack");
  const bench = partsOf("gun-bench");
  let best = { i: 0, j: 0, n: 0 };
  for (let i = 0; i < rack.length; i++)
    for (let j = 0; j < bench.length; j++) {
      const [r0, b0] = [rack[i], bench[j]];
      if (!r0 || !b0 || !sameMoved(r0, b0)) continue;
      const shift = offsetOf(r0, b0);
      let n = 0;
      for (;;) {
        const [r, b] = [rack[i + n], bench[j + n]];
        if (!r || !b || !sameMoved(r, b)) break;
        if (gap(offsetOf(r, b), shift) > 1e-6) break;
        n++;
      }
      if (n > best.n) best = { i, j, n };
    }
  return { rack, bench, ...best };
}

describe("workshop hero models", () => {
  it("the core wall's lamps cover all eight groups, many small ones to a cabinet", () => {
    const lamps = partsOf("core-wall").filter(blinks);
    const groups = new Set(lamps.map((p) => p.flag - FLAG.blink));
    expect(groups).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
    // Six cabinets, each a grid of six columns by thirteen rows.
    expect(lamps).toHaveLength(6 * 6 * 13);
    for (const lamp of lamps) {
      const b = shape(lamp.points);
      expect(b.hi[0] - b.lo[0]).toBeLessThan(0.06);
      expect(b.hi[1] - b.lo[1]).toBeLessThan(0.06);
    }
  });

  it("no lamp overlaps another", () => {
    // Every lamp is a flat quad on its cabinet's plate, so the overlap that
    // matters is in the wall's own face, (a, h).
    const f = frameAt([0, 0, 0], 0);
    const boxes = partsOf("core-wall")
      .filter(blinks)
      .map((p) => {
        const pts = p.points.map((q) => toLocal(f, q));
        return ([0, 2] as const).map((k) => ({
          lo: Math.min(...pts.map((q) => q[k])),
          hi: Math.max(...pts.map((q) => q[k])),
        }));
      });
    const overlaps = (
      p: { lo: number; hi: number }[],
      q: { lo: number; hi: number }[],
    ) =>
      p.every((b, k) => {
        const c = q[k];
        return c !== undefined && b.lo < c.hi - 1e-6 && c.lo < b.hi - 1e-6;
      });
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [bi, bj] = [boxes[i], boxes[j]];
        if (!bi || !bj) continue;
        expect(overlaps(bi, bj), `${String(i)} vs ${String(j)}`).toBe(false);
      }
  });

  it("the big gun is the same on the rack and the bench", () => {
    const { rack, bench, i, j, n } = gunRun();
    // The grip; the rear frame's rail, butt plate, upright, top rail,
    // brace, two copper bands and three cable links; the body, two power
    // cylinders with two caps each and the trough; three seam lines, four
    // bolts, the light's bezel and the light, the copper strip and the
    // badge plate; the badge's 19 letter runs; the vent core, five slats
    // and four glowing slots; and the housing, three ribs, the lip, the
    // aperture and the muzzle glow.
    expect(n).toBe(47 + 19);
    // Every light of either model is the gun's core, all inside the run.
    const lights = rack.filter(blinks);
    expect(lights.length).toBeGreaterThan(0);
    expect(rack.slice(i, i + n).filter(blinks)).toEqual(lights);
    expect(bench.slice(j, j + n).filter(blinks)).toEqual(bench.filter(blinks));
  });

  it("keeps every other part clear of the big gun's grip, on the rack and the bench", () => {
    const { rack, bench, i, j, n } = gunRun();
    for (const [name, parts, at] of [
      ["rack", rack, i],
      ["bench", bench, j],
    ] as const) {
      const gun = parts.slice(at, at + n);
      // The grip is the gun's lowest part: it hangs under the belly.
      const grip = [...gun].sort(
        (x, y) => shape(x.points).lo[1] - shape(y.points).lo[1],
      )[0];
      if (!grip) throw new Error(`${name}: no grip in the gun`);
      const g = shape(grip.points);
      const others = parts.filter((p) => !gun.includes(p));
      expect(others.length, name).toBeGreaterThan(0);
      for (const other of others) {
        const o = shape(other.points);
        const overlaps = ([0, 1, 2] as const).every(
          (k) => o.lo[k] < g.hi[k] - 1e-6 && g.lo[k] < o.hi[k] - 1e-6,
        );
        expect(overlaps, `${name} ${other.method}`).toBe(false);
      }
    }
  });

  it("ends the big gun in a round dark aperture with the green glow in its middle, in a silver-grey shell", () => {
    // Mutation caught: the square barrel back, the glow off the muzzle's
    // axis or out of its aperture, a dark shell, or the shell tinted green.
    const { rack, i, n } = gunRun();
    const gun = rack.slice(i, i + n);
    const box = (p: Part) => {
      const l = local(p);
      const lo = [0, 1, 2].map((k) => Math.min(...l.map((q) => q[k] ?? 0)));
      const hi = [0, 1, 2].map((k) => Math.max(...l.map((q) => q[k] ?? 0)));
      return { lo, hi, mid: lo.map((x, k) => (x + (hi[k] ?? 0)) / 2) };
    };
    const end = Math.max(...gun.map((p) => box(p).hi[0] ?? 0));
    const muzzle = gun.filter(
      (p) => p.method === "cylinderAlong" && (box(p).hi[0] ?? 0) > end - 0.03,
    );
    // The lip, the aperture and the glow, each smaller and further out.
    expect(muzzle).toHaveLength(3);
    const ranked = [...muzzle].sort(
      (x, y) => (box(y).hi[1] ?? 0) - (box(x).hi[1] ?? 0),
    );
    const [lip, aperture, glow] = ranked;
    if (!lip || !aperture || !glow) throw new Error("no muzzle");
    expect(blinks(glow)).toBe(true);
    expect(blinks(aperture) || blinks(lip)).toBe(false);
    const sum = (p: Part) => (p.tint ?? [1, 1, 1]).reduce((a, c) => a + c, 0);
    expect(sum(aperture)).toBeLessThan(0.5);
    expect(box(glow).hi[0]).toBeGreaterThan(box(aperture).hi[0] ?? 0);
    expect(box(aperture).hi[0]).toBeGreaterThan(box(lip).hi[0] ?? 0);
    for (const p of [aperture, glow]) {
      const b = box(p);
      // Round: as deep as it is tall, and on the lip's axis.
      expect((b.hi[1] ?? 0) - (b.lo[1] ?? 0)).toBeCloseTo(
        (b.hi[2] ?? 0) - (b.lo[2] ?? 0),
        6,
      );
      expect(b.mid[1]).toBeCloseTo(box(lip).mid[1] ?? 0, 6);
      expect(b.mid[2]).toBeCloseTo(box(lip).mid[2] ?? 0, 6);
    }
    // The body, the gun's largest part: a light grey with no colour cast.
    const body = gun.find(
      (p) =>
        p.method === "bevelBox" &&
        (box(p).hi[0] ?? 0) - (box(p).lo[0] ?? 0) > 0.5,
    );
    if (!body?.tint) throw new Error("no body");
    const [r, g, b] = body.tint;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.05);
    expect(r).toBeGreaterThan(0.45);
    // Its one steady light, the red indicator, and every other light green.
    expect(gun.filter((p) => p.flag === FLAG.signal)).toHaveLength(1);
    for (const p of gun.filter(blinks))
      expect(p.tint?.[1]).toBeGreaterThan(0.8);
  });

  it("the tube bench's three tubes meet at one round hub, two arms up and the stem down", () => {
    const parts = partsOf("tube-bench");
    const tubes = parts
      .filter(
        (p) =>
          p.method === "extrude" &&
          p.flag >= FLAG.blink &&
          p.flag < FLAG.blink + 3,
      )
      .map((p) => shape(p.points));
    expect(tubes).toHaveLength(3);
    const hub = parts.find((p) => {
      if (p.method !== "extrude" || p.flag !== FLAG.lit) return false;
      const h = shape(p.points);
      return tubes.every((t) => reaches(t, h) || reaches(h, t));
    });
    if (!hub) throw new Error("no hub that all three tubes reach");
    const hb = shape(hub.points);
    // Round in the wall's plane: as wide along the wall as it is tall.
    expect(hb.hi[0] - hb.lo[0]).toBeCloseTo(hb.hi[1] - hb.lo[1], 2);
    const hubH = (hb.lo[1] + hb.hi[1]) / 2;
    expect(tubes.filter((t) => t.hi[1] > hubH + 0.05)).toHaveLength(2);
    expect(tubes.filter((t) => t.lo[1] < hubH - 0.05)).toHaveLength(1);
  });

  it("runs the field pack's chase up the cell and round the cyclotron", () => {
    const centre = (p: Part) => {
      const b = shape(p.points);
      return [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2] as const;
    };
    const group = (p: Part) => p.flag - FLAG.blink;
    for (let v = 0; v < HERO_CATALOGUE["field-pack"].variants; v++) {
      const lights = partsOf("field-pack", v).filter(blinks);
      // The cell: one light per group, 0 at the bottom to 7 at the top.
      const cell = lights
        .filter((p) => p.method === "panel")
        .sort((p, q) => centre(p)[1] - centre(q)[1]);
      expect(cell.map(group), `v${String(v)}`).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7,
      ]);
      // The cyclotron: four lenses on groups 0, 2, 4 and 6, each the next
      // quarter round the ring in the same direction.
      const ring = lights
        .filter((p) => p.method === "extrude")
        .sort((p, q) => group(p) - group(q));
      expect(ring.map(group), `v${String(v)}`).toEqual([0, 2, 4, 6]);
      const cs = ring.map(centre);
      const mid = [0, 1].map(
        (k) => cs.reduce((n, c) => n + (c[k] ?? 0), 0) / cs.length,
      );
      const angles = cs.map((c) =>
        Math.atan2(c[1] - (mid[1] ?? 0), c[0] - (mid[0] ?? 0)),
      );
      const steps = angles.map((a, i) => {
        const next = angles[(i + 1) % angles.length] ?? a;
        const d = (((next - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI);
        return d - Math.PI;
      });
      const first = steps[0] ?? 0;
      expect(Math.abs(Math.abs(first) - Math.PI / 2)).toBeLessThan(1e-6);
      for (const step of steps) expect(step).toBeCloseTo(first, 6);
    }
  });

  it("builds the field pack's cyclotron as a stepped round housing with the bumper across its lower half", () => {
    // Mutation caught: a step dropped or not standing out of the one
    // under it, the lenses off the housing, or the bumper above the
    // cyclotron's centre or narrower than the body.
    for (let v = 0; v < HERO_CATALOGUE["field-pack"].variants; v++) {
      const parts = partsOf("field-pack", v);
      const lenses = parts.filter((p) => blinks(p) && p.method === "extrude");
      expect(lenses).toHaveLength(4);
      const ls = lenses.map((p) => shape(p.points));
      const mid = ([0, 1] as const).map(
        (k) => ls.reduce((n, b) => n + (b.lo[k] + b.hi[k]) / 2, 0) / 4,
      );
      const [ca = 0, ch = 0] = mid;
      // The steps: round extrudes centred on the lenses' centre, each
      // smaller and standing further out than the last.
      const steps = parts
        .filter((p) => {
          if (p.method !== "extrude" || blinks(p)) return false;
          const b = shape(p.points);
          return (
            Math.abs((b.lo[0] + b.hi[0]) / 2 - ca) < 1e-6 &&
            Math.abs((b.lo[1] + b.hi[1]) / 2 - ch) < 1e-6 &&
            b.hi[0] - b.lo[0] > 0.15
          );
        })
        .map((p) => shape(p.points))
        .sort((p, q) => q.hi[0] - q.lo[0] - (p.hi[0] - p.lo[0]));
      expect(steps.length, `v${String(v)}`).toBe(CYCLOTRON.steps.length);
      for (let i = 1; i < steps.length; i++) {
        const [outer, inner] = [steps[i - 1], steps[i]];
        if (!outer || !inner) throw new Error("steps");
        expect(inner.hi[0] - inner.lo[0]).toBeLessThan(
          outer.hi[0] - outer.lo[0],
        );
      }
      const big = steps[0];
      if (!big) throw new Error("no housing");
      expect(big.hi[0] - big.lo[0]).toBeGreaterThan(0.8 * PACK_W);
      for (const b of ls)
        expect(
          Math.hypot(
            (b.lo[0] + b.hi[0]) / 2 - ca,
            (b.lo[1] + b.hi[1]) / 2 - ch,
          ),
        ).toBeCloseTo(CYCLOTRON.ring, 6);
      // The bumper: one black bevelled bar wider than the body, below the
      // centre and above the lower lenses, in front of the housing.
      const bumpers = parts
        .filter((p) => p.method === "bevelBox")
        .map((p) => shape(p.points))
        .filter((b) => b.hi[0] - b.lo[0] > PACK_W);
      expect(bumpers).toHaveLength(1);
      const bump = bumpers[0];
      if (!bump) throw new Error("no bumper");
      expect(bump.hi[0] - bump.lo[0]).toBeCloseTo(2 * BUMPER.half, 6);
      expect(bump.hi[1]).toBeLessThan(ch);
      // The crank knob in copper on the bumper.
      expect(inked(parts, COPPER).length).toBeGreaterThan(0);
    }
  });

  it("hangs the wand tip down on the field pack's right side and runs its cables in their colours", () => {
    // Mutation caught: the wand back on the left or tip up, a cable colour
    // dropped, the ribbon cable's stripes merged, or the straps lost.
    for (let v = 0; v < HERO_CATALOGUE["field-pack"].variants; v++) {
      const parts = partsOf("field-pack", v);
      const tip = inked(parts, TIP_ORANGE);
      expect(tip).toHaveLength(1);
      const t = shape((tip[0] as Part).points);
      // Local `a` of the tip: right of the body (the room sees `+a` on
      // its right), and the wand's lowest part.
      const ta = local(tip[0] as Part).map((q) => q[0]);
      expect(Math.min(...ta)).toBeGreaterThan(PACK_W / 2);
      // The grey gunbox hangs over it, the tip the barrel's low end.
      const box = inked(parts, WAND_GREY);
      expect(box).toHaveLength(1);
      const g = shape((box[0] as Part).points);
      expect(g.lo[1]).toBeGreaterThan(t.hi[1] + 0.3);
      for (const q of local(box[0] as Part))
        expect(q[0]).toBeGreaterThan(PACK_W / 2);
      // The power cell's lights on the left half.
      for (const p of parts.filter((q) => blinks(q) && q.method === "panel"))
        for (const q of local(p)) expect(q[0]).toBeLessThan(0);
      // The cables and the plates in their colours.
      for (const c of [
        ...RIBBON,
        WIRE.red,
        WIRE.blue,
        WIRE.yellow,
        WARNING_PLATE,
      ])
        expect(inked(parts, c).length, c.join()).toBeGreaterThan(0);
      // The olive straps on the frame's back, behind the body.
      const straps = inked(parts, STRAP_OLIVE).flatMap(local);
      expect(straps.length).toBeGreaterThan(0);
      for (const q of straps) expect(q[1]).toBeLessThan(-PACK_D / 2);
    }
  });

  it("keeps the field pack in its footprint, on its stand and under its triangle pin", () => {
    // Mutation caught: a part reaching past the footprint or the top, or
    // the detail growing far past the pin.
    for (let v = 0; v < HERO_CATALOGUE["field-pack"].variants; v++) {
      const { hw, d0, d1, top } = heroHalf("field-pack", v);
      for (const q of partsOf("field-pack", v).flatMap(local)) {
        expect(Math.abs(q[0])).toBeLessThanOrEqual(hw + 1e-9);
        expect(q[1]).toBeGreaterThanOrEqual(d0 - 1e-9);
        expect(q[1]).toBeLessThanOrEqual(d1 + 1e-9);
        expect(q[2]).toBeGreaterThanOrEqual(-1e-9);
        expect(q[2]).toBeLessThanOrEqual(top + 1e-9);
      }
      expect(buildHeroMesh("field-pack", v, LOOK).count / 3).toBeLessThan(2800);
    }
  });

  it("prints the tube bench's two labels on the box, the short one on the bottom rail and the long one over the lights (2.6f C13)", () => {
    // Mutation caught: a label missing, the two swapped, a label set from
    // the wrong string, or below the floor.
    const [low = "", high = ""] = MARKS.benchLabels;
    expect(runsOfLines(MARKS.benchLabels)).toBeGreaterThan(3);
    const ink = inked(partsOf("tube-bench"), LABEL_INK, "panel");
    expect(ink).toHaveLength(runsOfLines(MARKS.benchLabels));
    const within = (p: Part, h0: number, h1: number) =>
      local(p).every(
        (q) =>
          q[0] >= BOX_FRONT.a0 - 1e-9 &&
          q[0] <= BOX_FRONT.a1 + 1e-9 &&
          q[2] >= h0 - 1e-9 &&
          q[2] <= h1 + 1e-9,
      );
    expect(
      ink.filter((p) => within(p, BOTTOM_RAIL.h0, BOTTOM_RAIL.h1)),
    ).toHaveLength(runsOfLines(low));
    expect(
      ink.filter((p) => within(p, OVER_LIGHTS.h0, OVER_LIGHTS.h1)),
    ).toHaveLength(runsOfLines(high));
    for (const p of ink)
      expect(heightOf(p)).toBeGreaterThanOrEqual(0.003 - 1e-9);
  });

  it("sets each label's letters one lift proud of its red tape, the tape one lift proud of the box (2.6f C17)", () => {
    // Mutation caught: the letters off the tape (floating or sunk), a tape
    // missing, or a letter run past its tape's ends.
    const parts = partsOf("tube-bench");
    const tapes = parts
      .filter(
        (p) => p.method === "panel" && p.tint?.join() === LABEL_TAPE.join(),
      )
      .map((p) => {
        const ps = local(p);
        for (const q of ps)
          expect(q[1]).toBeCloseTo(BOX_FRONT.d + DECAL_LIFT, 9);
        const as = ps.map((q) => q[0]);
        const hs = ps.map((q) => q[2]);
        return [
          Math.min(...as),
          Math.max(...as),
          Math.min(...hs),
          Math.max(...hs),
        ] as const;
      });
    expect(tapes).toHaveLength(MARKS.benchLabels.length);
    for (const p of inked(parts, LABEL_INK, "panel")) {
      const ps = local(p);
      for (const q of ps)
        expect(q[1]).toBeCloseTo(BOX_FRONT.d + 2 * DECAL_LIFT, 9);
      const on = tapes.filter(([a0, a1, h0, h1]) =>
        ps.every(
          (q) =>
            q[0] >= a0 - 1e-9 &&
            q[0] <= a1 + 1e-9 &&
            q[2] >= h0 - 1e-9 &&
            q[2] <= h1 + 1e-9,
        ),
      );
      expect(on).toHaveLength(1);
    }
  });
});
