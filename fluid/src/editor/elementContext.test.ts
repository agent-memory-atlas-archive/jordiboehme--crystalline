/**
 * Where the caret is in a callout or a status label, and the three edits the
 * format bar's context segment makes there. Plain views, no React: what the
 * bar draws is `EditorToolbar.test.tsx`'s job.
 */

import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { parsedState } from "../test/parse";
import type { ElementFace } from "./elementContext";
import {
  elementAt,
  elementContextListener,
  setCalloutFold,
  setCalloutKind,
  setStatusColour,
} from "./elementContext";
import { baseExtensions, lineSeparatorFor } from "./setup";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

function state(doc: string, at: number): EditorState {
  return parsedState(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [...lineSeparatorFor(doc), ...baseExtensions(false)],
    }),
  );
}

function mount(doc: string, at: number): EditorView {
  view = new EditorView({ state: state(doc, at), parent: document.body });
  return view;
}

const CALLOUT = "Before\n\n> [!NOTE]\n> text here\n\nAfter\n";
const IN_BODY = CALLOUT.indexOf("text") + 2;

describe("elementAt", () => {
  it("answers the callout from inside its body and on its head", () => {
    expect(elementAt(state(CALLOUT, IN_BODY))).toEqual({
      kind: "callout",
      line: 3,
      callout: "note",
      fold: null,
    });
    expect(elementAt(state(CALLOUT, CALLOUT.indexOf("[!")))).toMatchObject({
      kind: "callout",
      callout: "note",
    });
  });

  it("reads the fold sign and the kind in any case", () => {
    const doc = "> [!warning]- Mind the gap\n> body\n";
    expect(elementAt(state(doc, doc.indexOf("body")))).toEqual({
      kind: "callout",
      line: 1,
      callout: "warning",
      fold: "closed",
    });
  });

  it("answers the status label the caret is in", () => {
    const doc = "Build :status[Done]{green} today\n";
    const from = doc.indexOf(":status");
    const to = doc.indexOf("}") + 1;
    expect(elementAt(state(doc, from + 9))).toEqual({
      kind: "status",
      from,
      to,
      colour: "green",
    });
    // A label without braces is grey, as the reader draws it.
    const bare = "A :status[Open] label\n";
    expect(elementAt(state(bare, bare.indexOf("Open")))).toMatchObject({
      kind: "status",
      colour: "grey",
    });
  });

  it("is null everywhere else", () => {
    expect(elementAt(state(CALLOUT, 2))).toBeNull();
    expect(elementAt(state(CALLOUT, CALLOUT.indexOf("After")))).toBeNull();
    // A plain quote is no callout, and an unknown kind leaves it a quote.
    const quote = "> just a quote\n";
    expect(elementAt(state(quote, 4))).toBeNull();
    // A marker on a later paragraph of a quote does not make it a callout.
    const later = "> words first\n>\n> [!NOTE] later\n";
    expect(elementAt(state(later, later.indexOf("later")))).toBeNull();
    const unknown = "> [!BANANA]\n> body\n";
    expect(elementAt(state(unknown, unknown.indexOf("body")))).toBeNull();
    // A label in code is code, and one with no words is text.
    const code = "Run `:status[Done]{green}` here\n";
    expect(elementAt(state(code, code.indexOf("Done")))).toBeNull();
    const empty = "An :status[]{green} label\n";
    expect(elementAt(state(empty, empty.indexOf("]")))).toBeNull();
  });

  it("does not take a quote around a callout for the callout", () => {
    const doc = "> outer words\n>\n> > [!TIP]\n> > inner\n";
    expect(elementAt(state(doc, doc.indexOf("inner")))).toMatchObject({
      kind: "callout",
      callout: "tip",
      line: 3,
    });
    expect(elementAt(state(doc, doc.indexOf("outer")))).toBeNull();
  });
});

