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
 * the id line or its line breaks (it goes only with its whole heading), a
 * selection from inside a heading into the body leaves the heading its id,
 * and copied text leaves the ids out, so a pasted copy cannot take a section's id
 * and its threads. Only this person's typing is steered: a change from the
 * room carries no user event and is applied as it came.
 */

import type {
  Extension,
  Line,
  SelectionRange,
  Text,
  TransactionSpec,
} from "@codemirror/state";
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, keymap } from "@codemirror/view";

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

/**
 * A new line typed at the end of a heading lands below the heading's id, and
 * so does a block inserted from a heading line (`insertBlock` writes it at
 * the line's end, led by a line break): a toolbar block or an uploaded file's
 * link never splits a heading from its id.
 */
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
  // The selection the insert asked for moves down with it: a typed new line
  // leaves the caret after it, a block inserted from the toolbar or an upload
  // keeps the caret or selection it put inside itself.
  const shift = below.to - only.at;
  const end = only.at + only.text.length;
  const asked = tr.selection;
  const inside =
    asked !== undefined &&
    asked.ranges.every((r) => r.from >= only.at && r.to <= end);
  return {
    changes: { from: below.to, insert: only.text },
    selection: inside
      ? EditorSelection.create(
          asked.ranges.map((r) =>
            EditorSelection.range(r.anchor + shift, r.head + shift),
          ),
          asked.mainIndex,
        )
      : EditorSelection.cursor(below.to + only.text.length),
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

/**
 * A change that crosses the line break after a heading: a selection deleted,
 * cut, typed over, pasted over or dropped, or a whole line deleted. The id
 * line is hidden, so the line break a person sees after a heading is the
 * whole stretch from the heading's end to the start of the next visible line,
 * id and all, and the edit is read that way:
 *
 * - The heading's first character goes (a selection from the heading's start,
 *   a triple-click, a deleted line): the whole heading goes, and its id with
 *   it, wherever the change ended inside that stretch.
 * - The heading's start stays: the id goes back on the line right below what
 *   is left of the heading (below the first line of a pasted text), wherever
 *   the change left it. When the line below already holds an id, the
 *   surviving heading's own id takes that place: the text that is left is
 *   this heading's, and the heading that id belonged to has gone.
 *
 * A heading counts as gone too when the line break before it was deleted,
 * so two selections that end on one line leave one id there, not two. The
 * edit itself happens as the person made it; the ids are put right in the
 * same transaction, so one Undo takes both back.
 */
const keepHeadingIds = Prec.high(
  EditorState.transactionFilter.of((tr) => {
    if (
      !tr.docChanged ||
      tr.isUserEvent("delete.backward") ||
      tr.isUserEvent("delete.forward") ||
      tr.isUserEvent("move.line") ||
      !(
        tr.isUserEvent("input") ||
        tr.isUserEvent("delete") ||
        tr.isUserEvent("move")
      )
    ) {
      return tr;
    }
    const doc = tr.startState.doc;
    const changes: { fromA: number; toA: number }[] = [];
    tr.changes.iterChanges((fromA, toA) => {
      changes.push({ fromA, toA });
    });
    // The headings whose line break the transaction reached into.
    const touched: { heading: Line; id: Line; survives: boolean }[] = [];
    const seen = new Set<number>();
    for (const { fromA, toA } of changes) {
      if (fromA === toA) {
        continue; // a pure insert: `newLineBelowId` places it
      }
      const first = doc.lineAt(fromA).number;
      const last = doc.lineAt(toA).number;
      for (let n = Math.max(1, first - 1); n <= last; n += 1) {
        if (n >= doc.lines || seen.has(n)) {
          continue;
        }
        const heading = doc.line(n);
        const id = doc.line(n + 1);
        if (!isIdLine(id.text)) {
          continue;
        }
        const seamEnd = n + 1 < doc.lines ? id.to + 1 : id.to;
        if (!(fromA < seamEnd && toA > heading.to)) {
          continue;
        }
        seen.add(n);
        const survives = !changes.some(
          (c) =>
            (c.fromA <= heading.from && c.toA > heading.from) ||
            (heading.from > 0 &&
              c.fromA < heading.from &&
              c.toA >= heading.from),
        );
        touched.push({ heading, id, survives });
      }
    }
    if (touched.length === 0) {
      return tr;
    }
    const after = tr.newDoc;
    // First: every id text the change left standing goes, with one line
    // break beside it, unless it already sits alone below its heading.
    const removals: { from: number; to: number }[] = [];
    const placing: { headingAt: number; id: string }[] = [];
    for (const { heading, id, survives } of touched) {
      const intact = !changes.some((c) => c.fromA < id.to && c.toA > id.from);
      const headingAt = tr.changes.mapPos(heading.from, -1);
      if (intact) {
        const at = tr.changes.mapPos(id.from, 1);
        const end = at + id.text.length;
        if (survives) {
          const line = after.lineAt(headingAt);
          if (
            line.number < after.lines &&
            after.line(line.number + 1).from === at &&
            after.line(line.number + 1).to === end
          ) {
            continue; // still alone right below its heading
          }
        }
        if (end < after.length && after.sliceString(end, end + 1) === "\n") {
          removals.push({ from: at, to: end + 1 });
        } else if (at > 0 && after.sliceString(at - 1, at) === "\n") {
          removals.push({ from: at - 1, to: end });
        } else {
          removals.push({ from: at, to: end });
        }
      }
      if (survives) {
        placing.push({ headingAt, id: id.text });
      }
    }
    const removed = ChangeSet.of(removals, after.length);
    const middle = removed.apply(after);
    const inserts: { from: number; to: number; insert: string }[] = [];
    const lines = new Set<number>();
    for (const { headingAt, id } of placing) {
      const line = middle.lineAt(removed.mapPos(headingAt, -1));
      if (lines.has(line.number)) {
        continue;
      }
      lines.add(line.number);
      const below =
        line.number < middle.lines ? middle.line(line.number + 1) : null;
      if (below !== null && isIdLine(below.text)) {
        if (below.text !== id) {
          inserts.push({ from: below.from, to: below.to, insert: id });
        }
      } else {
        inserts.push({ from: line.to, to: line.to, insert: `\n${id}` });
      }
    }
    const specs: TransactionSpec[] = [tr];
    if (removals.length > 0) {
      specs.push({ changes: removals, sequential: true });
    }
    if (inserts.length > 0) {
      specs.push({ changes: inserts, sequential: true });
    }
    return specs.length === 1 ? tr : specs;
  }),
);

/**
 * The lines a move takes along: a heading with the id line below it, or the
 * one line. An id line on its own is taken with the heading above it.
 */
function unitAt(doc: Text, n: number): { first: number; last: number } {
  if (isIdLine(doc.line(n).text) && n > 1) {
    return { first: n - 1, last: n };
  }
  if (n < doc.lines && isIdLine(doc.line(n + 1).text)) {
    return { first: n, last: n + 1 };
  }
  return { first: n, last: n };
}

/**
 * Move the selected lines up or down past the next line, with a heading and
 * its id line moved as one: neither the lines that move nor the line they
 * pass can separate a heading from its id. Without an id line in reach it
 * leaves the move to the default command.
 */
function moveLinesWithIds(view: EditorView, forward: boolean): boolean {
  const { state } = view;
  if (state.readOnly) {
    return false;
  }
  const doc = state.doc;
  const blocks: { first: number; last: number; ranges: SelectionRange[] }[] =
    [];
  for (const range of state.selection.ranges) {
    let last = doc.lineAt(range.to).number;
    const first = doc.lineAt(range.from).number;
    if (!range.empty && range.to === doc.line(last).from && last > first) {
      last -= 1;
    }
    const block = {
      first: unitAt(doc, first).first,
      last: unitAt(doc, last).last,
      ranges: [range],
    };
    const previous = blocks.at(-1);
    if (previous !== undefined && block.first <= previous.last) {
      previous.last = Math.max(previous.last, block.last);
      previous.ranges.push(range);
    } else {
      blocks.push(block);
    }
  }
  let ids = false;
  const changes: { from: number; to: number; insert: string }[] = [];
  const ranges: SelectionRange[] = [];
  for (const block of blocks) {
    if (forward ? block.last === doc.lines : block.first === 1) {
      ranges.push(...block.ranges);
      continue;
    }
    const pass = unitAt(doc, forward ? block.last + 1 : block.first - 1);
    const low = Math.min(block.first, pass.first);
    const high = Math.max(block.last, pass.last);
    for (let n = low; n <= high && !ids; n += 1) {
      ids = isIdLine(doc.line(n).text);
    }
    const from = doc.line(block.first).from;
    const to = doc.line(block.last).to;
    const passFrom = doc.line(pass.first).from;
    const passTo = doc.line(pass.last).to;
    const text = doc.sliceString(from, to);
    const passed = doc.sliceString(passFrom, passTo);
    const shift = (passed.length + state.lineBreak.length) * (forward ? 1 : -1);
    changes.push(
      forward
        ? { from, to: passTo, insert: `${passed}${state.lineBreak}${text}` }
        : { from: passFrom, to, insert: `${text}${state.lineBreak}${passed}` },
    );
    for (const r of block.ranges) {
      ranges.push(EditorSelection.range(r.anchor + shift, r.head + shift));
    }
  }
  if (!ids || changes.length === 0) {
    return false;
  }
  const sorted = [...changes].sort((x, y) => x.from - y.from);
  if (sorted.some((c, i) => i > 0 && c.from < (sorted[i - 1]?.to ?? 0))) {
    return false;
  }
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    scrollIntoView: true,
    userEvent: "move.line",
  });
  return true;
}

const moveWithIds = Prec.high(
  keymap.of([
    { key: "Alt-ArrowUp", run: (view) => moveLinesWithIds(view, false) },
    { key: "Alt-ArrowDown", run: (view) => moveLinesWithIds(view, true) },
  ]),
);

/**
 * Pasted text without ids: an id copied from elsewhere (another page, or this
 * one through a channel the copy filter does not see) would give a second
 * section the id, and the threads, of the first.
 */
const pasteWithoutIds = EditorView.clipboardInputFilter.of((text) =>
  stripIdLines(text),
);

/** Copied text without the ids: a pasted copy must not take a section's id. */
const copyWithoutIds = EditorView.clipboardOutputFilter.of((text) =>
  stripIdLines(text),
);

export function hiddenIdLines(): Extension {
  return [
    field,
    newLineBelowId,
    keepIdLines,
    keepHeadingIds,
    moveWithIds,
    copyWithoutIds,
    pasteWithoutIds,
  ];
}
