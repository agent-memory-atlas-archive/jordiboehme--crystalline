/**
 * The figure and radio curios' own shape tests (0.25.1): what
 * `curioModels.test.ts`'s generic checks do not pin for the penguin
 * figurine and the radio set. Parts are found by their tint or their blink
 * group, in the recipe's own local `(a, d, h)` terms. The penguin faces
 * `+d` with its white belly, its beak and its feet in front and carries no
 * text (`textCalls.test.ts` holds that its build calls no text helper);
 * the radio's front carries the big knob, the meter and the lit window,
 * and its note (v0) or its sheet (v1) carries the hand-written words,
 * reading from the front.
 */

import { describe, expect, it } from "vitest";

import type { CurioKind } from "../../../world/types";
import { blinkFlag, createBuilder, FLAG, type V3 } from "../../geometry";
import { frameAt } from "../../kit";
import { LOOK, type Rgb } from "../../looks";
import {
  cellsOf,
  inked,
  recordingKitAt,
  toLocal,
  trimmed,
  type Part,
} from "../../modelChecks";
import { textRows } from "../heroes/pixels";
import { MARKS } from "../marks";
import { CURIO_BANK, curioHalf } from "./common";
import {
  KNOB_SILVER,
  NOTE_PEN,
  NOTE_YELLOW,
  PENGUIN,
  PENGUIN_BEAK,
  PENGUIN_BLACK,
  PENGUIN_FEET,
  PENGUIN_WHITE,
  RADIO,
  SHEET_PAPER,
} from "./figures";
import { buildCurio, buildCurioMesh } from "./index";

/** A curio's recorded parts, built once at the origin, in local `(a, d, h)`. */
function partsOf(kind: CurioKind, variant = 0): Part[] {
  const parts: Part[] = [];
  buildCurio(recordingKitAt(createBuilder(), parts), kind, variant, LOOK);
  const origin = frameAt([0, 0, 0], 0);
  return parts.map((p) => ({
    ...p,
    points: p.points.map((q) => toLocal(origin, q)),
  }));
}

/** Every point of some parts. */
const pointsOf = (parts: readonly Part[]): V3[] =>
  parts.flatMap((p) => p.points);

/** The parts tinted exactly `c`. */
const tinted = (parts: readonly Part[], c: Rgb) => inked(parts, c);

/** The extent of some parts along local axis `i`. */
const extent = (parts: readonly Part[], i: 0 | 1 | 2) => {
  const v = pointsOf(parts).map((q) => q[i]);
  return { lo: Math.min(...v), hi: Math.max(...v) };
};

/** Triangles of a kind and variant. */
const triangles = (kind: CurioKind, variant = 0) =>
  buildCurioMesh(kind, variant, LOOK).count / 3;

