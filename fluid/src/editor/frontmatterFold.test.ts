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
import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vitest";
import { yCollab } from "y-codemirror.next";
import { pickedCompletion } from "@codemirror/autocomplete";
import * as Y from "yjs";

import { frontmatterFold, frontmatterHidden } from "./frontmatterFold";
import { docText } from "./setup";

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

  test("a frontmatter-only file starts its body after one blank line", () => {
    const doc = "---\ntype: guide\n---";
    const view = mount(doc);
    view.dispatch({ selection: { anchor: doc.length } });
    type(view, "x");
    type(view, "y");
    expect(view.state.sliceDoc()).toBe(`${doc}\n\nxy`);
    expect(view.state.selection.main.head).toBe(doc.length + 4);
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

  test("CRLF: the block and the break after it are kept, text lands in the body", () => {
    const crlf = DOC.replace(/\n/g, "\r\n");
    const view = mount(crlf, [EditorState.lineSeparator.of("\r\n")]);
    view.dispatch({ selection: { anchor: FENCE_END } });
    deleteCharBackward(view);
    view.dispatch({ selection: { anchor: BODY } });
    deleteCharBackward(view);
    expect(docText(view.state)).toBe(crlf);
    view.dispatch({ selection: { anchor: FENCE_END } });
    type(view, "x");
    expect(docText(view.state)).toBe(
      crlf.replace("---\r\n\r\n# Body", "---\r\nx\r\n# Body"),
    );
    view.destroy();
  });

  test("a paste beside the block lands in the body as one change", () => {
    const view = mount(DOC);
    view.dispatch({ selection: { anchor: 0 } });
    view.dispatch({
      changes: { from: 0, insert: "one\ntwo" },
      userEvent: "input.paste",
    });
    expect(view.state.sliceDoc()).toBe(
      `${DOC.slice(0, BODY)}one\ntwo${DOC.slice(BODY)}`,
    );
    expect(view.state.selection.main.head).toBe(BODY + "one\ntwo".length);
    view.destroy();
  });

  test("a drop into the block moves its text to the body and still takes it from where it was", () => {
    const view = mount(DOC);
    const from = DOC.indexOf("Body");
    view.dispatch({
      changes: [
        { from: 4, insert: "Body" },
        { from, to: from + 4, insert: "" },
      ],
      userEvent: "move.drop",
    });
    expect(view.state.sliceDoc()).toBe(
      `${DOC.slice(0, BODY)}Body${DOC.slice(BODY, from)}${DOC.slice(from + 4)}`,
    );
    view.destroy();
  });

  test("a cut across the block takes only the body part, and undo puts it back", () => {
    const view = mount(DOC, [history()]);
    view.dispatch({
      changes: { from: 10, to: DOC.indexOf("Body") },
      userEvent: "delete.cut",
    });
    expect(view.state.sliceDoc()).toBe(
      `${DOC.slice(0, BODY)}${DOC.slice(DOC.indexOf("Body"))}`,
    );
    undo(view);
    expect(view.state.sliceDoc()).toBe(DOC);
    view.destroy();
  });

  test("undo takes back a guarded keystroke", () => {
    const view = mount(DOC, [history()]);
    view.dispatch({ selection: { anchor: FENCE_END } });
    type(view, "x");
    undo(view);
    expect(view.state.sliceDoc()).toBe(DOC);
    view.destroy();
  });

  test("every caret keeps its place, and a caret beside the block goes to the body", () => {
    const view = mount(DOC, [EditorState.allowMultipleSelections.of(true)]);
    const end = DOC.length;
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(FENCE_END),
        EditorSelection.cursor(end),
      ]),
    });
    view.dispatch(view.state.replaceSelection("z"), {
      userEvent: "input.type",
    });
    expect(view.state.sliceDoc()).toBe(
      `${DOC.slice(0, BODY)}z${DOC.slice(BODY)}z`,
    );
    const heads = view.state.selection.ranges.map((range) => range.head);
    expect(heads).toEqual([BODY + 1, end + 2]);
    view.destroy();
  });

  test("the transaction's own effects ride along", () => {
    const mark = StateEffect.define<number>({
      map: (value, mapping) => mapping.mapPos(value),
    });
    let seen: number | null = null;
    const watch = EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(mark)) {
            seen = effect.value;
          }
        }
      }
    });
    const view = mount(DOC, [watch]);
    view.dispatch({
      changes: { from: FENCE_END, insert: "x" },
      effects: mark.of(DOC.length + 1),
      userEvent: "input.type",
    });
    expect(seen).toBe(DOC.length + 1);
    view.destroy();
  });

  test("a Raw round trip shows the block, then hides and guards it again", () => {
    const preview = new Compartment();
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [preview.of(frontmatterFold())],
      }),
      parent: document.body,
    });
    view.dispatch({ effects: preview.reconfigure([]) });
    expect(frontmatterHidden(view.state)).toBe(false);
    view.dispatch({ selection: { anchor: 4 } });
    type(view, "x");
    expect(view.state.sliceDoc()).toContain("---\nxtype");
    view.dispatch({ effects: preview.reconfigure(frontmatterFold()) });
    expect(frontmatterHidden(view.state)).toBe(true);
    view.dispatch({ selection: { anchor: 4 } });
    type(view, "y");
    expect(view.state.sliceDoc()).toContain("---\nxtype");
    expect(view.state.sliceDoc()).not.toContain("ytype");
    view.destroy();
  });

  test("a room: remote edits into the block pass, guarded typing reaches the shared text", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("t");
    ytext.insert(0, DOC);
    const view = mount(DOC, [yCollab(ytext, null)]);
    // A remote author rewrites the status inside the hidden block.
    const at = DOC.indexOf("current");
    doc.transact(() => {
      ytext.delete(at, "current".length);
      ytext.insert(at, "draft");
    }, "remote");
    expect(view.state.sliceDoc()).toContain("status: draft");
    // And typing beside the block lands in the body, in both copies.
    view.dispatch({
      selection: { anchor: view.state.sliceDoc().lastIndexOf("---") + 3 },
    });
    type(view, "x");
    expect(ytext.toJSON()).toBe(view.state.sliceDoc());
    expect(ytext.toJSON()).toContain("---\nx\n# Body");
    view.destroy();
  });

  test("a block added after a frontmatter-only file keeps its own caret and blank line", () => {
    // The shape `appendBlock` dispatches: two breaks, the lines, a closing
    // break, and the caret at the end of the first line.
    const doc = "---\ntype: guide\n---";
    const view = mount(doc);
    const from = doc.length;
    view.dispatch({
      changes: { from, insert: "\n\n![a](assets/a.png)\nnext\n" },
      selection: { anchor: from + 2 + "![a](assets/a.png)".length },
      userEvent: "input",
    });
    expect(view.state.sliceDoc()).toBe(`${doc}\n\n![a](assets/a.png)\nnext\n`);
    expect(view.state.selection.main.head).toBe(
      from + 2 + "![a](assets/a.png)".length,
    );
    view.destroy();
  });

  test("a rewritten transaction keeps its annotations, a picked completion among them", () => {
    let picked: unknown = null;
    const watch = EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) {
        picked = tr.annotation(pickedCompletion) ?? picked;
      }
    });
    const view = mount(DOC, [watch]);
    const completion = { label: "[[Beta]]" };
    view.dispatch({
      changes: { from: FENCE_END, insert: "[[Beta]]" },
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
    expect(view.state.sliceDoc()).toContain("---\n[[Beta]]\n# Body");
    expect(picked).toBe(completion);
    view.destroy();
  });
});
