/**
 * Section id lines, hidden in the editor.
 *
 * Every `##` of a reflection carries `<!-- r:<id> -->` on the line below it
 * (the core On-disk formats). The ids are bookkeeping: the live room saves the
 * text verbatim and the engine adds ids on the room's final save (R12), so
 * the lines stay in the document and are never shown. A block replacement
 * per id line, from a state field (block decorations cannot come from a
 * plugin), marked atomic so the caret steps over them.
 *
 * Hidden is not enough on its own: a person cannot see what their keys do to
 * a line they never see. An id only follows its section while it stays alone
 * on the line right below the heading (the engine's `reattach_ids` reads it
 * there); merged into a line, split off by a new line or deleted, it is lost,
 * the next save mints a new id, and every thread on the section is orphaned.
 * So the person's own typing is kept off the id line: a new line typed at a
 * heading's end goes below the id, a single-character delete never touches
 * the id line or its line breaks (it goes only with its whole heading), and
 * copied text leaves the ids out, so a pasted copy cannot take a section's id
 * and its threads. Only this person's typing is steered: a change from the
 * room carries no user event and is applied as it came.
 */

import type { Extension, TransactionSpec } from "@codemirror/state";
import {
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView } from "@codemirror/view";

import { isIdLine, stripIdLines } from "../reflectionText";

function build(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const line = state.doc.line(n);
    if (isIdLine(line.text)) {
      builder.add(line.from, line.to, Decoration.replace({ block: true }));
    }
  }
  return builder.finish();
}

const field = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f)),
  ],
});

/** A new line typed at the end of a heading lands below the heading's id. */
const newLineBelowId = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input")) {
    return tr;
  }
  const doc = tr.startState.doc;
  const inserts: { at: number; text: string }[] = [];
  let other = false;
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (fromA === toA) {
      inserts.push({ at: fromA, text: inserted.toString() });
    } else {
      other = true;
    }
  });
  const only = inserts[0];
  if (other || inserts.length !== 1 || only === undefined) {
    return tr;
  }
  if (!only.text.startsWith("\n")) {
    return tr;
  }
  const line = doc.lineAt(only.at);
  if (only.at !== line.to || line.number >= doc.lines) {
    return tr;
  }
  const below = doc.line(line.number + 1);
  if (!isIdLine(below.text)) {
    return tr;
  }
  return {
    changes: { from: below.to, insert: only.text },
    selection: EditorSelection.cursor(below.to + only.text.length),
    scrollIntoView: true,
    userEvent: "input",
  };
});

/**
 * A single-character delete (Backspace, Delete) that would reach an id line
 * or one of its line breaks. The one such delete that is let through is the
 * break after the id when a blank line follows: that removes the blank line
 * and leaves the id alone, and the caret then goes to the start of the next
 * line rather than staying inside the hidden one. Anything else is dropped,
 * unless it takes the whole heading with it.
 */
const keepIdLines = EditorState.transactionFilter.of((tr) => {
  if (
    !tr.docChanged ||
    !(tr.isUserEvent("delete.backward") || tr.isUserEvent("delete.forward"))
  ) {
    return tr;
  }
  const doc = tr.startState.doc;
  let blocked = false;
  let caret: number | null = null;
  tr.changes.iterChanges((fromA, toA) => {
    const first = doc.lineAt(Math.max(0, fromA - 1)).number;
    const last = doc.lineAt(Math.min(doc.length, toA + 1)).number;
    for (let n = first; n <= last; n += 1) {
      const line = doc.line(n);
      if (!isIdLine(line.text)) {
        continue;
      }
      // The id line and the breaks on both sides of it.
      const guardFrom = n > 1 ? line.from - 1 : line.from;
      const guardTo = n < doc.lines ? line.to + 1 : line.to;
      if (fromA >= guardTo || toA <= guardFrom) {
        continue;
      }
      const heading = n > 1 ? doc.line(n - 1) : null;
      if (heading !== null && fromA <= heading.from && toA >= line.to) {
        continue; // the whole section head goes, id and all
      }
      const blankBelow = n < doc.lines && doc.line(n + 1).length === 0;
      if (fromA === line.to && toA === line.to + 1 && blankBelow) {
        caret = line.to + 1;
        continue;
      }
      blocked = true;
    }
  });
  if (blocked) {
    return [];
  }
  if (caret === null) {
    return tr;
  }
  const after: TransactionSpec = {
    selection: EditorSelection.cursor(Math.min(caret, tr.newDoc.length)),
    sequential: true,
  };
  return [tr, after];
});

/** Copied text without the ids: a pasted copy must not take a section's id. */
const copyWithoutIds = EditorView.clipboardOutputFilter.of((text) =>
  stripIdLines(text),
);

export function hiddenIdLines(): Extension {
  return [field, newLineBelowId, keepIdLines, copyWithoutIds];
}
