/**
 * The tool maker's mark (0.25.1): every tool-like model wears it. The tool
 * board, the tool cart (both variants), the workbench machine (every
 * variant) and the gun bench's pegboard each carry the parts painted in
 * `TOOL_MARK.ink`, and those parts rebuild exactly the font's cells of
 * `MARKS.toolMark`, read from the front.
 */

import { describe, expect, it } from "vitest";

import { VARIANT_COUNTS } from "../world/variants";
import type { Fixture } from "../world/types";
import { PROP_CATALOGUE } from "../world/props";
import { createBuilder } from "./geometry";
import { frameAt, frameForSlot, type Frame } from "./kit";
import { LOOK } from "./looks";
import {
  cellsOf,
  inked,
  recordingKitAt,
  toLocal,
  type Part,
} from "./modelChecks";
import { buildHero } from "./models/heroes";
import { buildMachine } from "./models/machines";
import { MARKS, TOOL_MARK } from "./models/marks";
import { textRows } from "./models/heroes/pixels";
import { buildProp } from "./models/props";

/** The mark's cells and pixel size from the ink parts, in a frame's local terms. */
function markOf(parts: Part[], f: Frame) {
  const ink = inked(parts, TOOL_MARK.ink);
  expect(ink.length).toBeGreaterThan(0);
  return cellsOf(ink, (p) => {
    const q = toLocal(f, p);
    return [q[0], -q[2]];
  });
}

describe("the tool maker's mark (0.25.1 D-R11)", () => {
  it("carries the tool maker's mark on every tool-like prop", () => {
    // Mutation caught: a tool prop left unmarked, the mark mirrored.
    const origin = frameAt([0, 0, 0], 0);
    for (const kind of ["tool-board", "tool-cart"] as const)
      for (let v = 0; v < PROP_CATALOGUE[kind].variants; v++) {
        const parts: Part[] = [];
        buildProp(recordingKitAt(createBuilder(), parts), kind, v, {
          look: LOOK,
        });
        const { rows, px } = markOf(parts, origin);
        expect(rows, `${kind} ${String(v)}`).toEqual(textRows(MARKS.toolMark));
        expect(px, kind).toBeGreaterThanOrEqual(0.003);
      }
  });

  it("carries the mark on every workbench machine variant", () => {
    // Mutation caught: a variant without its plate, the mark mirrored.
    const slot = { x: 3, y: 4, side: "n" } as const;
    const f = frameForSlot(slot);
    for (let v = 0; v < VARIANT_COUNTS.machine.workbench; v++) {
      const fx: Extract<Fixture, { kind: "machine" }> = {
        kind: "machine",
        slot,
        machine: "workbench",
        tag: "t",
        hue: 140,
        seed: 5,
        variant: v,
      };
      const parts: Part[] = [];
      buildMachine(recordingKitAt(createBuilder(), parts), fx, 0, {
        look: LOOK,
        ceiling: 3,
        hall: { x0: 2, y0: 0, x1: 7, y1: 6 },
        textLayer: () => ({ layer: 0, v0: 0, v1: 1 }),
      });
      const { rows, px } = markOf(parts, f);
      expect(rows, `variant ${String(v)}`).toEqual(textRows(MARKS.toolMark));
      expect(px).toBeGreaterThanOrEqual(0.003);
    }
  });

  it("carries the mark on the gun bench's pegboard, clear of the tool silhouettes", () => {
    // Mutation caught: the pegboard left unmarked, a pixel under 1 mm.
    const parts: Part[] = [];
    buildHero(recordingKitAt(createBuilder(), parts), "gun-bench", 0, LOOK);
    const { rows, px } = markOf(parts, frameAt([0, 0, 0], 0));
    expect(rows).toEqual(textRows(MARKS.toolMark));
    expect(px).toBeGreaterThanOrEqual(0.001);
  });
});
