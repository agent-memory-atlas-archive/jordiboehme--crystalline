import { describe, expect, it } from "vitest";

import { keepWithNext, linesOf } from "./keepWithNext";

interface Node {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
  value?: string;
}

const el = (
  tagName: string,
  children: Node[] = [],
  properties: Record<string, unknown> = {},
): Node => ({ type: "element", tagName, properties, children });
const text = (value: string): Node => ({ type: "text", value });

describe("keepWithNext", () => {
  it("wraps a heading with the block after it, line breaks between them included", () => {
    const tree = {
      type: "root",
      children: [
        el("h2", [text("Status")]),
        text("\n"),
        el("p", [text("Short.")]),
        text("\n"),
        el("p", [text("Next.")]),
      ],
    };
    keepWithNext()(tree);
    expect(
      tree.children.map((c) => (c as { tagName?: string }).tagName ?? "text"),
    ).toEqual(["div", "text", "p"]);
    const kept = tree.children[0] as { properties: object; children: object[] };
    expect(kept.properties).toEqual({ "data-keep": "" });
    expect(kept.children).toHaveLength(3);
  });

  it("leaves a heading alone before another heading, a picture or a tall block", () => {
    const rows = Array.from({ length: 30 }, () =>
      el("tr", [el("td", [text("x")])]),
    );
    const tree = {
      type: "root",
      children: [
        el("h2", [text("A")]),
        el("h3", [text("B")]),
        el("p", [el("img", [], { src: "a.png" })]),
        el("h2", [text("C")]),
        el("table", [el("tbody", rows)]),
        el("h2", [text("D")]),
      ],
    };
    keepWithNext()(tree);
    expect(
      tree.children.map((c) => (c as { tagName?: string }).tagName),
    ).toEqual(["h2", "h3", "p", "h2", "table", "h2"]);
  });

  it("counts a diagram taller than its source", () => {
    const code = (lang: string, lines: number) =>
      el("pre", [
        el("code", [text("x\n".repeat(lines))], { className: [lang] }),
      ]);
    expect(linesOf(code("language-mermaid", 8))!).toBeGreaterThan(
      linesOf(code("language-rust", 8))!,
    );
  });

  it("only groups the top level", () => {
    const quote = el("blockquote", [
      el("h2", [text("In")]),
      el("p", [text("x")]),
    ]);
    const tree = { type: "root", children: [quote] };
    keepWithNext()(tree);
    expect(tree.children[0]).toBe(quote);
  });
});

describe("short tables", () => {
  it("marks a table of at most 25 rows short, and no longer one", () => {
    const rows = (n: number) =>
      Array.from({ length: n }, () => el("tr", [el("td", [text("x")])]));
    const small = el("table", [el("tbody", rows(3))]);
    const long = el("table", [el("tbody", rows(40))]);
    keepWithNext()({ type: "root", children: [small, long] });
    expect(small.properties).toHaveProperty("dataShort", "");
    expect(long.properties).not.toHaveProperty("dataShort");
  });
});
