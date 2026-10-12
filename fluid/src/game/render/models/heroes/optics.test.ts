/**
 * The optics heroes' shape tests: what `heroModels.test.ts` does not check
 * for every kind. Whether the laser desk's catalogue top lies on a real,
 * clear upward face is `heroModels.test.ts`'s check now, for every kind;
 * here, the laser desk's own top stays clear in the recipe's own terms
 * too, the slab keeps its 1 : 4 : 9, the turret's eye looks out of its
 * front and a seam splits its shell, the eye panel is a portrait plate
 * at the original's true size with a small dot at the middle of its
 * lens, the photo console's picture leans back, and the laser desk's
 * laser stands on the floor behind its stool and fires into the sitter's
 * back (0.25.1). The marks: the eye panel's two words on its badge, the
 * first on the black and the last on the blue field, the photo console's
 * wordmark on the lip beside its print slot, and the laser desk
 * terminal's two blue lines and its boxed mark on its screen.
 */

import { describe, expect, it } from "vitest";

import { HERO_CATALOGUE } from "../../../world/heroes";
import { blinkFlag, FLAG, type V3 } from "../../geometry";
import { DECAL_LIFT, frameAt } from "../../kit";
import { LOOK } from "../../looks";
import {
  inked,
  partsOf,
  placeMesh,
  positions,
  runsOfLines,
  toLocal,
  type Part,
} from "../../modelChecks";
import { MARKS } from "../marks";
import { buildHeroMesh } from ".";
import {
  BADGE_BLUE,
  BADGE_INK,
  DESK_BADGE_INK,
  LAB_STOOL,
  LASER_DESK,
  MARK_GREY,
  SCREEN_BLUE,
} from "./optics";

/**
 * How high the laser desk's catalogue top must stay clear of a part, in
 * the recipe's own `h`, in metres: the top's own headroom (h 0.74 plus a
 * clear 1.15) and a little more.
 */
const CLEAR_TO = 1.9;

/** A part's points in the recipe's local `[a, d, h]`. */
const local = (p: Part): V3[] =>
  p.points.map((q) => toLocal(frameAt([0, 0, 0], 0), q));

/** The height of a panel part: its pixel size, for a mark's run. */
const heightOf = (p: Part): number => {
  const hs = local(p).map((q) => q[2]);
  return Math.max(...hs) - Math.min(...hs);
};

/**
 * The eye panel's name badge, as `EYE_PANEL` builds it: its black plate's
 * `a` and `h` range and its front (the plate's face at 0.03 plus the
 * badge's 0.003), and the blue field's lift over that front.
 */
const BADGE = { a0: -0.046, a1: 0.046, h0: 1.766, h1: 1.788, front: 0.033 };
const BLUE_LIFT = 0.001;

/**
 * The eye panel at the original's true size (0.25.1): the faceplate's
 * width and its bottom and top, the eye's centre height (standing eye
 * height) and the lens's radius (a 74 mm glass).
 */
const EYE_PANEL_SIZE = {
  width: 0.116,
  h0: 1.454,
  h1: 1.8,
  eyeH: 1.6,
  r: 0.037,
};

/**
 * The photo console's lip under its screen, as `PHOTO_CONSOLE` builds it:
 * the upright strip of the hood at d 0.45 from the deck's back edge (h
 * 0.95) to the screen face's foot (h 1.0), out to the hood's half width;
 * the print slot takes `a` -0.2 to 0.2 of it.
 */
const LIP = { d: 0.45, h0: 0.95, h1: 1.0, slot: 0.2, half: 0.52 };

/** The one part of a list, failing the test when there is not exactly one. */
function one(parts: readonly Part[]): Part {
  expect(parts).toHaveLength(1);
  const p = parts[0];
  if (!p) throw new Error("no part");
  return p;
}

