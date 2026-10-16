/**
 * The hidden frontmatter, as the things an author needs to be true: the block
 * takes no room in the text, the caret walks past it rather than into it,
 * typing and deleting cannot reach it, and an edit dispatched INTO the region
 * (which is what the Details form does all day) keeps it hidden and current.
 */

import {
  cursorCharLeft,
  deleteCharBackward,
  deleteCharForward,
  history,
  selectAll,
  undo,
} from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";

import {
  frontmatterFold,
  frontmatterHidden,
  unfoldEffect,
} from "./frontmatterFold";

const DOC =
  "---\ntype: guide\nstatus: current\ntags:\n- protocol\n---\n\n# Body\n";
/** Where the body starts: the line after the closing fence. */
const BODY = DOC.lastIndexOf("---") + "---\n".length;
const FENCE_END = DOC.lastIndexOf("---") + "---".length;

function mount(doc: string, extensions: Extension[] = []): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [frontmatterFold(), ...extensions],
    }),
    parent: document.body,
  });
}

/** What a keystroke does: the same user event CodeMirror's input carries. */
function type(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.type",
  });
}

describe("frontmatterFold", () => {
  test("the block is hidden from the text, with no chip in its place", () => {
    const view = mount(DOC);
    expect(view.contentDOM.textContent).not.toContain("status: current");
    expect(view.contentDOM.textContent).not.toContain("Frontmatter");
    expect(view.dom.querySelector("button")).toBeNull();
    expect(frontmatterHidden(view.state)).toBe(true);
    view.destroy();
  });

  test("cursor motion steps over the hidden block rather than into it", () => {
    const view = mount(DOC);
    // Body start to blank line to the region's trailing edge are ordinary
    // motion. The THIRD step is the one that discriminates: atomic, it jumps
    // the whole hidden block and lands at 0.
    view.dispatch({ selection: { anchor: DOC.indexOf("# Body") } });
    cursorCharLeft(view);
    cursorCharLeft(view);
    expect(view.state.selection.main.head).toBe(FENCE_END);
    cursorCharLeft(view);
    expect(view.state.selection.main.head).toBe(0);
    view.destroy();
  });

  test("the unfold effect brings the yaml back", () => {
    const view = mount(DOC);
    view.dispatch({ effects: unfoldEffect.of(true) });
    expect(view.contentDOM.textContent).toContain("status: current");
    expect(frontmatterHidden(view.state)).toBe(false);
    view.destroy();
  });

  test("a document with no frontmatter hides nothing", () => {
    const view = mount("# Just a body\n");
    expect(view.contentDOM.textContent).toContain("Just a body");
    expect(frontmatterHidden(view.state)).toBe(false);
    view.destroy();
  });

  test("a form edit into the hidden region lands and keeps it hidden", () => {
    const view = mount(DOC);
    const at = view.state.sliceDoc().indexOf("current");
    // No user event: the shape of the Details form's own dispatch.
    view.dispatch({
      changes: { from: at, to: at + "current".length, insert: "draft" },
    });
    expect(view.state.sliceDoc()).toContain("status: draft");
    expect(frontmatterHidden(view.state)).toBe(true);
    view.destroy();
  });

  test("a hand edit that removes the closing fence shows the text again", () => {
    const view = mount(DOC);
    const at = view.state.sliceDoc().lastIndexOf("---");
    view.dispatch({ changes: { from: at, to: at + 3, insert: "" } });
    expect(view.contentDOM.textContent).toContain("status: current");
    view.destroy();
  });

  test("Backspace beside the hidden block deletes nothing of it", () => {
    // At the region's trailing edge, where the left-arrow walk parks the
    // caret, and at the start of the body: neither the block nor the break
    // after its fence may go, because nobody would see them go.
    const view = mount(DOC, [history()]);
    view.dispatch({ selection: { anchor: FENCE_END } });
    deleteCharBackward(view);
    expect(view.state.sliceDoc()).toBe(DOC);
    view.dispatch({ selection: { anchor: BODY } });
    deleteCharBackward(view);
    expect(view.state.sliceDoc()).toBe(DOC);
    view.dispatch({ selection: { anchor: 0 } });
    deleteCharForward(view);
    expect(view.state.sliceDoc()).toBe(DOC);
    view.destroy();
  });

  test("a deletion across the block removes only the body part of it", () => {
    const view = mount(DOC, [history()]);
    selectAll(view);
    deleteCharBackward(view);
    expect(view.state.sliceDoc()).toBe(DOC.slice(0, BODY));
    // And undo brings the body back.
    undo(view);
    expect(view.state.sliceDoc()).toBe(DOC);
    view.destroy();
  });

  test("text typed beside the hidden block lands at the start of the body, in order", () => {
    const view = mount(DOC);
    view.dispatch({ selection: { anchor: FENCE_END } });
    type(view, "a");
    type(view, "b");
    expect(view.state.sliceDoc()).toBe(
      `${DOC.slice(0, BODY)}ab${DOC.slice(BODY)}`,
    );
    expect(view.state.selection.main.head).toBe(BODY + 2);
    view.destroy();
  });

  test("typing over a selection that starts in the block keeps the block", () => {
    const view = mount(DOC);
    selectAll(view);
    type(view, "Fresh");
    expect(view.state.sliceDoc()).toBe(`${DOC.slice(0, BODY)}Fresh`);
    view.destroy();
  });

  test("a block with nothing after it gets a line for text typed beside it", () => {
    const doc = "---\ntype: guide\n---";
    const view = mount(doc);
    view.dispatch({ selection: { anchor: doc.length } });
    type(view, "x");
    expect(view.state.sliceDoc()).toBe(`${doc}\nx`);
    view.destroy();
  });

  test("edits that are not typing pass untouched", () => {
    // A draft restore, the room's sync and undo carry no input event: they
    // may rewrite the block, as they always could.
    const view = mount(DOC);
    view.dispatch({ changes: { from: 0, to: BODY, insert: "" } });
    expect(view.state.sliceDoc()).toBe(DOC.slice(BODY));
    view.destroy();
  });
});