describe("the penguin figurine", () => {
  const parts = partsOf("penguin-figure");

  it("is black, white and yellow-orange, steady, and nothing glows", () => {
    // Mutation caught: a colour part dropped, or a light added.
    for (const c of [PENGUIN_BLACK, PENGUIN_WHITE, PENGUIN_BEAK, PENGUIN_FEET])
      expect(tinted(parts, c).length, String(c)).toBeGreaterThan(0);
    expect(CURIO_BANK["penguin-figure"]).toBe("steady");
    expect(parts.some((p) => p.flag >= FLAG.blink)).toBe(false);
  });

  it("faces +d: the belly shows in front of the body, the beak and the feet stand out in front", () => {
    // Mutation caught: the penguin built facing the wall (`-d`), the belly
    // buried in the body, or the beak at the back of the head.
    const lathes = (c: Rgb) =>
      tinted(parts, c).filter((p) => p.method === "lathe");
    const [body, head] = lathes(PENGUIN_BLACK);
    const [belly] = lathes(PENGUIN_WHITE);
    if (body === undefined || head === undefined || belly === undefined)
      throw new Error("no body, head or belly");
    expect(lathes(PENGUIN_WHITE)).toHaveLength(1);
    const front = (p: Part) => extent([p], 1).hi;
    const back = (p: Part) => extent([p], 1).lo;
    expect(front(belly)).toBeGreaterThan(front(body) + 0.002);
    expect(back(belly)).toBeGreaterThan(back(body) + 0.01);
    // The belly is about half the figure's width, under the head.
    const bw = extent([belly], 0);
    const { hw } = curioHalf("penguin-figure", 0);
    expect((bw.hi - bw.lo) / (2 * hw)).toBeGreaterThan(0.45);
    expect((bw.hi - bw.lo) / (2 * hw)).toBeLessThan(0.6);
    // It reaches up under the beak to the chin, as in the drawing.
    expect(extent([belly], 2).hi).toBeGreaterThan(extent([head], 2).lo);
    expect(extent([belly], 2).hi).toBeLessThan(PENGUIN.beak.h1);
    // The beak in front of the head, between the eyes and the belly.
    const beak = extent(tinted(parts, PENGUIN_BEAK), 1);
    expect(beak.lo).toBeGreaterThan(0);
    expect(beak.hi).toBeGreaterThan(front(head));
    // The feet in front of the body's middle, on the desk.
    const feet = tinted(parts, PENGUIN_FEET);
    expect(feet).toHaveLength(2);
    expect(extent(feet, 1).hi).toBeGreaterThan(front(body));
    expect(extent(feet, 2).lo).toBeCloseTo(0, 9);
    // The eyes' whites are boxes on the head's front, above the beak.
    const eyes = tinted(parts, PENGUIN_WHITE).filter((p) => p.method === "box");
    expect(eyes).toHaveLength(2);
    expect(extent(eyes, 2).lo).toBeGreaterThan(
      extent(tinted(parts, PENGUIN_BEAK), 2).hi,
    );
  });

  it("half closes each eye under a black lid", () => {
    // Mutation caught: the lids dropped, so the eyes stare wide open.
    const e = PENGUIN.eye;
    const lids = tinted(parts, PENGUIN_BLACK).filter(
      (p) =>
        p.method === "box" && Math.abs(extent([p], 2).lo - PENGUIN.lid) < 1e-9,
    );
    expect(lids).toHaveLength(2);
    for (const lid of lids) {
      expect(extent([lid], 1).hi).toBeGreaterThan(e.d1);
      expect(extent([lid], 2).hi).toBeGreaterThanOrEqual(e.h1);
    }
    expect((PENGUIN.lid - e.h0) / (e.h1 - e.h0)).toBeCloseTo(0.5, 9);
  });

  it("keeps the penguin under 900 triangles", () => {
    // Mutation caught: the lathes made rounder than the budget allows.
    expect(triangles("penguin-figure")).toBeLessThan(900);
  });
});

