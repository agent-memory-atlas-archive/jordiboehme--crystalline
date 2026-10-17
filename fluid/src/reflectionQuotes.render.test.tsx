/**
 * The quote helpers against the real renderer: a section rendered with
 * `sourceSpans`, a quote found in its text, the words it paints, and the
 * selection of those words read back into the very same quote.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { AssetResolver } from "./api/files";
import { Markdown } from "./components/Markdown";
import { domRange, selectionAnchor } from "./reflectionQuotes";
import { locateQuote } from "./reflectionText";
import type { SectionText } from "./reflectionText";
import { ThemeProvider } from "./theme/ThemeProvider";

// The Markdown renderer loads its pipeline lazily, and the first render in a
// worker waits for that import. On a quiet machine it settles in well under a
// second; with every core busy it has been seen still on its placeholder after
// the 3 s default wait, so the wait below and the test budget are widened
// together. Passing runs return the moment the body is drawn.
vi.setConfig({ testTimeout: 60_000 });

/** Render each text as its own section, the way the reflection page does. */
async function renderSections(
  texts: string[],
  assets?: AssetResolver,
  titleNote?: string,
) {
  const sections: SectionText[] = texts.map((text, i) => ({
    id: `s${i}`,
    heading: "",
    text,
  }));
  const result = render(
    <MemoryRouter>
      <ThemeProvider>
        {sections.map((section, at) => (
          <section key={section.id} data-section={section.id}>
            <Markdown
              source={section.text}
              sourceSpans
              {...(at === 0 && titleNote !== undefined ? { titleNote } : {})}
              {...(assets === undefined ? {} : { assets })}
            />
          </section>
        ))}
      </ThemeProvider>
    </MemoryRouter>,
  );
  await waitFor(
    () => {
      expect(
        screen.queryByRole("status", { name: "Loading the text" }),
      ).toBeNull();
    },
    { timeout: 30_000 },
  );
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
  const range = domRange(elements[0]!, at!.start, at!.end, text);
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

  it("sits inside one line of a hard-wrapped list item", async () => {
    const range = await roundTrip(
      "- first item\n- second item runs\n  onto a second line\n",
      "onto a second",
    );
    expect(range.toString()).toBe("onto a second");
  });

  it("crosses the lines of a hard-wrapped list item, the indent included", async () => {
    const range = await roundTrip(
      "- first item\n- second item runs\n  onto a second line\n",
      "runs\n  onto",
    );
    expect(range.toString()).toBe("runs\nonto");
  });

  it("sits inside one line of a multi-line blockquote", async () => {
    const range = await roundTrip(
      "> quoted first line\n> quoted second line\n",
      "second line",
    );
    expect(range.toString()).toBe("second line");
  });

  it("crosses the lines of a multi-line blockquote, the marker included", async () => {
    const range = await roundTrip(
      "> quoted first line\n> quoted second line\n",
      "first line\n> quoted",
    );
    expect(range.toString()).toBe("first line\nquoted");
  });

  it("anchors a quote inside a callout and across two of its lines", async () => {
    const text =
      "> [!NOTE] Heads up\n> Deploys run at night.\n> Rollbacks run by day.";
    await roundTrip(text, "Deploys run at night.");
    await roundTrip(text, "night.\n> Rollbacks");
  });

  it("anchors a quote beside and inside a status label", async () => {
    await roundTrip("Login is :status[In review]{blue} today.", "Login is");
    await roundTrip("State :status[In review]{blue} now", "In review");
  });

  it("crosses an indented paragraph continuation", async () => {
    await roundTrip("Opening words\n   then more words.\n", "words\n   then");
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
    expect(domRange(elements[0]!, fast, fast + 4, text)?.toString()).toBe(
      "fast",
    );
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

describe("a note under the title", () => {
  const TEXT = "# Deploying\n\nShort intro. Book a slot in the calendar.\n";
  const NOTE = "1 section \u00b7 1 open thread";

  it("is drawn right under the first heading and nowhere else", async () => {
    const { root } = await renderSections(
      [TEXT, "## Later\n\n# Another\n"],
      undefined,
      NOTE,
    );
    const h1 = root.querySelector("h1")!;
    const note = h1.nextElementSibling!;
    expect(note).toHaveTextContent(NOTE);
    expect(note.hasAttribute("data-src")).toBe(false);
    expect(note.hasAttribute("data-anchor-skip")).toBe(true);
    expect(root.querySelectorAll("[data-anchor-skip]")).toHaveLength(1);
  });

  it("leaves a thread's quote painted and read back unchanged", async () => {
    const { root, sections, elements } = await renderSections(
      [TEXT],
      undefined,
      NOTE,
    );
    const at = locateQuote(TEXT, "Book a slot", 1)!;
    const range = domRange(elements[0]!, at.start, at.end, TEXT);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("Book a slot");
    expect(selectionAnchor(root, range, sections)).toEqual({
      section: "s0",
      heading: "",
      quote: "Book a slot",
      occurrence: 1,
    });
  });

  it("is not a selection when it lies wholly in the note", async () => {
    const { root, sections } = await renderSections([TEXT], undefined, NOTE);
    const words = textIn(root.querySelector("[data-anchor-skip]")!, NOTE);
    const range = document.createRange();
    range.setStart(words, 2);
    range.setEnd(words, 9);
    expect(selectionAnchor(root, range, sections)).toBeNull();
  });

  it("starts a selection that begins in the note at the next words of the page", async () => {
    const { root, sections } = await renderSections([TEXT], undefined, NOTE);
    const words = textIn(root.querySelector("[data-anchor-skip]")!, NOTE);
    const intro = textIn(
      root.querySelector("p:not([data-anchor-skip])")!,
      "Short intro. Book a slot in the calendar.",
    );
    const range = document.createRange();
    range.setStart(words, 2);
    range.setEnd(intro, 5);
    expect(selectionAnchor(root, range, sections)).toEqual({
      section: "s0",
      heading: "",
      quote: "Short",
      occurrence: 1,
    });
  });

  it("reads a selection that crosses it as the words of the page only", async () => {
    const { root, sections } = await renderSections([TEXT], undefined, NOTE);
    const title = textIn(root.querySelector("h1")!, "Deploying");
    const intro = textIn(
      root.querySelector("p:not([data-anchor-skip])")!,
      "Short intro. Book a slot in the calendar.",
    );
    const range = document.createRange();
    range.setStart(title, 3);
    range.setEnd(intro, 5);
    const anchor = selectionAnchor(root, range, sections);
    expect(anchor?.quote).toBe("loying\n\nShort");
  });

  it("is not a selection from the end of the title into the note, nor from the note to the text", async () => {
    const { root, sections } = await renderSections([TEXT], undefined, NOTE);
    const title = textIn(root.querySelector("h1")!, "Deploying");
    const words = textIn(root.querySelector("[data-anchor-skip]")!, NOTE);
    const into = document.createRange();
    into.setStart(title, 9);
    into.setEnd(words, 5);
    expect(selectionAnchor(root, into, sections)).toBeNull();
    const intro = textIn(
      root.querySelector("p:not([data-anchor-skip])")!,
      "Short intro. Book a slot in the calendar.",
    );
    const out = document.createRange();
    out.setStart(words, 3);
    out.setEnd(intro, 0);
    expect(selectionAnchor(root, out, sections)).toBeNull();
  });

  it("goes under a setext title", async () => {
    const { root } = await renderSections(
      ["Deploying\n=========\n\nIntro.\n"],
      undefined,
      NOTE,
    );
    expect(root.querySelector("h1")!.nextElementSibling).toHaveTextContent(
      NOTE,
    );
  });

  it("goes under the first of two titles only", async () => {
    const { root } = await renderSections(
      ["# One\n\nText.\n\n# Two\n\nMore.\n"],
      undefined,
      NOTE,
    );
    const [first, second] = Array.from(root.querySelectorAll("h1"));
    expect(first!.nextElementSibling).toHaveTextContent(NOTE);
    expect(second!.nextElementSibling).not.toHaveAttribute("data-anchor-skip");
    expect(root.querySelectorAll("[data-anchor-skip]")).toHaveLength(1);
  });

  it("is not drawn when the section holding the note has no title, whatever a later section has", async () => {
    const { root } = await renderSections(
      ["Intro only.\n", "# Later\n\nText.\n"],
      undefined,
      NOTE,
    );
    expect(root.querySelectorAll("[data-anchor-skip]")).toHaveLength(0);
  });

  it("changes its text without remounting anything or dropping a selection", async () => {
    const text =
      "# Deploying\n\nSee [the runbook](#runbook) for the steps.\n\n```\ncode\n```\n";
    const view = (note: string) => (
      <MemoryRouter>
        <ThemeProvider>
          <section data-section="s0">
            <Markdown source={text} sourceSpans titleNote={note} />
          </section>
        </ThemeProvider>
      </MemoryRouter>
    );
    const result = render(view("1 section"));
    await waitFor(() => {
      expect(
        screen.queryByRole("status", { name: "Loading the text" }),
      ).toBeNull();
    });
    const h1 = result.container.querySelector("h1");
    const link = result.container.querySelector("a");
    const pre = result.container.querySelector("pre");
    const words = textIn(
      result.container.querySelector("p:not([data-anchor-skip])")!,
      " for the steps.",
    );
    const range = document.createRange();
    range.setStart(words, 1);
    range.setEnd(words, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    result.rerender(view("1 section \u00b7 2 open threads"));
    expect(screen.getByText("1 section \u00b7 2 open threads")).toBeVisible();
    expect(result.container.querySelector("h1")).toBe(h1);
    expect(result.container.querySelector("a")).toBe(link);
    expect(result.container.querySelector("pre")).toBe(pre);
    expect(window.getSelection()!.toString()).toBe("for");
  });
});
