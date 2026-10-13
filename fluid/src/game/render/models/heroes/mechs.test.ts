/**
 * The mechs' shape tests: the head's one horn sweeps forward and up over
 * two eyes; the tank's four legs end in wheels on the floor, its lower
 * lens is the largest, each lens carries three pinholes, its tall pod is
 * split by three darker seams, and two three-fingered arms and the
 * snout's gun hang under its head; the garden robot's arms hang almost to
 * the floor and it has one eye.
 */

import { describe, expect, it } from "vitest";

import { FLAG, blinkFlag, type V3 } from "../../geometry";
import { frameAt } from "../../kit";
import { partsOf, toLocal, type Part } from "../../modelChecks";
import { TANK_BEZEL } from "./mechs";

const local = (p: Part): V3[] =>
  p.points.map((q) => toLocal(frameAt([0, 0, 0], 0), q));
const lo = (p: Part) => Math.min(...local(p).map((q) => q[2]));
const hi = (p: Part) => Math.max(...local(p).map((q) => q[2]));
const extent = (pts: V3[], i: 0 | 1 | 2) =>
  Math.max(...pts.map((q) => q[i])) - Math.min(...pts.map((q) => q[i]));

describe("mech hero models", () => {
  it("sweeps the head's single horn forward and up, over two eyes", () => {
    // Mutation caught: the horn swept back, or a second horn.
    const parts = partsOf("mech-head");
    const top = Math.max(...parts.map(hi));
    const horn = parts.filter((p) => hi(p) > top - 0.05);
    expect(horn).toHaveLength(1);
    const pts = local(horn[0] as Part);
    const tip = pts.reduce((m, q) => (q[2] > m[2] ? q : m));
    const root = pts.reduce((m, q) => (q[2] < m[2] ? q : m));
    expect(tip[1]).toBeGreaterThan(root[1] + 0.2);
    expect(
      parts.filter((p) => p.flag === blinkFlag(0) || p.flag === blinkFlag(1)),
    ).toHaveLength(2);
  });

  it("stands the tank on four wheels and makes its lower lens the largest", () => {
    // Mutation caught: a leg off the floor, the lenses the wrong way round,
    // or a recipe that ignores `r` (measured from the built glow discs, not
    // read off the table, so a fixed radius cannot pass).
    const wheels = partsOf("spider-tank").filter(
      (p) => p.method === "extrude" && lo(p) < 1e-4,
    );
    expect(wheels).toHaveLength(4);
    const lenses = partsOf("spider-tank").filter((p) => p.flag >= FLAG.blink);
    expect(lenses).toHaveLength(3);
    const radius = (p: Part) => extent(local(p), 0) / 2;
    const height = (p: Part) => (lo(p) + hi(p)) / 2;
    const lowest = [...lenses].sort((x, y) => height(x) - height(y))[0];
    if (lowest === undefined) throw new Error("no lens");
    for (const l of lenses)
      if (l !== lowest) expect(radius(lowest)).toBeGreaterThan(radius(l));
  });

  it("gives each of the tank's lenses three dark pinholes on its front", () => {
    // Mutation caught: a lens without its pinholes, or pinholes left
    // behind the glow where the lens hides them.
    const parts = partsOf("spider-tank");
    const lenses = parts.filter((p) => p.flag >= FLAG.blink);
    expect(lenses).toHaveLength(3);
    for (const lens of lenses) {
      const l = local(lens);
      const front = Math.max(...l.map((q) => q[1]));
      const within = (q: V3) =>
        q[0] >= Math.min(...l.map((x) => x[0])) - 1e-6 &&
        q[0] <= Math.max(...l.map((x) => x[0])) + 1e-6 &&
        q[2] >= lo(lens) - 1e-6 &&
        q[2] <= hi(lens) + 1e-6;
      // Named by their own colour (the bezel black), then placed by the
      // lens they sit on.
      const pins = parts.filter(
        (p) =>
          p !== lens &&
          p.flag < FLAG.blink &&
          p.tint?.every((c, i) => c === TANK_BEZEL[i]) === true &&
          local(p).every((q) => q[1] >= front - 1e-6 && within(q)),
      );
      expect(pins).toHaveLength(3);
    }
  });

  it("builds the tank's tall pod in panels split by three darker seams", () => {
    // Mutation caught: the pod back to one smooth shell, a seam the same
    // shade as its panels, or a pod squashed wider than it is tall.
    const bands = partsOf("spider-tank")
      .filter((p) => {
        const l = local(p);
        const d =
          (Math.min(...l.map((q) => q[1])) + Math.max(...l.map((q) => q[1]))) /
          2;
        return p.method === "lathe" && d < -0.3 && extent(l, 0) > 1;
      })
      .sort((x, y) => lo(x) - lo(y));
    expect(bands.length).toBeGreaterThanOrEqual(6);
    const bright = (p: Part) =>
      (p.tint ?? [0, 0, 0]).reduce((n, c) => n + c, 0);
    const seams = bands.filter((b, i) => {
      const [below, above] = [bands[i - 1], bands[i + 1]];
      return (
        below !== undefined &&
        above !== undefined &&
        bright(b) < bright(below) &&
        bright(b) < bright(above)
      );
    });
    expect(seams).toHaveLength(3);
    const pts = bands.flatMap(local);
    const tall =
      Math.max(...pts.map((q) => q[2])) - Math.min(...pts.map((q) => q[2]));
    expect(tall).toBeGreaterThan(extent(pts, 0) * 1.0);
  });

  it("hangs two three-fingered arms and the snout's gun under the tank's head", () => {
    // Mutation caught: an arm missing, a hand with two fingers, or the gun
    // back on the roof.
    const parts = partsOf("spider-tank");
    const front = (p: Part) => Math.max(...local(p).map((q) => q[1]));
    const fingers = parts.filter(
      (p) =>
        p.method === "extrude" &&
        front(p) > 1.55 &&
        hi(p) < 0.9 &&
        extent(local(p), 0) < 0.04,
    );
    for (const sign of [-1, 1])
      expect(
        fingers.filter((p) => Math.sign(local(p)[0]?.[0] ?? 0) === sign),
      ).toHaveLength(3);
    const lenses = parts.filter((p) => p.flag >= FLAG.blink);
    const lowestLens = Math.min(...lenses.map(lo));
    const guns = parts.filter(
      (p) =>
        p.method === "cylinderAlong" &&
        hi(p) < lowestLens &&
        front(p) > 1.25 &&
        local(p).every((q) => Math.abs(q[0]) < 0.1),
    );
    expect(guns).toHaveLength(1);
  });

  it("hangs the garden robot's arms almost to the floor and gives it one eye", () => {
    // Mutation caught: short arms (a wrist 0.2 m higher lifts the fingers
    // from 0.1 m to 0.3 m), one arm missing, or a second eye.
    const parts = partsOf("garden-robot");
    const arms = parts.filter((p) => {
      const pts = local(p);
      return Math.min(...pts.map((q) => Math.abs(q[0]))) > 0.62 && lo(p) < 0.2;
    });
    for (const sign of [-1, 1])
      expect(
        arms.filter((p) => Math.sign(local(p)[0]?.[0] ?? 0) === sign).length,
      ).toBeGreaterThan(0);
    expect(parts.filter((p) => p.flag >= FLAG.blink)).toHaveLength(1);
  });
});
