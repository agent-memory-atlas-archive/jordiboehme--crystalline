import { describe, expect, test } from "vitest";

import { mermaidConfig } from "./mermaid";

describe("mermaidConfig", () => {
  test("the look and the layout engine are named, never inherited", () => {
    // mermaid 12 moved both defaults: `neo` draws gradient node strokes on a
    // theme that sets `useGradient` (base does), and ELK re-lays out most
    // diagram types. Every engram already holding a diagram drew under the
    // old pair, so both are pinned here rather than left to whichever
    // version is installed.
    for (const scheme of [false, true]) {
      expect(mermaidConfig(scheme)).toMatchObject({
        look: "classic",
        layout: "dagre",
        theme: "base",
      });
    }
  });

  test("arrowheadColor is named in both schemes, never derived", () => {
    // base derives arrowheadColor by channel-inverting the background;
    // inverting the dark scheme's #0d0f16 lands on a warm cream, which is
    // the user-journey wart this pins shut. A named variable always wins
    // the derivation pass.
    expect(mermaidConfig(false).themeVariables).toMatchObject({
      arrowheadColor: "#475569",
    });
    expect(mermaidConfig(true).themeVariables).toMatchObject({
      arrowheadColor: "#64748b",
    });
  });

  test("labels are SVG text, wide enough not to break an identifier", () => {
    // HTML labels sit in a foreignObject sized from a measurement Safari
    // takes before its page zoom, so under zoom the text overflows its node.
    // SVG text scales with the node it sits in.
    for (const scheme of [false, true]) {
      const config = mermaidConfig(scheme);
      expect(config.htmlLabels).toBe(false);
      expect(config.flowchart?.wrappingWidth).toBe(2000);
    }
  });

  test("git graph and mindmap colours are named, never derived", () => {
    // base derives the git branch labels and the mindmap's section labels
    // and edges as black on the dark canvas, and commitLabelColor as the
    // inversion of its background. Each is named from the app's palette.
    expect(mermaidConfig(true).themeVariables).toMatchObject({
      commitLabelColor: "#e2e8f0",
      commitLabelBackground: "#1e293b",
      gitBranchLabel0: "#f8fafc",
      cScaleLabel0: "#f8fafc",
    });
    expect(mermaidConfig(false).themeVariables).toMatchObject({
      commitLabelColor: "#0f172a",
      commitLabelBackground: "#f1f5f9",
    });
    for (const scheme of [false, true]) {
      const variables = mermaidConfig(scheme).themeVariables as Record<
        string,
        string
      >;
      for (let i = 0; i < 8; i += 1) {
        expect(variables[`git${String(i)}`]).toMatch(/^#[0-9a-f]{6}$/);
        expect(variables[`gitBranchLabel${String(i)}`]).toMatch(
          /^#[0-9a-f]{6}$/,
        );
      }
      for (let i = 0; i < 12; i += 1) {
        expect(variables[`cScale${String(i)}`]).toMatch(/^#[0-9a-f]{6}$/);
        expect(variables[`cScaleLabel${String(i)}`]).toMatch(/^#[0-9a-f]{6}$/);
        expect(variables[`cScaleInv${String(i)}`]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
