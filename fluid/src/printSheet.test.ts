/**
 * The print sheet in `index.css`, read back as text: what it hides, what it
 * shows, and that the dark theme stays on screens.
 *
 * Node-context code like `theme/tokens.test.ts`, so it typechecks under
 * `tsconfig.node-test.json` rather than the app's own.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "index.css"), "utf8");

/** The body of the first block that opens with `head`. */
function block(head: string): string {
  const at = css.indexOf(head);
  expect(at).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i += 1) {
    if (css[i] === "{") {
      depth += 1;
    } else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return css.slice(at, i + 1);
      }
    }
  }
  throw new Error(`unclosed block ${head}`);
}

describe("the print sheet", () => {
  it("keeps the chrome off paper", () => {
    const print = block("@media print {\n  /* Every rem");
    for (const chrome of [
      "button,",
      '[role="dialog"],',
      '[role="menu"],',
      "[data-radix-popper-content-wrapper],",
      ".fixed,",
      "[data-loading],",
      "[data-ready-flash]",
    ]) {
      expect(print).toContain(chrome);
    }
    expect(print).toContain("display: none !important;");
  });

  it("shows the print-only blocks on paper", () => {
    expect(block("@layer base {\n  /*\n   * Print-only")).toContain(
      "[hidden][data-print]",
    );
  });

  it("prints light: the dark variant and the dark tokens are screen-only", () => {
    expect(block("@custom-variant dark")).toMatch(
      /@media screen \{\s*&:where\(\[data-theme="dark"\]/,
    );
    const tokens = css.indexOf('  [data-theme="dark"] {\n');
    const screen = css.lastIndexOf("@media screen {", tokens);
    expect(screen).toBeGreaterThan(0);
    expect(css.slice(screen, tokens)).not.toContain("}");
  });

  it("sets the page and the look of its running header and footer", () => {
    const page = block("@page {");
    expect(page).toContain("margin:");
    for (const box of [
      "@top-left",
      "@top-right",
      "@bottom-left",
      "@bottom-right",
    ]) {
      expect(page).toContain(box);
    }
  });

  it("keeps the loading cursor and READY. still under reduced motion", () => {
    const reduced = block(
      "@media (prefers-reduced-motion: reduce) {\n  /* The cursor stays still",
    );
    expect(reduced).toContain(".loading-cursor");
    expect(reduced).toContain(".ready-flash");
    expect(reduced).toContain("animation: none;");
  });
});
