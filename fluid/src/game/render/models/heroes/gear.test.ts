/**
 * The gear exhibits' shape tests: what `heroModels.test.ts` does not
 * check for every kind. The turntable's deck at its true size on its
 * table, its platter on the left half with the strobe dots round the rim
 * and the record on the mat, the tonearm at its true reach from the
 * spindle, the crate of sleeves on the shelf, its two lights in their
 * corners, the maker's name read back from the top, and its triangle
 * pin. The camera at its true size at eye height on its tripod, the lens
 * pointing at the room, the viewfinder window in the front's right corner,
 * its one light on the front, the maker's name read back from the front,
 * the three legs standing on the plinth, and its triangle pin.
 */

import { describe, expect, it } from "vitest";

import { FLAG, blinkFlag, type V3 } from "../../geometry";
import { frameAt } from "../../kit";
import { LOOK } from "../../looks";
import {
  cellsOf,
  inked,
  partsOf,
  toLocal,
  trimmed,
  type Part,
} from "../../modelChecks";
import { MARKS } from "../marks";
import { buildHeroMesh } from ".";
import { STATUS_GREEN, heroHalf } from "./common";
import {
  ARM,
  ASSIST_LAMP,
  CAMERA,
  CAMERA_INK,
  CAMERA_MARK,
  DECK,
  DECK_INK,
  DECK_MARK,
  DECK_SILVER,
  FINDER,
  FINDER_GLASS,
  LEATHERETTE,
  LENS,
  PLATTER,
  STROBE_DOT,
  STROBE_LAMP,
  STROBE_ROWS,
  TABLE,
  TRIPOD,
} from "./gear";
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

/** Every point of some parts, in the recipe's local terms. */
const pointsOf = (parts: readonly Part[]): V3[] => parts.flatMap(local);

/** The deck's top face, over the table. */
const PLATE = TABLE.top + DECK.plate;