describe("setCalloutKind", () => {
  it("rewrites only the kind word, as one undo step", () => {
    const v = mount(CALLOUT, IN_BODY);
    expect(setCalloutKind(v, "warning")).toBe(true);
    expect(v.state.doc.toString()).toBe(
      "Before\n\n> [!WARNING]\n> text here\n\nAfter\n",
    );
    undo(v);
    expect(v.state.doc.toString()).toBe(CALLOUT);
  });

  it("keeps the fold sign and the title", () => {
    const doc = "> [!NOTE]+ My title\n> body\n";
    const v = mount(doc, doc.indexOf("body"));
    setCalloutKind(v, "details");
    expect(v.state.doc.toString()).toBe("> [!DETAILS]+ My title\n> body\n");
  });

  it("keeps a signless details callout folded when it becomes another kind", () => {
    const doc = "> [!DETAILS] Steps\n> body\n";
    const v = mount(doc, doc.indexOf("body"));
    expect(setCalloutKind(v, "note")).toBe(true);
    expect(v.state.doc.toString()).toBe("> [!NOTE]- Steps\n> body\n");
    undo(v);
    expect(v.state.doc.toString()).toBe(doc);
  });

  it("refuses outside a callout", () => {
    const v = mount(CALLOUT, 2);
    expect(setCalloutKind(v, "tip")).toBe(false);
    expect(v.state.doc.toString()).toBe(CALLOUT);
  });
});

describe("setCalloutFold", () => {
  it("writes the sign right after the marker and keeps the title", () => {
    const doc = "> [!NOTE] Read me\n> body\n";
    const v = mount(doc, doc.indexOf("body"));
    expect(setCalloutFold(v, "closed")).toBe(true);
    expect(v.state.doc.toString()).toBe("> [!NOTE]- Read me\n> body\n");
    setCalloutFold(v, "open");
    expect(v.state.doc.toString()).toBe("> [!NOTE]+ Read me\n> body\n");
  });

  it("refuses outside a callout", () => {
    const v = mount(CALLOUT, 2);
    expect(setCalloutFold(v, "open")).toBe(false);
  });

  it("takes the sign out for a callout that does not fold", () => {
    const doc = "> [!NOTE]- Read me\n> body\n";
    const v = mount(doc, doc.indexOf("body"));
    expect(setCalloutFold(v, null)).toBe(true);
    expect(v.state.doc.toString()).toBe("> [!NOTE] Read me\n> body\n");
  });

  it("refuses to make a details callout static, which always folds", () => {
    const doc = "> [!DETAILS]- More\n> body\n";
    const v = mount(doc, doc.indexOf("body"));
    expect(setCalloutFold(v, null)).toBe(false);
    expect(v.state.doc.toString()).toBe(doc);
  });
});

describe("setStatusColour", () => {
  it("rewrites only the brace content", () => {
    const doc = "Build :status[Done]{green} today\n";
    const v = mount(doc, doc.indexOf("Done"));
    expect(setStatusColour(v, "red")).toBe(true);
    expect(v.state.doc.toString()).toBe("Build :status[Done]{red} today\n");
  });

  it("adds the braces to a label that had none", () => {
    const doc = "A :status[Open] label\n";
    const v = mount(doc, doc.indexOf("Open"));
    setStatusColour(v, "blue");
    expect(v.state.doc.toString()).toBe("A :status[Open]{blue} label\n");
  });

  it("refuses outside a label", () => {
    const doc = "No label here\n";
    const v = mount(doc, 3);
    expect(setStatusColour(v, "blue")).toBe(false);
  });
});

describe("elementContextListener", () => {
  it("reports what the element is, not each keystroke inside it", () => {
    const seen: ElementFace[] = [];
    const doc = "Plain\n\n> [!NOTE]\n> body\n";
    view = new EditorView({
      state: parsedState(
        EditorState.create({
          doc,
          selection: EditorSelection.cursor(0),
          extensions: [
            ...baseExtensions(false),
            elementContextListener((context) => {
              seen.push(context);
            }),
          ],
        }),
      ),
      parent: document.body,
    });
    const body = doc.indexOf("body");
    view.dispatch({ selection: EditorSelection.cursor(body) });
    view.dispatch({ changes: { from: body, insert: "more " } });
    setCalloutKind(view, "tip");
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(seen).toEqual([
      null,
      { kind: "callout", callout: "note", fold: null },
      { kind: "callout", callout: "tip", fold: null },
      null,
    ]);
  });
});
