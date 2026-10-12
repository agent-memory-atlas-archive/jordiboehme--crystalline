/**
 * The office curios' own shape tests (0.25.1): what `curioModels.test.ts`'s
 * generic checks do not pin for the floppy disk, the pizza box and the
 * lottery ticket. Parts are found by their tint, in the recipe's own local
 * `(a, d, h)` terms. The floppy's label carries its handwriting, the
 * closed pizza box's lid its print (on the top box of a stack alone), the
 * open box one slice and its lid standing behind, and the ticket its six
 * numbers in order.
 */

import { describe, expect, it } from "vitest";

import type { CurioKind } from "../../../world/types";
import { createBuilder, type V3 } from "../../geometry";
import { frameAt, type Frame } from "../../kit";
import { LOOK, type Rgb } from "../../looks";
import {
  cellsOf,
  inked,
  recordingKitAt,
  toLocal,
  trimmed,
  type Part,
} from "../../modelChecks";
import { yawed } from "../common";
import { MARK_PROUD, textRows } from "../heroes/pixels";
import { MARKS } from "../marks";
import { curioHalf } from "./common";
import { buildCurio, buildCurioMesh } from "./index";
import {
  FLOPPY,
  FLOPPY_INK,
  FLOPPY_LABEL,
  OPEN_BOX,
  PIZZA,
  PIZZA_LID,
  PIZZA_PRINT,
  PIZZA_SLICE,
  STACK_TURNS,
  TICKET_INK,
  TICKET_SLOTS,
} from "./office";

const ORIGIN: Frame = frameAt([0, 0, 0], 0);

/** A curio's recorded parts, built once at the origin, in local `(a, d, h)`. */
function partsOf(kind: CurioKind, variant = 0, f: Frame = ORIGIN): Part[] {
  const parts: Part[] = [];
  buildCurio(recordingKitAt(createBuilder(), parts), kind, variant, LOOK);
  return parts.map((p) => ({
    ...p,
    points: p.points.map((q) => toLocal(f, q)),
  }));
}

/** Every point of some parts. */
const pointsOf = (parts: readonly Part[]): V3[] =>
  parts.flatMap((p) => p.points);

/** The parts tinted exactly `c`. */
const tinted = (parts: readonly Part[], c: Rgb) => inked(parts, c);

/** Triangles of a kind and variant. */
const triangles = (kind: CurioKind, variant = 0) =>
  buildCurioMesh(kind, variant, LOOK).count / 3;