/** The bounds of a list of local points. */
function bounds(points: readonly V3[]): { lo: V3; hi: V3 } {
  const lo = (k: 0 | 1 | 2) => Math.min(...points.map((p) => p[k]));
  const hi = (k: 0 | 1 | 2) => Math.max(...points.map((p) => p[k]));
  return { lo: [lo(0), lo(1), lo(2)], hi: [hi(0), hi(1), hi(2)] };
}

/** The middle of a list of local points' bounds. */
function centre(points: readonly V3[]): V3 {
  const mid = (k: 0 | 1 | 2) =>
    (Math.min(...points.map((p) => p[k])) +
      Math.max(...points.map((p) => p[k]))) /
    2;
  return [mid(0), mid(1), mid(2)];
}

describe("optics hero models", () => {
  it("keeps the laser desk's catalogue top clear in the recipe's own terms", () => {
    // The catalogue's own rectangle and height: nothing may stand on it
    // below `CLEAR_TO`, neither a vertex nor a part whose bounds span the
    // area (a long box whose corners all lie outside it).
    const [surf] = HERO_CATALOGUE["laser-desk"].surfaces;
    if (!surf) throw new Error("laser-desk has no catalogue surface");
    const { a0, a1, d0, d1, h: h0 } = surf;
    const h1 = CLEAR_TO;
    const parts = partsOf("laser-desk");
    const inside = (p: V3) =>
      p[0] > a0 &&
      p[0] < a1 &&
      p[1] > d0 &&
      p[1] < d1 &&
      p[2] > h0 + 1e-6 &&
      p[2] < h1;
    expect(parts.flatMap(local).filter(inside)).toEqual([]);
    const over = parts
      .map((p, i) => ({ i, method: p.method, b: bounds(local(p)) }))
      .filter(
        ({ b }) =>
          b.lo[0] < a1 &&
          b.hi[0] > a0 &&
          b.lo[1] < d1 &&
          b.hi[1] > d0 &&
          b.lo[2] < h1 &&
          b.hi[2] > h0 + 1e-6,
      )
      .map(({ i, method }) => `${String(i)}:${method}`);
    expect(over).toEqual([]);
  });

  it("the slab is 1 : 4 : 9", () => {
    const ps = positions(
      placeMesh(buildHeroMesh("black-slab", 0, LOOK), 0, [0, 0, 0]),
    );
    const extent = (k: 0 | 1 | 2) =>
      Math.max(...ps.map((p) => p[k])) - Math.min(...ps.map((p) => p[k]));
    expect(extent(0)).toBeCloseTo(1.2, 6);
    expect(extent(2)).toBeCloseTo(0.3, 6);
    expect(extent(1)).toBeCloseTo(2.7, 6);
  });

  it("the turret's eye faces front", () => {
    const eye = one(partsOf("turret").filter((p) => p.flag === blinkFlag(0)));
    const [, d, h] = centre(local(eye));
    expect(d).toBeGreaterThan(0.2);
    expect(h).toBeGreaterThan(0.95);
    expect(h).toBeLessThan(1.1);
  });

  it("stands the laser on the floor behind the stool, aimed at the sitter's back (0.25.1)", () => {
    // Jordi, 2026-10-12: the laser fires from behind the seated person, as
    // in the original's shot. Mutation caught: the laser back over the
    // stool or in front of it, its lens turned away from the stool, its
    // lens below the seat or far above a sitter's shoulders, the stool
    // turned with its back away from the laser, or the pedestal off the
    // floor.
    const parts = partsOf("laser-desk");
    const [s0, s1] = LAB_STOOL.seat;
    const B = LAB_STOOL.back;
    const spans = (p: Part, h0: number, h1: number) => {
      const hs = local(p).map((q) => q[2]);
      return (
        Math.abs(Math.min(...hs) - h0) < 1e-6 &&
        Math.abs(Math.max(...hs) - h1) < 1e-6
      );
    };
    const seat = one(
      parts.filter((p) => p.method === "lathe" && spans(p, s0, s1)),
    );
    const back = one(
      parts.filter((p) => p.method === "bevelBox" && spans(p, B.h0, B.h1)),
    );
    const lensDisc = one(parts.filter((p) => p.flag === blinkFlag(0)));
    const [sa, sd] = centre(local(seat));
    const [ba, bd] = centre(local(back));
    const [la, ld, lh] = centre(local(lensDisc));
    // The stool faces from its back towards its seat; the lens lies in its
    // rear arc, more than 135 degrees off the way it faces.
    const [fa, fd] = [sa - ba, sd - bd];
    const [ta, td] = [la - sa, ld - sd];
    const cos = (fa * ta + fd * td) / (Math.hypot(fa, fd) * Math.hypot(ta, td));
    expect(cos).toBeLessThan(Math.cos((135 * Math.PI) / 180));
    // Behind the stool's back, at a sitter's back height.
    expect(Math.hypot(la - sa, ld - sd)).toBeGreaterThan(
      Math.hypot(ba - sa, bd - sd),
    );
    expect(lh).toBeGreaterThan(B.h1);
    expect(lh).toBeLessThan(1.4);
    // The lens is a thin disc standing upright, facing along d.
    const lb = bounds(local(lensDisc));
    expect(lb.hi[1] - lb.lo[1]).toBeLessThan(0.03);
    expect(lb.hi[2] - lb.lo[2]).toBeGreaterThan(0.08);
    // The pedestal's foot stands on the floor just behind the lens.
    const foot = parts.filter((p) => {
      if (p.method !== "cylinder") return false;
      const b = bounds(local(p));
      const [ca, cd] = centre(local(p));
      return (
        Math.abs(b.lo[2]) < 1e-9 &&
        Math.abs(ca - la) < 1e-6 &&
        cd > ld &&
        cd - ld < 0.25 &&
        b.hi[0] - b.lo[0] > 0.25
      );
    });
    expect(foot).toHaveLength(1);
    // Nothing of the laser hangs over the stool: no part but the beam
    // guide reaches over the seat above the stool's back.
    const over = parts.filter((p) => {
      if (p.flag === blinkFlag(1)) return false;
      return local(p).some(
        (q) =>
          Math.hypot(q[0] - sa, q[1] - sd) < LAB_STOOL.seatR &&
          q[2] > B.h1 + 1e-6,
      );
    });
    expect(over).toEqual([]);
  });

  it("runs the beam guide from the lens forward and a little down towards the stool (0.25.1)", () => {
    // Mutation caught: the beam dropping from overhead, pointing away from
    // the stool, rising, or ending inside the stool's back.
    const parts = partsOf("laser-desk");
    const beam = one(parts.filter((p) => p.flag === blinkFlag(1)));
    const lensDisc = one(parts.filter((p) => p.flag === blinkFlag(0)));
    const [la, ld, lh] = centre(local(lensDisc));
    const b = bounds(local(beam));
    const { a, d } = LASER_DESK.stool;
    // It starts at the lens and ends closer to the stool.
    expect(b.hi[1]).toBeGreaterThan(ld - 0.03);
    expect(Math.abs(b.lo[1] - d)).toBeLessThan(Math.abs(ld - d));
    expect(Math.abs((b.lo[0] + b.hi[0]) / 2 - la)).toBeLessThan(1e-6);
    expect(Math.abs(la - a)).toBeLessThan(1e-6);
    // Mostly level: it drops less than it runs, and stays over the back.
    const run = b.hi[1] - b.lo[1];
    const drop = b.hi[2] - b.lo[2];
    expect(run).toBeGreaterThan(0.2);
    expect(drop).toBeLessThan(run);
    expect(b.hi[2]).toBeLessThanOrEqual(lh + 0.02);
    expect(b.lo[2]).toBeGreaterThan(LAB_STOOL.back.h1);
  });

  it("gives the laser desk its five lights, one part each, in the breathe groups 0 to 4", () => {
    // Mutation caught: a light dropped or doubled, or a group moved.
    const parts = partsOf("laser-desk");
    for (let g = 0; g < 5; g++)
      expect(
        parts.filter((p) => p.flag === blinkFlag(g)),
        `group ${String(g)}`,
      ).toHaveLength(1);
    const blinking = parts.filter((p) => p.flag >= FLAG.blink);
    expect(blinking).toHaveLength(5);
  });

  it("keeps every laser desk part inside its footprint and on or over the floor", () => {
    // Mutation caught: a part of the new laser, its pipe or its cabinet
    // pushed past the 2.4 by 3.0 m footprint or under the floor.
    for (const p of partsOf("laser-desk"))
      for (const q of local(p)) {
        expect(Math.abs(q[0])).toBeLessThanOrEqual(1.2 + 1e-9);
        expect(Math.abs(q[1])).toBeLessThanOrEqual(1.5 + 1e-9);
        expect(q[2]).toBeGreaterThanOrEqual(-1e-9);
      }
  });

  it("keeps the laser desk under its triangle pin", () => {
    // 0.25.1: the rebuilt laser, stool and terminal; the 4000 hero cap
    // stays well clear.
    expect(buildHeroMesh("laser-desk", 0, LOOK).count / 3).toBeLessThan(3300);
  });

  it("sets the terminal's two lines in blue and its boxed mark in grey on the screen (0.25.1)", () => {
    // Mutation caught: a line or the mark missing, set from the wrong
    // string, under the 3 mm floor, off the screen, or the second line not
    // set in under the end of the first.
    const parts = partsOf("laser-desk");
    const S = LASER_DESK.screen;
    const M = LASER_DESK.monitor;
    const onScreen = (p: Part) =>
      local(p).every(
        (q) =>
          q[0] >= S.a0 - 1e-9 &&
          q[0] <= S.a1 + 1e-9 &&
          q[2] >= S.h0 - 1e-9 &&
          q[2] <= S.h1 + 1e-9 &&
          q[1] > M.d1 + S.depth &&
          q[1] < M.d1 + S.depth + 0.003,
      );
    const blue = inked(parts, SCREEN_BLUE, "panel");
    expect(blue).toHaveLength(runsOfLines(MARKS.terminalLines));
    const grey = inked(parts, MARK_GREY, "panel");
    // The mark's runs and the four lines of its box.
    expect(grey).toHaveLength(runsOfLines(MARKS.terminalMark) + 4);
    for (const p of [...blue, ...grey]) expect(onScreen(p)).toBe(true);
    for (const p of blue) expect(heightOf(p)).toBeGreaterThanOrEqual(0.003);
    // Every stroke of the mark and its box is at least 3 mm across.
    for (const p of grey) {
      const b = bounds(local(p));
      expect(b.hi[0] - b.lo[0]).toBeGreaterThanOrEqual(0.003 - 1e-9);
      expect(b.hi[2] - b.lo[2]).toBeGreaterThanOrEqual(0.003 - 1e-9);
    }
    // The second line starts right of the first line's end and lower.
    const [first = ""] = MARKS.terminalLines;
    const firstRuns = runsOfLines(first);
    const firstBox = bounds(blue.slice(0, firstRuns).flatMap(local));
    const secondBox = bounds(blue.slice(firstRuns).flatMap(local));
    expect(secondBox.lo[0]).toBeGreaterThan(firstBox.hi[0]);
    expect(secondBox.hi[2]).toBeLessThan(firstBox.lo[2]);
    // The mark sits in the lower right, under and right of the text.
    const markBox = bounds(grey.flatMap(local));
    expect(markBox.hi[2]).toBeLessThan(secondBox.lo[2]);
    expect(markBox.lo[0]).toBeGreaterThan((S.a0 + S.a1) / 2);
  });

  it("splits the turret's shell with a seam down its front", () => {
    const seams = partsOf("turret").filter((p) => {
      const ps = local(p);
      const b = bounds(ps);
      return (
        p.flag === FLAG.lit &&
        Math.max(Math.abs(b.lo[0]), Math.abs(b.hi[0])) < 0.006 &&
        b.hi[1] > 0.27 &&
        b.lo[2] < 0.45
      );
    });
    expect(seams.length).toBeGreaterThan(0);
  });

  it("the eye panel is a portrait plate with a small dot in the middle of its lens", () => {
    const parts = partsOf("eye-panel");
    const plate = one(parts.filter((p) => p.method === "bevelBox"));
    const b = bounds(local(plate));
    const ratio = (b.hi[2] - b.lo[2]) / (b.hi[0] - b.lo[0]);
    expect(ratio).toBeGreaterThan(2.8);
    expect(ratio).toBeLessThan(3.2);
    const eye = parts.filter((p) => p.flag === blinkFlag(0)).map(local);
    const mids = eye.map(centre);
    for (const m of mids) {
      expect(m[0]).toBeCloseTo(mids[0]?.[0] ?? NaN, 6);
      expect(m[2]).toBeCloseTo(mids[0]?.[2] ?? NaN, 6);
    }
    const front = eye.reduce((f, p) =>
      bounds(p).hi[1] > bounds(f).hi[1] ? p : f,
    );
    const fb = bounds(front);
    expect(fb.hi[0] - fb.lo[0]).toBeLessThan(0.05);
  });

  it("builds the eye panel at the original's true size, its eye at standing eye height (0.25.1)", () => {
    // Mutation caught: the plate, the eye or the lens back at the old,
    // too large size, or the eye off its height.
    const S = EYE_PANEL_SIZE;
    expect(HERO_CATALOGUE["eye-panel"].top).toBe(S.h1);
    const parts = partsOf("eye-panel");
    const plate = bounds(
      local(one(parts.filter((p) => p.method === "bevelBox"))),
    );
    expect(plate.hi[0] - plate.lo[0]).toBeCloseTo(S.width, 9);
    expect(plate.lo[2]).toBeCloseTo(S.h0, 9);
    expect(plate.hi[2]).toBeCloseTo(S.h1, 9);
    const eye = parts.filter((p) => p.flag === blinkFlag(0)).map(local);
    const mid = centre(eye[0] ?? []);
    expect(mid[0]).toBeCloseTo(0, 9);
    expect(mid[2]).toBeCloseTo(S.eyeH, 9);
    const reach = (q: readonly V3[]) =>
      Math.max(...q.map((p) => Math.hypot(p[0] - mid[0], p[2] - mid[2])));
    const widest = Math.max(...eye.map(reach));
    expect(widest).toBeCloseTo(S.r, 9);
    // Every part stays on the plate.
    for (const p of parts) {
      const b = bounds(local(p));
      expect(b.lo[0]).toBeGreaterThanOrEqual(-S.width / 2 - 1e-9);
      expect(b.hi[0]).toBeLessThanOrEqual(S.width / 2 + 1e-9);
      expect(b.lo[2]).toBeGreaterThanOrEqual(S.h0 - 1e-9);
      expect(b.hi[2]).toBeLessThanOrEqual(S.h1 + 1e-9);
    }
  });

  it("the photo console's picture leans back", () => {
    const glows = partsOf("photo-console")
      .filter((p) => p.flag === FLAG.emissive)
      .map(local);
    const picture = glows.reduce((f, p) => {
      const area = (q: V3[]) => {
        const b = bounds(q);
        return (b.hi[0] - b.lo[0]) * (b.hi[2] - b.lo[2]);
      };
      return area(p) > area(f) ? p : f;
    });
    const b = bounds(picture);
    const dAt = (h: number) =>
      Math.max(
        ...picture.filter((q) => Math.abs(q[2] - h) < 0.01).map((q) => q[1]),
      );
    expect(dAt(b.lo[2]) - dAt(b.hi[2])).toBeGreaterThan(0.05);
  });

  it("names the eye panel on its badge, the words split as the original splits them (2.6f C13)", () => {
    // Mutation caught: the badge left blank, both words on the black, or
    // the words below the floor.
    expect(runsOfLines(MARKS.panelName)).toBeGreaterThan(3);
    const parts = partsOf("eye-panel");
    const ink = inked(parts, BADGE_INK, "panel");
    expect(ink).toHaveLength(runsOfLines(MARKS.panelName));
    const badge = parts
      .filter((p) => p.tint?.join() === BADGE_BLUE.join())
      .flatMap(local);
    expect(badge.length).toBeGreaterThan(0);
    for (const p of ink)
      expect(heightOf(p)).toBeGreaterThanOrEqual(0.003 - 1e-9);
    // The last word sits on the blue field.
    const last = MARKS.panelName.at(-1) ?? "";
    const onBlue = ink.filter((p) =>
      local(p).every((q) => q[0] >= Math.min(...badge.map((b) => b[0])) - 1e-6),
    );
    expect(onBlue.length).toBeGreaterThanOrEqual(runsOfLines(last));
  });

  it("sets the first word on the black and the last inside the blue field, one lift proud and the same size (2.6f C17)", () => {
    // Mutation caught: both words on the blue, a word off the badge, the
    // ink sunk into or floating off its field, or the two words at two
    // different sizes.
    const [first = "", last = ""] = MARKS.panelName;
    const parts = partsOf("eye-panel");
    const ink = inked(parts, BADGE_INK, "panel");
    const blue = parts
      .filter((p) => p.tint?.join() === BADGE_BLUE.join())
      .flatMap(local);
    const as = blue.map((q) => q[0]);
    const hs = blue.map((q) => q[2]);
    const [b0, b1] = [Math.min(...as), Math.max(...as)];
    const [c0, c1] = [Math.min(...hs), Math.max(...hs)];
    const inside = (q: V3, a0: number, a1: number, h0: number, h1: number) =>
      q[0] >= a0 - 1e-9 &&
      q[0] <= a1 + 1e-9 &&
      q[2] >= h0 - 1e-9 &&
      q[2] <= h1 + 1e-9;
    const onBlue = ink.filter((p) =>
      local(p).every((q) => inside(q, b0, b1, c0, c1)),
    );
    const onBlack = ink.filter((p) =>
      local(p).every((q) => inside(q, BADGE.a0, b0, BADGE.h0, BADGE.h1)),
    );
    expect(onBlue).toHaveLength(runsOfLines(last));
    expect(onBlack).toHaveLength(runsOfLines(first));
    for (const p of onBlack)
      for (const q of local(p))
        expect(q[1]).toBeCloseTo(BADGE.front + DECAL_LIFT, 9);
    for (const p of onBlue)
      for (const q of local(p))
        expect(q[1]).toBeCloseTo(BADGE.front + BLUE_LIFT + DECAL_LIFT, 9);
    const sizes = ink.map(heightOf);
    for (const h of sizes) expect(h).toBeCloseTo(sizes[0] ?? NaN, 9);
  });

  it("prints the photo console's wordmark in its own dark ink on the lip beside the print slot (2.6f C13)", () => {
    // Mutation caught: the wordmark missing or set from the wrong string,
    // over the slot, off the lip, floating or sunk, or below the floor.
    expect(runsOfLines(MARKS.deskBadge)).toBeGreaterThan(3);
    const ink = inked(partsOf("photo-console"), DESK_BADGE_INK, "panel");
    expect(ink).toHaveLength(runsOfLines(MARKS.deskBadge));
    for (const p of ink) {
      expect(heightOf(p)).toBeGreaterThanOrEqual(0.003 - 1e-9);
      for (const q of local(p)) {
        expect(q[1]).toBeCloseTo(LIP.d + DECAL_LIFT, 9);
        expect(q[2]).toBeGreaterThanOrEqual(LIP.h0 - 1e-9);
        expect(q[2]).toBeLessThanOrEqual(LIP.h1 + 1e-9);
        expect(q[0]).toBeGreaterThanOrEqual(LIP.slot - 1e-9);
        expect(q[0]).toBeLessThanOrEqual(LIP.half + 1e-9);
      }
    }
  });
});