describe("the turntable's model", () => {
  const parts = partsOf("turntable");

  it("stands the deck at its true size on the table, its silver top at the plate's height", () => {
    // Mutation caught: the deck scaled, moved off the table or its top
    // at another height.
    const silver = pointsOf(inked(parts, DECK_SILVER, "bevelBox"));
    const a = span(silver, 0);
    const d = span(silver, 1);
    const h = span(silver, 2);
    expect(a.hi - a.lo).toBeCloseTo(0.453, 3);
    expect(d.hi - d.lo).toBeCloseTo(0.36, 3);
    expect(h.hi).toBeCloseTo(PLATE, 4);
    expect(h.lo).toBeGreaterThan(TABLE.top);
    expect(PLATE).toBeGreaterThan(0.9);
    expect(PLATE).toBeLessThan(1.0);
  });

  it("sets the platter on the deck's left half with its strobe dots round the rim and the record on the mat", () => {
    // Mutation caught: the platter centred, a row of dots dropped or off
    // the rim, or the record under the mat.
    const top = span(pointsOf(inked(parts, DECK_SILVER, "bevelBox")), 0);
    expect(PLATTER.a).toBeLessThan((top.lo + top.hi) / 2);
    expect(PLATTER.a - PLATTER.r).toBeGreaterThan(top.lo);
    const dots = inked(parts, STROBE_DOT);
    expect(dots).toHaveLength(STROBE_ROWS.reduce((n, r) => n + r.n, 0));
    for (const p of dots) {
      const pts = local(p);
      const ca = span(pts, 0).mid - PLATTER.a;
      const cd = span(pts, 1).mid - PLATTER.d;
      expect(Math.hypot(ca, cd)).toBeGreaterThan(PLATTER.r - 0.003);
      expect(Math.hypot(ca, cd)).toBeLessThan(PLATTER.r + 0.003);
      expect(span(pts, 2).hi).toBeLessThanOrEqual(PLATE + PLATTER.rise);
    }
    const discs = parts.filter((p) => p.method === "cylinder");
    const at = (r: number) =>
      discs.find(
        (p) =>
          Math.abs(span(local(p), 0).hi - (PLATTER.a + r)) < 1e-3 &&
          Math.abs(span(local(p), 1).mid - PLATTER.d) < 1e-3,
      );
    const mat = at(PLATTER.matR);
    const vinyl = at(PLATTER.vinylR);
    if (mat === undefined || vinyl === undefined)
      throw new Error("no mat or record");
    expect(span(local(vinyl), 2).lo).toBeCloseTo(span(local(mat), 2).hi, 6);
  });

  it("reaches the tonearm 215 mm from the spindle, the counterweight behind the pivot and the headshell off the platter", () => {
    // Mutation caught: the arm's pivot moved, the weight in front of it, or
    // the headshell resting on the record.
    const [pa, pd] = ARM.pivot;
    expect(Math.hypot(pa - PLATTER.a, pd - PLATTER.d)).toBeCloseTo(0.215, 3);
    expect(ARM.weight.d1).toBeLessThan(ARM.weight.d0);
    expect(ARM.weight.d0).toBeLessThan(pd);
    expect(ARM.weight.d1).toBeGreaterThan(-DECK.d / 2 - 1e-9);
    const [ta, td] = ARM.tip;
    expect(Math.hypot(ta - PLATTER.a, td - PLATTER.d)).toBeGreaterThan(
      PLATTER.r,
    );
    expect(pa).toBeGreaterThan(0);
  });

  it("stands the sleeves in the crate on the shelf, under the table", () => {
    // Mutation caught: a sleeve floating over the crate or poking through
    // the table's top.
    const sleeves = parts.filter(
      (p) =>
        p.method === "box" &&
        span(local(p), 1).hi - span(local(p), 1).lo < 0.005 &&
        span(local(p), 2).hi - span(local(p), 2).lo > 0.25,
    );
    expect(sleeves.length).toBeGreaterThanOrEqual(8);
    for (const p of sleeves) {
      const h = span(local(p), 2);
      expect(h.lo).toBeGreaterThan(TABLE.shelf[1]);
      expect(h.lo).toBeLessThan(TABLE.shelf[1] + 0.02);
      expect(h.hi).toBeLessThan(TABLE.h0);
    }
  });

  it("lights the strobe lamp in the front left corner and the green lock light by the pitch slider", () => {
    // Mutation caught: a light in the wrong corner, on the platter, or in
    // the wrong group.
    const lit = parts.filter((p) => p.flag !== FLAG.lit);
    expect(lit).toHaveLength(2);
    const lamp = inked(parts, STROBE_LAMP);
    const lock = inked(parts, STATUS_GREEN);
    expect(lamp.map((p) => p.flag)).toEqual([blinkFlag(0)]);
    expect(lock.map((p) => p.flag)).toEqual([blinkFlag(1)]);
    const [l] = lamp;
    const [g] = lock;
    if (l === undefined || g === undefined) throw new Error("no lights");
    const la = span(local(l), 0).mid;
    const ld = span(local(l), 1).mid;
    expect(la).toBeLessThan(-0.15);
    expect(ld).toBeGreaterThan(0.08);
    expect(Math.hypot(la - PLATTER.a, ld - PLATTER.d)).toBeGreaterThan(
      PLATTER.r,
    );
    expect(span(local(g), 0).mid).toBeGreaterThan(0.15);
  });

  it("reads the maker's name from the front, flat in the top's back left corner, at 3 mm pixels or more", () => {
    // Mutation caught: the name mirrored, read from the back, under the
    // 3 mm floor, run onto the platter, or over the top's bevel.
    const ink = inked(parts, DECK_INK);
    expect(ink.length).toBeGreaterThan(0);
    const { rows, px } = cellsOf(ink, (q) => {
      const [a, d] = toLocal(frameAt([0, 0, 0], 0), q);
      return [a, d];
    });
    expect(trimmed(rows)).toEqual(trimmed(textRows(MARKS.deckMark)));
    expect(px).toBeGreaterThanOrEqual(0.003 - 1e-9);
    const [a0, a1, d0, d1] = DECK_MARK;
    for (const q of pointsOf(ink)) {
      expect(q[0]).toBeGreaterThanOrEqual(a0 - 1e-9);
      expect(q[0]).toBeLessThanOrEqual(a1 + 1e-9);
      expect(q[1]).toBeGreaterThanOrEqual(d0 - 1e-9);
      expect(q[1]).toBeLessThanOrEqual(d1 + 1e-9);
      expect(Math.abs(q[0])).toBeLessThanOrEqual(DECK.w / 2 - DECK.bevel);
      expect(Math.abs(q[1])).toBeLessThanOrEqual(DECK.d / 2 - DECK.bevel);
      expect(q[2]).toBeGreaterThanOrEqual(PLATE - 1e-9);
      expect(Math.hypot(q[0] - PLATTER.a, q[1] - PLATTER.d)).toBeGreaterThan(
        PLATTER.r,
      );
    }
  });

  it("stays under its triangle pin", () => {
    expect(buildHeroMesh("turntable", 0, LOOK).count / 3).toBeLessThan(3300);
  });
});

