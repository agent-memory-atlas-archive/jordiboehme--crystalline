import { afterEach, describe, expect, it } from "vitest";

import {
  ACTIVE_HIGHLIGHT,
  QUOTE_HIGHLIGHT,
  displayQuote,
  domRange,
  paintQuotes,
  selectionAnchor,
  sourceOffset,
  spanBase,
  spanPieces,
} from "./reflectionQuotes";
import type { SectionText } from "./reflectionText";

/**
 * The DOM `MarkdownBody` renders with `sourceSpans` for the section text
 * `## Night deploys\n\nDeploys run **at** night.` - built by hand so these
 * tests pin the helpers, not the renderer (Markdown.test.tsx pins that).
 */
const TEXT = "## Night deploys\n\nDeploys run **at** night.";
function section(): HTMLElement {
  const el = document.createElement("section");
  el.setAttribute("data-section", "7f3a9c2e");
  el.innerHTML =
    '<h2><span data-src="3">Night deploys</span></h2>' +
    '<p><span data-src="18">Deploys run </span><strong><span data-src="32">at</span></strong><span data-src="36"> night.</span></p>';
  document.body.append(el);
  return el;
}
const SECTIONS: SectionText[] = [
  { id: "_top", heading: "", text: "" },
  { id: "7f3a9c2e", heading: "Night deploys", text: TEXT },
];

afterEach(() => {
  document.body.innerHTML = "";
});

function textIn(el: Element, text: string): Text {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent === text) {
      return node as Text;
    }
  }
  throw new Error(`no text node "${text}"`);
}

describe("spanBase", () => {
  it("maps a text node to its offset, and refuses one it cannot place", () => {
    expect(spanBase(TEXT, 18, 30, "Deploys run ")).toBe(18);
    // Inline code: the node's value sits inside the backticks.
    expect(spanBase("a `x y` b", 2, 7, "x y")).toBe(3);
    // A continuation line under a quote marker is not in one piece.
    expect(spanBase("> a\n> b", 2, 7, "a\nb")).toBeNull();
    expect(spanBase(TEXT, undefined, 5, "x")).toBeNull();
  });
});

describe("spanPieces", () => {
  it("places each line of a wrapped text node after its prefix", () => {
    expect(spanPieces("> a\n> b", 2, 7, "a\nb")).toEqual([
      { value: "a", base: 2 },
      { value: "\n", base: null },
      { value: "b", base: 6 },
    ]);
    expect(spanPieces("- one\n  two", 2, 11, "one\ntwo")).toEqual([
      { value: "one", base: 2 },
      { value: "\n", base: null },
      { value: "two", base: 8 },
    ]);
    // Trailing spaces the parser trimmed, and a CRLF break.
    expect(spanPieces("a \r\n   b", 0, 8, "a\r\nb")).toEqual([
      { value: "a", base: 0 },
      { value: "\r\n", base: null },
      { value: "b", base: 7 },
    ]);
  });

  it("keeps a node placed in one piece whole, and stops at a line it cannot place", () => {
    expect(spanPieces(TEXT, 18, 30, "Deploys run ")).toEqual([
      { value: "Deploys run ", base: 18 },
    ]);
    // The second line holds an escape: it and the rest stay unplaced.
    expect(spanPieces("> a\n> b \\* c", 2, 13, "a\nb * c")).toEqual([
      { value: "a", base: 2 },
      { value: "\n", base: null },
      { value: "b * c", base: null },
    ]);
    expect(spanPieces("a &amp; b", 0, 9, "a & b")).toEqual([
      { value: "a & b", base: null },
    ]);
    expect(spanPieces(TEXT, undefined, 5, "x")).toEqual([
      { value: "x", base: null },
    ]);
  });
});

