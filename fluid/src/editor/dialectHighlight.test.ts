/**
 * The editor grammar knows the dialect's markers: `[!KIND]` at the head of a
 * quote and the `:status[` and `]{...}` around a label are marks, painted in
 * the same token class as a quote's `>`, and neither is read as a link.
 */

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { parsedState } from "../test/parse";
import { baseExtensions } from "./setup";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

const DOC =
  "# Head\n\n> [!NOTE]+ Title\n> body\n\nA :status[Done]{green} label\n";

function mount(): EditorView {
  view = new EditorView({
    state: parsedState(
      EditorState.create({
        doc: DOC,
        selection: EditorSelection.cursor(0),
        extensions: baseExtensions(false),
      }),
    ),
    parent: document.body,
  });
  return view;
}

/** The class of the innermost element holding exactly `text`. */
function classOf(v: EditorView, text: string): string | null {
  const spans = [...v.contentDOM.querySelectorAll("span")];
  return spans.find((span) => span.textContent === text)?.className ?? null;
}

describe("the dialect markers", () => {
  it("are parsed as marks, not links", () => {
    const v = mount();
    const names: string[] = [];
    syntaxTree(v.state).iterate({
      enter: (node) => {
        names.push(node.name);
      },
    });
    expect(names).toContain("CalloutMark");
    expect(names).toContain("StatusLabel");
    expect(names.filter((name) => name === "StatusMark")).toHaveLength(2);
    expect(names).not.toContain("Link");
  });

  it("wear the token class a quote mark wears", () => {
    const v = mount();
    // A quote mark: a heading mark also wears the heading's own size.
    const mark = classOf(v, ">");
    expect(mark).toBeTruthy();
    expect(classOf(v, "[!NOTE]+")).toBe(mark);
    expect(classOf(v, ":status[")).toBe(mark);
    expect(classOf(v, "]{green}")).toBe(mark);
  });
});