describe("the exhibit pieces' bounds", () => {
  /** Every point of a kind inside its footprint, on the floor, under its top. */
  const inside = (kind: "turntable" | "camera") => {
    const { hw, d0, d1, top } = heroHalf(kind, 0);
    const pts = pointsOf(partsOf(kind));
    for (const q of pts) {
      expect(Math.abs(q[0])).toBeLessThanOrEqual(hw + 1e-9);
      expect(q[1]).toBeGreaterThanOrEqual(d0 - 1e-9);
      expect(q[1]).toBeLessThanOrEqual(d1 + 1e-9);
      expect(q[2]).toBeGreaterThanOrEqual(-1e-9);
      expect(q[2]).toBeLessThanOrEqual(top + 1e-9);
    }
    return { hw, d0, d1, pts };
  };

  it("keeps the turntable's table inside its footprint, filling it, the deck on its top", () => {
    // Mutation caught: the table grown past the footprint or shrunk off
    // it, or the deck hanging over the table's edge.
    const { hw, d0, d1 } = inside("turntable");
    const top = pointsOf(
      partsOf("turntable").filter(
        (p) =>
          p.method === "bevelBox" &&
          Math.abs(span(local(p), 2).hi - TABLE.top) < 1e-9,
      ),
    );
    expect(span(top, 0).lo).toBeCloseTo(-hw, 6);
    expect(span(top, 0).hi).toBeCloseTo(hw, 6);
    expect(span(top, 1).lo).toBeCloseTo(d0, 6);
    expect(span(top, 1).hi).toBeCloseTo(d1, 6);
    expect(DECK.w / 2).toBeLessThan(hw);
    expect(DECK.d / 2 + 0.015).toBeLessThan(d1);
  });

  it("keeps the camera's plinth and tripod inside its footprint", () => {
    // Mutation caught: the plinth or a leg's foot past the footprint.
    const { hw, d1 } = inside("camera");
    expect(TRIPOD.plinth.r).toBeLessThanOrEqual(Math.min(hw, d1));
    expect(TRIPOD.foot).toBeLessThan(TRIPOD.plinth.r);
  });
});