describe("selectionAnchor", () => {
  it("maps a selection across bold back to the source, markers included", () => {
    const el = section();
    const range = document.createRange();
    range.setStart(textIn(el, "Deploys run "), 0);
    range.setEnd(textIn(el, " night."), 6);
    expect(selectionAnchor(document.body, range, SECTIONS)).toEqual({
      section: "7f3a9c2e",
      heading: "Night deploys",
      quote: "Deploys run **at** night",
      occurrence: 1,
    });
  });

  it("gives a section anchor with no quote when an end cannot be placed", () => {
    const el = section();
    const code = document.createElement("pre");
    code.textContent = "unpositioned";
    el.append(code);
    const range = document.createRange();
    range.setStart(textIn(el, "Deploys run "), 0);
    range.setEnd(code.firstChild as Text, 4);
    expect(selectionAnchor(document.body, range, SECTIONS)).toEqual({
      section: "7f3a9c2e",
      heading: "Night deploys",
      quote: null,
      occurrence: null,
    });
  });

  it("gives nothing for a selection across two sections or an empty one", () => {
    const first = section();
    const second = section();
    second.setAttribute("data-section", "_top");
    const across = document.createRange();
    across.setStart(textIn(first, "Deploys run "), 0);
    across.setEnd(textIn(second, " night."), 3);
    expect(selectionAnchor(document.body, across, SECTIONS)).toBeNull();
    const empty = document.createRange();
    empty.setStart(textIn(first, "Deploys run "), 2);
    expect(selectionAnchor(document.body, empty, SECTIONS)).toBeNull();
    expect(selectionAnchor(document.body, null, SECTIONS)).toBeNull();
  });

  it("uses the heading as the key of a section with no id yet", () => {
    const el = section();
    el.setAttribute("data-section", "Night deploys");
    const range = document.createRange();
    range.setStart(textIn(el, "Deploys run "), 0);
    range.setEnd(textIn(el, "Deploys run "), 7);
    expect(
      selectionAnchor(document.body, range, [
        { id: null, heading: "Night deploys", text: TEXT },
      ]),
    ).toMatchObject({ section: "Night deploys", quote: "Deploys" });
  });
});

describe("selectionAnchor at element boundaries", () => {
  it("reads an end at the start of the next section as the end of this one", () => {
    // A triple click on a section's last paragraph ends at offset 0 of
    // whatever block comes next, here the next section itself.
    const el = section();
    const next = section();
    next.setAttribute("data-section", "_top");
    const p = el.querySelector("p") as Element;
    const range = document.createRange();
    range.setStart(p, 0);
    range.setEnd(next, 0);
    expect(selectionAnchor(document.body, range, SECTIONS)).toMatchObject({
      section: "7f3a9c2e",
      quote: "Deploys run **at** night.",
      occurrence: 1,
    });
  });

  it("moves the ends of a selection that spill into a neighbour back into the section", () => {
    // Dragging from the end of one section's last line, or to the very start
    // of the next section, puts an end in the neighbour at its very edge.
    const a = section();
    const b = section();
    b.setAttribute("data-section", "b");
    const both: SectionText[] = [
      { id: "7f3a9c2e", heading: "Night deploys", text: TEXT },
      { id: "b", heading: "Night deploys", text: TEXT },
    ];
    const range = document.createRange();
    range.setStart(textIn(a, "Deploys run "), 0);
    range.setEnd(textIn(b, "Night deploys"), 0);
    expect(selectionAnchor(document.body, range, both)).toMatchObject({
      section: "7f3a9c2e",
      quote: "Deploys run **at** night.",
    });
    range.setStart(textIn(a, " night."), " night.".length);
    range.setEnd(textIn(b, "Deploys run "), 7);
    expect(selectionAnchor(document.body, range, both)).toMatchObject({
      section: "b",
      quote: "Night deploys\n\nDeploys",
    });
  });

  it("refuses a boundary whose nearest words were not placed", () => {
    const el = section();
    const code = document.createElement("pre");
    code.textContent = "unpositioned";
    el.append(code);
    const range = document.createRange();
    range.setStart(textIn(el, "Deploys run "), 0);
    range.setEnd(el, el.childNodes.length);
    expect(selectionAnchor(document.body, range, SECTIONS)).toMatchObject({
      section: "7f3a9c2e",
      quote: null,
    });
  });

  it("refuses an end in a span whose words are not the source's", () => {
    // A span whose text no longer matches the source at its offset (a later
    // pass rewrote it) cannot give a quote: it would be a guess.
    const el = section();
    const span = el.querySelector('[data-src="36"]') as Element;
    span.textContent = " evening.";
    const range = document.createRange();
    range.setStart(textIn(el, "Deploys run "), 0);
    range.setEnd(textIn(el, " evening."), 4);
    expect(selectionAnchor(document.body, range, SECTIONS)).toMatchObject({
      quote: null,
    });
  });
});

