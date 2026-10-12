import { describe, expect, it } from "vitest";

import { seedFor } from "../core/seed";
import { HANDLE_EVERY, handleOf } from "./handles";
import { MARKS } from "./models/marks";

describe("terminal handles", () => {
  it("shows a handle on about 1 terminal in 24, the same terminal always the same (D-R10)", () => {
    // Mutation caught: a rate far off, a pick that moves between calls.
    const terminals = Array.from({ length: 6000 }, (_, i) => ({
      kind: "terminal" as const,
      slot: { x: 0, y: 0, side: "n" as const },
      heading: "H",
      lines: [],
      section: 0,
      seed: seedFor("terminal", i),
    }));
    expect(terminals.length).toBeGreaterThan(0);
    expect(HANDLE_EVERY).toBe(24);
    const shown = terminals.map(handleOf);
    const rate = shown.filter((h) => h !== null).length / terminals.length;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.055);
    for (const [i, t] of terminals.entries())
      expect(handleOf(t)).toBe(shown[i]);
    for (const h of shown)
      if (h !== null) expect(MARKS.handleLines).toContain(h);
    expect(new Set(shown.filter((h) => h !== null)).size).toBe(4);
  });

  it("shows no handle on a fixture that is not a terminal", () => {
    // Mutation caught: a handle on a poster or a door.
    expect(
      handleOf({
        kind: "placard",
        slot: { x: 0, y: 0, side: "n" },
        lines: [],
      }),
    ).toBeNull();
  });
});