describe("the camera's model", () => {
  const parts = partsOf("camera");
  const [w, dd] = [CAMERA.w / 2, CAMERA.d / 2];
  const b = CAMERA.bottom;

  it("holds the body at its true size at eye height over the tripod's plate", () => {
    // Mutation caught: the body scaled, or lowered off eye height.
    const body = pointsOf(
      parts.filter(
        (p) =>
          p.method === "bevelBox" &&
          Math.abs(span(local(p), 0).hi - span(local(p), 0).lo - CAMERA.w) <
            1e-6,
      ),
    );
    expect(span(body, 0).hi - span(body, 0).lo).toBeCloseTo(0.1405, 4);
    expect(span(body, 1).hi - span(body, 1).lo).toBeCloseTo(0.0348, 4);
    expect(span(body, 2).hi - span(body, 2).lo).toBeCloseTo(0.0828, 4);
    expect(span(body, 2).lo).toBeCloseTo(b, 6);
    expect(b).toBeGreaterThan(1.35);
    expect(b + CAMERA.h).toBeLessThan(1.6);
  });

  it("points the lens at the room, low and a little left, with its glass at the front", () => {
    // Mutation caught: the lens pointing back, centred, or above the name.
    const glass = inked(parts, FINDER_GLASS, "cylinderAlong");
    expect(glass).toHaveLength(1);
    const [g] = glass;
    if (g === undefined) throw new Error("no lens glass");
    const pts = local(g);
    expect(span(pts, 1).lo).toBeGreaterThan(dd + 0.04);
    expect(span(pts, 0).mid).toBeCloseTo(LENS.a, 6);
    expect(LENS.a).toBeLessThan(0);
    const top = b + LENS.h + Math.max(...LENS.rings.map((r) => r[2]));
    expect(top).toBeLessThanOrEqual(b + CAMERA_MARK[2] + 1e-9);
  });

  it("sets the viewfinder window in the top plate's right corner, right of the name", () => {
    // Mutation caught: the window on the left or overlapping the name.
    const [f0, f1, g0, g1] = FINDER;
    expect(f0).toBeGreaterThan(CAMERA_MARK[1]);
    expect(f1).toBeLessThan(w);
    expect(g0).toBeGreaterThanOrEqual(CAMERA.plate - 1e-9);
    expect(g1).toBeLessThan(CAMERA.h);
    const window = inked(parts, FINDER_GLASS, "box").filter(
      (p) => span(local(p), 1).lo > 0,
    );
    expect(window).toHaveLength(1);
  });

  it("lights only the focus assist lamp, on the front between the lens and the window", () => {
    // Mutation caught: a second light, or the lamp off the front.
    const lit = parts.filter((p) => p.flag !== FLAG.lit);
    expect(lit).toHaveLength(1);
    const lamp = inked(parts, ASSIST_LAMP);
    expect(lamp.map((p) => p.flag)).toEqual([blinkFlag(0)]);
    const [l] = lamp;
    if (l === undefined) throw new Error("no lamp");
    const pts = local(l);
    expect(span(pts, 1).lo).toBeCloseTo(dd, 6);
    expect(span(pts, 0).mid).toBeGreaterThan(LENS.a);
    expect(span(pts, 0).mid).toBeLessThan(FINDER[0]);
  });

  it("reads the maker's name from the front across the top plate, at 3 mm pixels or more", () => {
    // Mutation caught: the name mirrored, under the 3 mm floor, or off the
    // top plate's front.
    const ink = inked(parts, CAMERA_INK);
    expect(ink.length).toBeGreaterThan(0);
    const { rows, px } = cellsOf(ink, (q) => {
      const [a, , h] = toLocal(frameAt([0, 0, 0], 0), q);
      return [a, -h];
    });
    expect(trimmed(rows)).toEqual(trimmed(textRows(MARKS.cameraMark)));
    expect(px).toBeGreaterThanOrEqual(0.003 - 1e-9);
    for (const q of pointsOf(ink)) {
      expect(q[1]).toBeGreaterThanOrEqual(dd - 1e-9);
      expect(q[2]).toBeGreaterThanOrEqual(b + CAMERA.plate);
      expect(q[2]).toBeLessThanOrEqual(b + CAMERA.h);
      expect(q[0]).toBeLessThan(FINDER[0]);
    }
  });

  it("stands the tripod's three legs on the plinth, spread round the column", () => {
    // Mutation caught: a leg dropped, through the plinth or off its edge.
    const feet = parts.filter(
      (p) =>
        p.method === "cylinder" &&
        p.tint?.join() === LEATHERETTE.join() &&
        Math.abs(span(local(p), 2).lo - TRIPOD.plinth.h) < 1e-6,
    );
    expect(feet).toHaveLength(3);
    const turns = feet.map((p) => {
      const pts = local(p);
      const [a, d] = [span(pts, 0).mid, span(pts, 1).mid];
      expect(Math.hypot(a, d)).toBeCloseTo(TRIPOD.foot, 3);
      expect(Math.hypot(a, d)).toBeLessThan(TRIPOD.plinth.r);
      return Math.atan2(d, a);
    });
    turns.sort((x, y) => x - y);
    const gaps = turns.map(
      (t, i) => ((turns[(i + 1) % 3] ?? 0) - t + 2 * Math.PI) % (2 * Math.PI),
    );
    for (const g of gaps) expect(g).toBeCloseTo((2 * Math.PI) / 3, 3);
  });

  it("stays under its triangle pin", () => {
    expect(buildHeroMesh("camera", 0, LOOK).count / 3).toBeLessThan(2700);
  });
});