describe("domRange", () => {
  it("clamps a source range whose ends sit on markup to the words inside", () => {
    const el = section();
    // `**at**`: both ends on the asterisks.
    const range = domRange(
      el,
      TEXT.indexOf("**at"),
      TEXT.indexOf("at**") + 4,
      TEXT,
    );
    expect(range?.toString()).toBe("at");
  });

  it("turns a source range back into the rendered words", () => {
    const el = section();
    const start = TEXT.indexOf("run");
    const range = domRange(
      el,
      start,
      TEXT.indexOf("night") + "night".length,
      TEXT,
    );
    expect(range?.toString()).toBe("run at night");
    expect(sourceOffset(el, textIn(el, " night."), 1)).toBe(37);
  });

  it("refuses a range over a span that no longer reads the source", () => {
    // What the wikilink rewrite would do inside a stamped span: the words
    // change, the offset stays. Counting them as source would shift the paint.
    const el = section();
    const span = el.querySelector('[data-src="18"]') as Element;
    span.textContent = "Rollouts go ";
    expect(domRange(el, 26, 42, TEXT)).toBeNull();
    // A span that holds an element is refused the same way.
    span.textContent = "";
    span.append("Deploys ", document.createElement("a"), "run ");
    expect(domRange(el, 26, 42, TEXT)).toBeNull();
    // A range clear of the rewritten span still paints.
    expect(domRange(el, 32, 42, TEXT)?.toString()).toBe("at night");
  });

  it("answers null when the source range is not on the page", () => {
    expect(domRange(section(), 900, 910, TEXT)).toBeNull();
  });
});

describe("paintQuotes", () => {
  it("registers both highlights where the browser has them, and takes them down", () => {
    const registry = new Map<string, unknown>();
    class FakeHighlight {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    const g = globalThis as unknown as {
      CSS?: { highlights?: Map<string, unknown> } | undefined;
      Highlight?: unknown;
    };
    const saved = { CSS: g.CSS, Highlight: g.Highlight };
    g.CSS = { highlights: registry };
    g.Highlight = FakeHighlight;
    try {
      const el = section();
      const a = domRange(el, 18, 21, TEXT) as Range;
      const stop = paintQuotes([a, a], [a]);
      expect(
        (registry.get(QUOTE_HIGHLIGHT) as FakeHighlight).ranges,
      ).toHaveLength(2);
      expect(
        (registry.get(ACTIVE_HIGHLIGHT) as FakeHighlight).ranges,
      ).toHaveLength(1);
      stop();
      expect(registry.size).toBe(0);
    } finally {
      g.CSS = saved.CSS;
      g.Highlight = saved.Highlight;
    }
  });

  it("does nothing where the browser has no highlight registry", () => {
    expect(() => {
      paintQuotes([], [])();
    }).not.toThrow();
  });
});

describe("displayQuote", () => {
  it("drops the markers a selection edge cut off from their partner", () => {
    expect(displayQuote("at** night")).toBe("at night");
    expect(displayQuote("Deploys run **at")).toBe("Deploys run at");
    expect(displayQuote("at* and _so")).toBe("at and so");
    expect(displayQuote("run `x")).toBe("run x");
    expect(displayQuote("gone~~ now")).toBe("gone now");
    expect(displayQuote("**a _b** c")).toBe("**a b** c");
  });

  it("drops what is left of a link cut in two", () => {
    expect(displayQuote("see [the docs")).toBe("see the docs");
    expect(displayQuote("docs](https://x) for")).toBe("docs for");
    expect(displayQuote("[text](http")).toBe("text");
  });

  it("keeps markup that is whole, and plain stars and underscores", () => {
    for (const quote of [
      "Deploys run **at** night",
      "`code` here",
      "snake_case_name",
      "2 * 3",
      "see [the docs](https://x) now",
      "takes ~10 minutes",
      "a*b",
    ]) {
      expect(displayQuote(quote)).toBe(quote);
    }
  });

  it("never leaves nothing to show", () => {
    expect(displayQuote("**")).toBe("**");
  });
});
