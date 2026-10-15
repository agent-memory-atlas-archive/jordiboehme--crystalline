/**
 * The quote helpers against the real renderer: a section rendered with
 * `sourceSpans`, a quote found in its text, the words it paints, and the
 * selection of those words read back into the very same quote.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { AssetResolver } from "./api/files";
import { Markdown } from "./components/Markdown";
import { domRange, selectionAnchor } from "./reflectionQuotes";
import { locateQuote } from "./reflectionText";
import type { SectionText } from "./reflectionText";
import { ThemeProvider } from "./theme/ThemeProvider";

/** Render each text as its own section, the way the reflection page does. */
async function renderSections(texts: string[], assets?: AssetResolver) {
  const sections: SectionText[] = texts.map((text, i) => ({
    id: `s${i}`,
    heading: "",
    text,
  }));
  const result = render(
    <MemoryRouter>
      <ThemeProvider>
        {sections.map((section) => (
          <section key={section.id} data-section={section.id}>
            <Markdown
              source={section.text}
              sourceSpans
              {...(assets === undefined ? {} : { assets })}
            />
          </section>
        ))}
      </ThemeProvider>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.queryByText("crystallizing")).toBeNull();
  });
  const elements = Array.from(
    result.container.querySelectorAll("section[data-section]"),
  );
  return { root: result.container, sections, elements };
}

/**
 * Find `quote` in the one section's text, paint it, and select what was
 * painted: the selection must read back as the same quote and occurrence.
 */
async function roundTrip(text: string, quote: string, occurrence = 1) {
  const { root, sections, elements } = await renderSections([text]);
  const at = locateQuote(text, quote, occurrence);
  expect(at).not.toBeNull();
  const range = domRange(elements[0]!, at!.start, at!.end);
  expect(range).not.toBeNull();
  expect(selectionAnchor(root, range, sections)).toEqual({
    section: "s0",
    heading: "",
    quote,
    occurrence,
  });
  return range!;
}

/** The text node holding exactly `text`, under `el`. */
function textIn(el: Element, text: string): Text {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent === text) {
      return node as Text;
    }
  }
  throw new Error(`no text node "${text}"`);
}

describe("a quote through the real renderer", () => {
  it("crosses inline code, backticks included", async () => {
    const range = await roundTrip(
      "Run `cargo test` now, then `cargo build`.",
      "Run `cargo test` now",
    );
    expect(range.toString()).toBe("Run cargo test now");
  });

  it("crosses emphasis that splits it across nodes", async () => {
    const range = await roundTrip(
      "Deploys run **at** night and _only_ then.",
      "run **at** night and _only",
    );
    expect(range.toString()).toBe("run at night and only");
  });

  it("crosses a link, its target included", async () => {
    const range = await roundTrip(
      "Read [the docs](https://example.com/x) first.",
      "docs](https://example.com/x) first",
    );
    expect(range.toString()).toBe("docs first");
  });

  it("keeps CRLF line endings exactly as written", async () => {
    const text = "First line\r\nsecond **line**\r\n\r\nNext para.";
    await roundTrip(text, "line\r\nsecond **line");
    await roundTrip(text, "line**\r\n\r\nNext");
  });

  it("counts a quote that appears twice the way the engine does", async () => {
    const text = "Ship it. Then ship it **again**: ship it.";
    await roundTrip(text, "ship it", 1);
    document.body.innerHTML = "";
    await roundTrip(text, "ship it", 2);
  });

  it("crosses an image, its markup included", async () => {
    await roundTrip(
      "See ![the diagram](assets/d.png) here.",
      "See ![the diagram](assets/d.png) here",
    );
  });
});

describe("a selection through the real renderer", () => {
  it("reads a selection made of element boundaries as the whole block", async () => {
    const text = "Deploys run **at** night.\n\nSecond block.";
    const { root, sections, elements } = await renderSections([text]);
    const p = elements[0]!.querySelector("p")!;
    const range = document.createRange();
    range.setStart(p, 0);
    range.setEnd(p, p.childNodes.length);
    expect(selectionAnchor(root, range, sections)).toMatchObject({
      quote: "Deploys run **at** night.",
      occurrence: 1,
    });
    // A triple click ends at the start of the next block.
    const next = elements[0]!.querySelectorAll("p")[1]!;
    range.setEnd(next, 0);
    expect(selectionAnchor(root, range, sections)).toMatchObject({
      quote: "Deploys run **at** night.",
    });
  });

  it("refuses a selection across two sections", async () => {
    const { root, sections, elements } = await renderSections([
      "First section text.",
      "Second section text.",
    ]);
    const range = document.createRange();
    range.setStart(textIn(elements[0]!, "First section text."), 2);
    range.setEnd(textIn(elements[1]!, "Second section text."), 4);
    expect(selectionAnchor(root, range, sections)).toBeNull();
  });

  it("gives a section anchor where an entity or an escape kept the words unplaced", async () => {
    const text = "Tom &amp; Jerry run **fast**. Use \\*stars\\* **here**.";
    const { root, sections, elements } = await renderSections([text]);
    const range = document.createRange();
    range.setStart(textIn(elements[0]!, "Tom & Jerry run "), 0);
    range.setEnd(textIn(elements[0]!, "fast"), 4);
    expect(selectionAnchor(root, range, sections)).toEqual({
      section: "s0",
      heading: "",
      quote: null,
      occurrence: null,
    });
    range.setStart(textIn(elements[0]!, ". Use *stars* "), 2);
    range.setEnd(textIn(elements[0]!, "here"), 2);
    expect(selectionAnchor(root, range, sections)).toMatchObject({
      quote: null,
    });
    // The placed words around them still paint.
    const fast = text.indexOf("fast");
    expect(domRange(elements[0]!, fast, fast + 4)?.toString()).toBe("fast");
  });

  it("gives a section anchor when an end is in a refused image's alt text", async () => {
    const refusing: AssetResolver = {
      resolve: () => null,
      url: (path) => path,
      refused: () => "Not from this page.",
    };
    const { root, sections, elements } = await renderSections(
      ["See ![the diagram](assets/d.png) here."],
      refusing,
    );
    const range = document.createRange();
    range.setStart(textIn(elements[0]!, "See "), 0);
    range.setEnd(textIn(elements[0]!, "the diagram"), 3);
    expect(selectionAnchor(root, range, sections)).toMatchObject({
      section: "s0",
      quote: null,
    });
  });
});
