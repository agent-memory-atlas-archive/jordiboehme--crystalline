/**
 * The office curios' own shape tests (0.25.1): what `curioModels.test.ts`'s
 * generic checks do not pin for the floppy disk, the pizza box and the
 * lottery ticket and the 5.25 inch disk. Parts are found by their tint, in
 * the recipe's own local `(a, d, h)` terms. The floppy's label carries its
 * handwriting (v0) or its print on a band (v1), the
 * closed pizza box's lid its print (on the top box of a stack alone), the
 * open box one slice and its lid standing behind, and the ticket its six
 * numbers in order, and the 5.25 inch disk its hub, head window, index
 * hole, notch and printed label.
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
  DISK,
  DISK_GLOBE,
  DISK_HOLE,
  DISK_LABEL,
  DISK_MEDIUM,
  DISK_PRINT,
  DISK_RING,
  DISK_SLEEVE,
  FLOPPY,
  FLOPPY_BAND,
  FLOPPY_INK,
  FLOPPY_LABEL,
  FLOPPY_PRINT,
  FLOPPY_PRINTED,
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

/** The parts whose every point lies in `[a0, a1, d0, d1]` in plan. */
const within = (
  parts: readonly Part[],
  [a0, a1, d0, d1]: readonly [number, number, number, number],
) =>
  parts.filter((p) =>
    p.points.every(
      (q) =>
        q[0] >= a0 - 1e-9 &&
        q[0] <= a1 + 1e-9 &&
        q[1] >= d0 - 1e-9 &&
        q[1] <= d1 + 1e-9,
    ),
  );