describe("the radio set", () => {
  it("carries a big knob, a meter and a lit window on its front, breathing", () => {
    // Mutation caught: the window or the meter steady or off the front,
    // the knob on the back, or the bank changed.
    expect(CURIO_BANK["radio-set"]).toBe("breathe");
    for (const v of [0, 1]) {
      const parts = partsOf("radio-set", v);
      const window = parts.filter((p) => p.flag === blinkFlag(0));
      const meter = parts.filter((p) => p.flag === blinkFlag(1));
      expect(window, `v${String(v)}`).toHaveLength(RADIO.digits);
      expect(meter, `v${String(v)}`).toHaveLength(1);
      for (const p of [...window, ...meter])
        expect(extent([p], 1).hi).toBeGreaterThan(RADIO.face);
      // The meter at the top left, the window beside it.
      expect(extent(meter, 0).hi).toBeLessThan(extent(window, 0).lo);
      // The big knob: the widest silver disc, standing out of the front.
      const knobs = tinted(parts, KNOB_SILVER).filter(
        (p) => p.method === "extrude",
      );
      const widths = knobs.map((p) => extent([p], 0).hi - extent([p], 0).lo);
      const big = Math.max(...widths);
      expect(big).toBeCloseTo(2 * RADIO.knob.r, 3);
      expect(widths.filter((w) => w > big / 2)).toHaveLength(1);
      const knob = knobs[widths.indexOf(big)];
      if (knob === undefined) throw new Error("no knob");
      expect(extent([knob], 1).hi).toBeGreaterThan(RADIO.face + 0.005);
    }
  });

  it("writes the note on the set's front, reading from the front (v0)", () => {
    // Mutation caught: the note mirrored, turned to the back, off the
    // note or under the 1 mm floor.
    const parts = partsOf("radio-set", 0);
    const note = tinted(parts, NOTE_YELLOW);
    expect(note).toHaveLength(1);
    const pen = tinted(parts, NOTE_PEN);
    expect(pen.length).toBeGreaterThan(0);
    const { rows, px } = cellsOf(pen, (q) => [q[0], -q[2]]);
    expect(rows).toEqual(trimmed(textRows(MARKS.radioNote)));
    expect(px).toBeGreaterThanOrEqual(0.001 - 1e-9);
    const n = extent(note, 0);
    const nh = extent(note, 2);
    for (const q of pointsOf(pen)) {
      expect(q[0]).toBeGreaterThanOrEqual(n.lo);
      expect(q[0]).toBeLessThanOrEqual(n.hi);
      expect(q[2]).toBeGreaterThanOrEqual(nh.lo);
      expect(q[2]).toBeLessThanOrEqual(nh.hi);
      expect(q[1]).toBeGreaterThan(extent(note, 1).hi);
    }
    // The note is a 76 mm square stuck on the panel, over the case's top.
    expect(n.hi - n.lo).toBeCloseTo(0.076, 9);
    expect(nh.hi - nh.lo).toBeCloseTo(0.076, 9);
    expect(nh.lo).toBeLessThan(RADIO.case.h1);
    expect(nh.hi).toBeGreaterThan(RADIO.case.h1);
    expect(tinted(parts, SHEET_PAPER)).toHaveLength(0);
  });

  it("writes the words on an A5 sheet beside the set, reading from the front (v1)", () => {
    // Mutation caught: the writing mirrored, on the set, the sheet under
    // the set, or the note left on.
    const parts = partsOf("radio-set", 1);
    expect(tinted(parts, NOTE_YELLOW)).toHaveLength(0);
    const sheet = tinted(parts, SHEET_PAPER);
    expect(sheet).toHaveLength(1);
    const sa = extent(sheet, 0);
    const sd = extent(sheet, 1);
    expect(sa.hi - sa.lo).toBeCloseTo(0.148, 9);
    expect(sd.hi - sd.lo).toBeCloseTo(0.21, 9);
    // Everything standing taller than the sheet is the set or its
    // microphone, all to the sheet's left.
    const tall = pointsOf(parts).filter((q) => q[2] > 0.002);
    expect(sa.lo).toBeGreaterThan(Math.max(...tall.map((q) => q[0])));
    const pen = tinted(parts, NOTE_PEN);
    const { rows, px } = cellsOf(pen, (q) => [q[0], q[1]]);
    expect(rows).toEqual(trimmed(textRows(MARKS.radioNote)));
    expect(px).toBeGreaterThanOrEqual(0.001 - 1e-9);
    for (const q of pointsOf(pen)) {
      expect(q[0]).toBeGreaterThanOrEqual(sa.lo);
      expect(q[0]).toBeLessThanOrEqual(sa.hi);
      expect(q[2]).toBeGreaterThanOrEqual(extent(sheet, 2).hi - 1e-9);
    }
  });

  it("keeps the radio set under 1100 triangles with its note and 1350 with its sheet", () => {
    // Mutation caught: the sheet's writing laid run by run, or the knobs
    // made rounder than the budget allows.
    expect(triangles("radio-set", 0)).toBeLessThan(1100);
    expect(triangles("radio-set", 1)).toBeLessThan(1350);
  });
});
