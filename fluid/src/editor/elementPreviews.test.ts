/**
 * The live preview of the dialect's elements, driven through a real view:
 * off the lines a selection touches, a callout head, a status label, a colour
 * code and math draw as the reading page draws them; on those lines the text
 * shows as written. Every assertion is on the rendered DOM, and the buffer
 * comes back out byte for byte.
 */

import { cursorCharLeft } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parsedState } from "../test/parse";
import CmEditor from "./CmEditor";
import { elementPreviews } from "./elementPreviews";
import { livePreview } from "./preview";
import { baseExtensions, lineSeparatorFor } from "./setup";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

/** A buffer with both preview layers, in the order the surface mounts them. */
function editor(doc: string, at: number): EditorView {
  view = new EditorView({
    state: parsedState(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(at),
        extensions: [
          ...lineSeparatorFor(doc),
          ...baseExtensions(false),
          elementPreviews(),
          livePreview(),
        ],
      }),
    ),
    parent: document.body,
  });
  return view;
}

/** The rendered text of one document line. */
function lineText(v: EditorView, number: number): string {
  const line = v.state.doc.line(number);
  const { node } = v.domAtPos(line.from + (line.length > 0 ? 1 : 0));
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(".cm-line")?.textContent ?? "";
}

const CALLOUT = "> [!WARNING]\n> Mind the gap\n\nEnd\n";

describe("a callout", () => {
  it("draws its head as the kind word and icon off the active line", async () => {
    const v = editor(CALLOUT, CALLOUT.length);
    const head = v.dom.querySelector(".cm-callout-head");
    expect(head).not.toBeNull();
    await waitFor(() => {
      expect(head?.textContent).toBe("Warning");
      expect(head?.querySelector("svg")).not.toBeNull();
    });
    expect(lineText(v, 1)).not.toContain("[!WARNING]");
    // Every line of the quote wears the reading page's callout tint.
    const lines = v.dom.querySelectorAll(
      '.cm-line.callout[data-callout="warning"]',
    );
    expect(lines).toHaveLength(2);
    expect(v.state.doc.toString()).toBe(CALLOUT);
  });

  it("keeps a title as text beside the icon", async () => {
    const doc = "> [!TIP]- Short way\n> body\n\nEnd\n";
    const v = editor(doc, doc.length);
    const head = v.dom.querySelector(".cm-callout-head");
    await waitFor(() => {
      expect(head?.querySelector("svg")).not.toBeNull();
    });
    expect(head?.textContent).toBe("");
    expect(lineText(v, 1)).toContain("Short way");
    expect(lineText(v, 1)).not.toContain("[!TIP]-");
  });

  it("lets the caret move inside a title rather than over it", () => {
    const doc = "> [!TIP]- Short way\n> body\n\nEnd\n";
    // The end of the title, the head drawn: the caret is on the head line,
    // so a step left is checked against a line that is not drawn either.
    const v = editor(doc, doc.length);
    const end = doc.indexOf("\n");
    v.dispatch({ selection: EditorSelection.cursor(end) });
    cursorCharLeft(v);
    expect(v.state.selection.main.head).toBe(end - 1);
    // And with the caret elsewhere, nothing over the title is atomic.
    v.dispatch({ selection: EditorSelection.cursor(doc.length) });
    const atomic = v.state
      .facet(EditorView.atomicRanges)
      .map((source) => source(v));
    // Arrowing up from the body checks the head line as it is drawn now.
    const title = doc.indexOf("Short");
    const over: [number, number][] = [];
    for (const set of atomic) {
      set.between(title, title + 1, (from, to) => {
        if (from < title + 1 && to > title) {
          over.push([from, to]);
        }
      });
    }
    expect(over).toEqual([]);
  });

  it("shows the head as written while the caret is on it", () => {
    const v = editor(CALLOUT, 3);
    expect(v.dom.querySelector(".cm-callout-head")).toBeNull();
    expect(lineText(v, 1)).toContain("[!WARNING]");
  });
});

describe("a status label", () => {
  const DOC = "Build :status[Done]{green} today\n\nEnd\n";

  it("draws as the pill off the active line", () => {
    const v = editor(DOC, DOC.length);
    const pill = v.dom.querySelector('.status-label[data-status="green"]');
    expect(pill?.textContent).toBe("Done");
    expect(lineText(v, 1)).toBe("Build Done today");
  });

  it("shows as written on the active line", () => {
    const v = editor(DOC, 2);
    expect(v.dom.querySelector(".status-label")).toBeNull();
    expect(lineText(v, 1)).toBe("Build :status[Done]{green} today");
  });
});

describe("a colour code", () => {
  const DOC = "Accent `#0969DA` here and `#define` there\n\nEnd\n";

  it("gets a swatch before it, and only a colour does", () => {
    const v = editor(DOC, DOC.length);
    const swatches = v.dom.querySelectorAll<HTMLElement>("[data-swatch]");
    expect(swatches).toHaveLength(1);
    // jsdom normalises the colour it is handed.
    expect(swatches[0]?.style.background).not.toBe("");
  });

  it("has none on the active line", () => {
    const v = editor(DOC, 2);
    expect(v.dom.querySelector("[data-swatch]")).toBeNull();
  });
});

describe("math", () => {
  it("sets inline math off the active line and shows it as written on it", async () => {
    const doc = "Area $`\\pi r^2`$ of a circle\n\nEnd\n";
    const v = editor(doc, doc.length);
    await waitFor(() => {
      expect(v.dom.querySelector(".cm-math-inline .katex")).not.toBeNull();
    });
    expect(lineText(v, 1)).not.toContain("$`");
    v.dispatch({ selection: EditorSelection.cursor(2) });
    expect(v.dom.querySelector(".cm-math-inline")).toBeNull();
    expect(lineText(v, 1)).toBe("Area $`\\pi r^2`$ of a circle");
  });

  it("sets a math fence and a dollar block as display math", async () => {
    const doc = "Intro\n\n```math\nE = mc^2\n```\n\n$$\na^2 + b^2\n$$\n\nEnd\n";
    const v = editor(doc, doc.length);
    await waitFor(() => {
      expect(
        v.dom.querySelectorAll(".cm-math-block .katex-display"),
      ).toHaveLength(2);
    });
    // The caret in a block brings the source back.
    v.dispatch({ selection: EditorSelection.cursor(doc.indexOf("a^2")) });
    expect(v.dom.querySelectorAll(".cm-math-block")).toHaveLength(1);
    expect(v.dom.textContent).toContain("a^2 + b^2");
    expect(v.state.doc.toString()).toBe(doc);
  });

  it("leaves a single dollar pair alone", () => {
    const doc = "It costs $5 and $6 today\n\nEnd\n";
    const v = editor(doc, doc.length);
    expect(v.dom.querySelector(".cm-math-inline, .cm-math-block")).toBeNull();
  });
});

describe("inside the React screen that mounts the buffer", () => {
  it("draws a callout head without a word from React", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container, unmount } = render(
        createElement(CmEditor, {
          initialDoc: "Top\n\n> [!NOTE]\n> body\n",
          extensions: [...baseExtensions(false), elementPreviews()],
          ariaLabel: "Source",
          onReady: () => {},
          onDocChanged: () => {},
        }),
      );
      await waitFor(() => {
        expect(container.querySelector(".cm-callout-head svg")).not.toBeNull();
      });
      unmount();
      await Promise.resolve();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