describe("the office models", () => {
  it("writes the floppy's label in blue on the label, reading from the front", () => {
    // Mutation caught: the label mirrored or turned about, the writing
    // off the label or floating over it, or under the 1 mm floor.
    const parts = partsOf("floppy-disk");
    const ink = tinted(parts, FLOPPY_INK);
    expect(ink.length).toBeGreaterThan(0);
    const { rows, px } = cellsOf(ink, (q) => [q[0], q[1]]);
    expect(rows).toEqual(trimmed(textRows(MARKS.floppyLabel)));
    expect(px).toBeGreaterThanOrEqual(0.001 - 1e-9);
    const l = FLOPPY.label;
    for (const q of pointsOf(ink)) {
      expect(q[0]).toBeGreaterThanOrEqual(l.a0 - 1e-9);
      expect(q[0]).toBeLessThanOrEqual(l.a1 + 1e-9);
      expect(q[1]).toBeGreaterThanOrEqual(l.d0 - 1e-9);
      expect(q[1]).toBeLessThanOrEqual(l.d1 + 1e-9);
    }
    const hs = pointsOf(ink).map((q) => q[2]);
    expect(Math.min(...hs)).toBeCloseTo(FLOPPY.labelTop, 9);
    expect(Math.max(...hs)).toBeCloseTo(curioHalf("floppy-disk", 0).top, 9);
    // The label is white and lies in front of the shutter's back quarter.
    expect(tinted(parts, FLOPPY_LABEL)).toHaveLength(1);
  });

  it("prints the pizza box's lid on the top box only, reading from the front", () => {
    // Mutation caught: the print on a lower, hidden lid, on every lid of
    // a stack, mirrored, or not turned with its box.
    for (let v = 0; v < 3; v++) {
      const top = v + 1;
      const turn = STACK_TURNS[v] ?? 0;
      const parts = partsOf("pizza-box", v, yawed(ORIGIN, 0, 0, turn));
      const ink = tinted(parts, PIZZA_PRINT);
      expect(ink.length, `v${String(v)}`).toBeGreaterThan(0);
      const { rows } = cellsOf(ink, (q) => [q[0], q[1]]);
      expect(rows, `v${String(v)}`).toEqual(trimmed(textRows(MARKS.pizzaLid)));
      const hs = pointsOf(ink).map((q) => q[2]);
      expect(Math.min(...hs)).toBeCloseTo(top * PIZZA.height - MARK_PROUD, 9);
      expect(Math.max(...hs)).toBeCloseTo(top * PIZZA.height, 9);
      // One lid per box.
      expect(tinted(parts, PIZZA_LID), `v${String(v)}`).toHaveLength(top);
    }
  });

  it("opens v3 with one slice in the tray and its lid standing behind, unprinted", () => {
    // Mutation caught: two slices or none, the lid lying flat or in front
    // of the tray, the print on the open lid.
    const parts = partsOf("pizza-box", 3);
    expect(tinted(parts, PIZZA_SLICE)).toHaveLength(1);
    expect(tinted(parts, PIZZA_PRINT)).toHaveLength(0);
    const lid = pointsOf(tinted(parts, PIZZA_LID));
    expect(Math.max(...lid.map((q) => q[2]))).toBeCloseTo(
      curioHalf("pizza-box", 3).top,
      9,
    );
    expect(Math.max(...lid.map((q) => q[1]))).toBeLessThanOrEqual(
      OPEN_BOX.trayBack + 1e-9,
    );
    const slice = pointsOf(tinted(parts, PIZZA_SLICE));
    expect(Math.min(...slice.map((q) => q[1]))).toBeGreaterThan(
      OPEN_BOX.trayBack,
    );
    expect(Math.max(...slice.map((q) => q[2]))).toBeLessThan(OPEN_BOX.trayTop);
  });

  it("sets the ticket's six numbers in two rows of three, in order", () => {
    // Mutation caught: the numbers out of order, a row reversed, a number
    // mirrored, the rows swapped, a number set at its own pixel.
    const parts = partsOf("lottery-ticket");
    const ink = tinted(parts, TICKET_INK);
    expect(TICKET_SLOTS).toHaveLength(MARKS.numbers.length);
    const sizes = new Set<number>();
    MARKS.numbers.forEach((n, i) => {
      const slot = TICKET_SLOTS[i];
      if (slot === undefined) throw new Error("no slot");
      const [a0, a1, d0, d1] = slot;
      const mine = ink.filter((p) =>
        p.points.every(
          (q) =>
            q[0] >= a0 - 1e-9 &&
            q[0] <= a1 + 1e-9 &&
            q[1] >= d0 - 1e-9 &&
            q[1] <= d1 + 1e-9,
        ),
      );
      expect(mine.length, n).toBeGreaterThan(0);
      const { rows, px } = cellsOf(mine, (q) => [q[0], q[1]]);
      expect(rows, n).toEqual(trimmed(textRows(n)));
      sizes.add(Math.round(px * 1e6));
    });
    expect(sizes.size).toBe(1);
    // Every ink part is in one slot or another.
    const inSlots = TICKET_SLOTS.map(
      ([a0, a1, d0, d1]) =>
        ink.filter((p) =>
          p.points.every(
            (q) =>
              q[0] >= a0 - 1e-9 &&
              q[0] <= a1 + 1e-9 &&
              q[1] >= d0 - 1e-9 &&
              q[1] <= d1 + 1e-9,
          ),
        ).length,
    ).reduce((x, y) => x + y, 0);
    expect(inSlots).toBe(ink.length);
    // Left to right in each row, the first row nearer the band (`-d`).
    const mid = (i: number) => {
      const s = TICKET_SLOTS[i];
      if (s === undefined) throw new Error("no slot");
      return { a: (s[0] + s[1]) / 2, d: (s[2] + s[3]) / 2 };
    };
    for (const row of [0, 3]) {
      expect(mid(row).a).toBeLessThan(mid(row + 1).a);
      expect(mid(row + 1).a).toBeLessThan(mid(row + 2).a);
      expect(mid(row).d).toBe(mid(row + 2).d);
    }
    expect(mid(0).d).toBeLessThan(mid(3).d);
  });

  it("keeps the floppy under 800 triangles, the ticket under 650 and every pizza box under 900", () => {
    // Every print is thin boxes on a face that looks up (12 triangles a
    // piece), which no budget under the label's own 56 pieces could hold.
    // Mutation caught: a print laid run by run instead of merged.
    expect(triangles("floppy-disk")).toBeLessThan(800);
    expect(triangles("lottery-ticket")).toBeLessThan(650);
    for (let v = 0; v < 4; v++)
      expect(triangles("pizza-box", v), `v${String(v)}`).toBeLessThan(900);
  });
});