/** A round part's centre and radius in plan, from its points' extent. */
const disc = (p: Part) => {
  const as = p.points.map((q) => q[0]);
  const ds = p.points.map((q) => q[1]);
  return {
    a: (Math.min(...as) + Math.max(...as)) / 2,
    d: (Math.min(...ds) + Math.max(...ds)) / 2,
    r: (Math.max(...ds) - Math.min(...ds)) / 2,
    top: Math.max(...p.points.map((q) => q[2])),
  };
};

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

  it("prints the floppy's second label on a yellow band, the version line under it (v1)", () => {
    // Mutation caught: the band at the label's front, the name off the
    // band, the two lines swapped or mirrored, the handwriting left on,
    // or the print under the 1 mm floor. v0 keeps its handwriting alone.
    const v0 = partsOf("floppy-disk", 0);
    expect(tinted(v0, FLOPPY_BAND)).toHaveLength(0);
    expect(tinted(v0, FLOPPY_PRINT)).toHaveLength(0);
    const parts = partsOf("floppy-disk", 1);
    expect(tinted(parts, FLOPPY_INK)).toHaveLength(0);
    const l = FLOPPY.label;
    const p = FLOPPY_PRINTED;
    const band = tinted(parts, FLOPPY_BAND);
    expect(band).toHaveLength(1);
    expect(within(band, [l.a0, l.a1, l.d0, p.band])).toHaveLength(1);
    const white = tinted(parts, FLOPPY_LABEL);
    expect(white).toHaveLength(1);
    expect(within(white, [l.a0, l.a1, p.band, l.d1])).toHaveLength(1);
    const print = tinted(parts, FLOPPY_PRINT);
    const name = within(print, [l.a0, l.a1, l.d0, p.band]);
    const version = within(print, [l.a0, l.a1, p.band, l.d1]);
    expect(name.length + version.length).toBe(print.length);
    for (const [line, text] of [
      [name, MARKS.floppyPrinted],
      [version, MARKS.floppyVersion],
    ] as const) {
      expect(line.length, text).toBeGreaterThan(0);
      const { rows, px } = cellsOf(line, (q) => [q[0], q[1]]);
      expect(rows, text).toEqual(trimmed(textRows(text)));
      expect(px, text).toBeGreaterThanOrEqual(0.001 - 1e-9);
    }
    const hs = pointsOf(print).map((q) => q[2]);
    expect(Math.min(...hs)).toBeCloseTo(FLOPPY.labelTop, 9);
    expect(Math.max(...hs)).toBeCloseTo(curioHalf("floppy-disk", 1).top, 9);
  });

  it("builds the 5.25 inch disk's hub, head window, index hole and notch", () => {
    // Mutation caught: the notch filled, the ring or the hole missing or
    // buried under the medium, the head window behind the hub or off its
    // line, the index hole on the hub.
    const parts = partsOf("disk-525");
    const { hw, hd } = curioHalf("disk-525", 0);
    const n = DISK.notch;
    // Every sleeve piece's plan box stays out of the notch: a box's
    // corners alone could straddle it.
    const sleeve = tinted(parts, DISK_SLEEVE);
    expect(Math.max(...pointsOf(sleeve).map((q) => q[0]))).toBeCloseTo(hw, 9);
    for (const p of sleeve) {
      const as = p.points.map((q) => q[0]);
      const ds = p.points.map((q) => q[1]);
      const overlaps =
        Math.max(...as) > hw - n.reach + 1e-9 &&
        Math.max(...ds) > n.d0 + 1e-9 &&
        Math.min(...ds) < n.d1 - 1e-9;
      expect(overlaps).toBe(false);
    }
    // The notch is cut on the right edge, near the label.
    expect(n.d0).toBeGreaterThan(DISK.label.d1 - 0.01);
    expect(n.d1).toBeLessThan(0);
    // The hub: the hole inside the ring inside the medium's opening, each
    // centred and each prouder than the one under it.
    const [hole] = tinted(parts, DISK_HOLE).map(disc);
    const [ring] = tinted(parts, DISK_RING).map(disc);
    const opening = tinted(parts, DISK_MEDIUM)
      .map(disc)
      .find((x) => Math.hypot(x.a, x.d) < 1e-9);
    if (!hole || !ring || !opening) throw new Error("no hub");
    expect(tinted(parts, DISK_HOLE)).toHaveLength(1);
    expect(tinted(parts, DISK_RING)).toHaveLength(1);
    for (const x of [hole, ring])
      expect(Math.hypot(x.a, x.d)).toBeLessThan(1e-9);
    expect(hole.r).toBeLessThan(ring.r);
    expect(ring.r).toBeLessThan(opening.r);
    expect(hole.top).toBeGreaterThan(ring.top);
    expect(ring.top).toBeGreaterThan(opening.top);
    // The head window: in front of the hub (`+d`), on its centre line,
    // longer than it is wide.
    const w = DISK.window;
    const window = within(tinted(parts, DISK_MEDIUM), [
      -w.half,
      w.half,
      w.d0,
      w.d1,
    ]);
    expect(window).toHaveLength(3);
    const wp = pointsOf(window);
    expect(Math.min(...wp.map((q) => q[1]))).toBeCloseTo(w.d0, 9);
    expect(Math.max(...wp.map((q) => q[1]))).toBeCloseTo(w.d1, 9);
    expect(w.d0).toBeGreaterThan(opening.r);
    expect(w.d1 - w.d0).toBeGreaterThan(4 * w.half);
    // The index hole beside the hub, clear of its opening.
    const index = tinted(parts, DISK_MEDIUM)
      .map(disc)
      .filter((x) => Math.abs(x.a - DISK.index.a) < 1e-9);
    expect(index).toHaveLength(1);
    const [ix] = index;
    if (!ix) throw new Error("no index hole");
    expect(Math.hypot(ix.a, ix.d) - ix.r).toBeGreaterThan(opening.r);
    expect(ix.r).toBeCloseTo(DISK.index.r, 9);
    // Everything inside the disk.
    for (const q of pointsOf(parts)) {
      expect(Math.abs(q[0])).toBeLessThanOrEqual(hw + 1e-9);
      expect(Math.abs(q[1])).toBeLessThanOrEqual(hd + 1e-9);
    }
  });

  it("prints the 5.25 inch disk's label in red across its back edge, reading from the front", () => {
    // Mutation caught: the label at the front edge, the print mirrored,
    // off the label or under the 1 mm floor, the grey disc missing.
    const parts = partsOf("disk-525");
    const { hd, top } = curioHalf("disk-525", 0);
    const l = DISK.label;
    expect(l.d0).toBeLessThan(-hd + 0.005);
    const label = tinted(parts, DISK_LABEL);
    expect(label).toHaveLength(1);
    expect(within(label, [l.a0, l.a1, l.d0, l.d1])).toHaveLength(1);
    const print = tinted(parts, DISK_PRINT);
    expect(print.length).toBeGreaterThan(0);
    expect(within(print, [l.a0, l.a1, l.d0, l.d1])).toHaveLength(print.length);
    const { rows, px } = cellsOf(print, (q) => [q[0], q[1]]);
    expect(rows).toEqual(trimmed(textRows(MARKS.diskLabel)));
    expect(px).toBeGreaterThanOrEqual(0.001 - 1e-9);
    const hs = pointsOf(print).map((q) => q[2]);
    expect(Math.min(...hs)).toBeCloseTo(DISK.labelTop, 9);
    expect(Math.max(...hs)).toBeCloseTo(top, 9);
    const globe = tinted(parts, DISK_GLOBE);
    expect(globe).toHaveLength(1);
    expect(within(globe, [l.a0, l.a1, l.d0, l.d1])).toHaveLength(1);
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

  it("keeps the floppy under 800 triangles (its second label under 1350), the ticket under 650, every pizza box under 900 and the 5.25 inch disk under 800", () => {
    // Every print is thin boxes on a face that looks up (12 triangles a
    // piece), which no budget under the label's own 56 pieces could hold.
    // Mutation caught: a print laid run by run instead of merged.
    expect(triangles("floppy-disk")).toBeLessThan(800);
    expect(triangles("floppy-disk", 1)).toBeLessThan(1350);
    expect(triangles("disk-525")).toBeLessThan(800);
    expect(triangles("lottery-ticket")).toBeLessThan(650);
    for (let v = 0; v < 4; v++)
      expect(triangles("pizza-box", v), `v${String(v)}`).toBeLessThan(900);
  });
});
