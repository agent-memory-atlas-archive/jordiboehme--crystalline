/**
 * Preview mode's answer to a frontmatter block and a frontmatter form both on
 * screen: the form in the Details rail is the metadata surface, so the block
 * itself is hidden from the text. Raw shows everything unconditionally (the
 * fold lives in the preview layer set, which the Raw toggle empties), and Raw
 * is where an author goes to read or edit the yaml by hand.
 *
 * Hidden text must not be lost by accident. A chip that vanished on a stray
 * Backspace was loud; a block nobody can see going away would be silent, and
 * in a room the server saves it a moment later. So typing and deleting are
 * kept out of the block: a deletion that reaches into it (Backspace at the
 * start of the body, a selection that starts above it, select-all) removes
 * only what lies outside it, and the line break after the closing fence stays
 * too. Text typed or pasted where the caret parks beside the hidden block
 * lands at the start of the body instead. Edits that are not typing - the
 * form, a draft restore, the room's own sync, undo - pass untouched.
 *
 * The fold is atomic, so cursor motion steps over the hidden block rather than
 * walking into lines nobody can see.
 *
 * A decoration source, so the standing guard question is answered here: it
 * decorates exactly the `frontmatterRegion` range and reads no markdown prose
 * context, so `inCompletableProse` is not applicable by construction.
 */

import type { Annotation, Extension, TransactionSpec } from "@codemirror/state";
import {
  ChangeSet,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView } from "@codemirror/view";

import { frontmatterRegion } from "./frontmatterRegion";

/** The hidden block: whole lines, so nothing of it takes a row on screen. */
const HIDE = Decoration.replace({ block: true });

function folded(state: EditorState): DecorationSet {
  const region = frontmatterRegion(state.doc);
  if (region === null) {
    return Decoration.none;
  }
  return Decoration.set([HIDE.range(region.from, region.to)]);
}

const foldField = StateField.define<DecorationSet>({
  create: (state) => folded(state),
  update(deco, tr) {
    // An empty set is the shown state, and nothing this field sees hides the
    // block again: once the yaml is on screen - because the document never
    // had a block, or because a hand edit removed the closing fence - no edit
    // hides it under a person editing it. A Raw round trip or a wholesale
    // buffer replacement re-creates the field, which re-reads the document.
    if (!tr.docChanged || deco === Decoration.none) {
      return deco;
    }
    // Recompute rather than map: a form edit inside the hidden region moves
    // the fences, and the region is cheap to re-read.
    return folded(tr.state);
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

/** The user events the guard answers: typing, deleting, pasting, dropping. */
function typed(tr: Transaction): boolean {
  return (
    tr.isUserEvent("input") ||
    tr.isUserEvent("delete") ||
    tr.isUserEvent("move")
  );
}

/**
 * Keeps typing out of the hidden block. `protect` is the block plus the line
 * break after its closing fence (deleting that break would glue the first body
 * line onto the fence); `landing` is where text typed beside the block goes.
 */
const guard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !typed(tr)) {
    return tr;
  }
  const start = tr.startState;
  const decorations = start.field(foldField, false);
  if (decorations === undefined || decorations.size === 0) {
    return tr;
  }
  const region = frontmatterRegion(start.doc);
  if (region === null) {
    return tr;
  }
  const length = start.doc.length;
  const protectTo = Math.min(region.to + 1, length);
  const landing = protectTo;
  let touched = false;
  // Every part that reached the block lands, in order, at the start of the
  // body as one insertion; whatever those parts deleted past the block still
  // goes. Changes come sorted and never overlap, so a later change always
  // starts at or after `deleteTo`. Each moved part remembers where it stood
  // in the document the transaction would have made, so a selection set
  // inside it can follow it.
  let landed = "";
  let deleteTo = protectTo;
  const moved: { fromB: number; toB: number; offset: number }[] = [];
  const outside: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const text = inserted.toString();
    const reaches =
      toA > fromA ? fromA < protectTo : text !== "" && fromA <= region.to;
    if (!reaches) {
      outside.push({ from: fromA, to: toA, insert: text });
      return;
    }
    touched = true;
    if (text !== "") {
      moved.push({ fromB, toB, offset: landed.length });
    }
    landed += text;
    deleteTo = Math.max(deleteTo, toA);
  });
  if (!touched) {
    return tr;
  }
  // A file that is only its frontmatter: text added beside the block starts
  // the body after one blank line, as a new engram's body does, counting the
  // line breaks the text already brings.
  const leadingBreaks =
    /^(?:\r?\n)*/.exec(landed)?.[0].split(/\r?\n/).length ?? 1;
  const prefix =
    region.to === length && landed !== ""
      ? start.lineBreak.repeat(Math.max(0, 2 - (leadingBreaks - 1)))
      : "";
  const specs = [...outside];
  if (landed !== "" || deleteTo > protectTo) {
    specs.push({
      from: landing,
      to: deleteTo,
      insert: landed === "" ? "" : `${prefix}${landed}`,
    });
  }
  if (specs.length === 0) {
    // Nothing outside the block was asked for: the keystroke does nothing.
    return [];
  }
  const changes = ChangeSet.of(specs, length, start.lineBreak);
  // From the document the transaction would have made into the one this
  // makes: back through its own changes, then forward through these.
  const mapping = tr.changes.invert(start.doc).compose(changes);
  // Where the moved text starts now (its line breaks count one each, as
  // document positions do).
  const textStart =
    changes.mapPos(landing, -1) + prefix.split(start.lineBreak).length - 1;
  const place = (positionB: number): number => {
    const part = moved.find(
      (one) => positionB >= one.fromB && positionB <= one.toB,
    );
    if (part !== undefined) {
      const before = landed.slice(0, part.offset).split(/\r?\n/).join("\n");
      return textStart + before.length + (positionB - part.fromB);
    }
    return mapping.mapPos(positionB, 1);
  };
  let selection: EditorSelection;
  if (tr.selection !== undefined) {
    // A selection the transaction set on purpose follows its text.
    const set = tr.selection;
    selection = EditorSelection.create(
      set.ranges.map((range) =>
        EditorSelection.range(place(range.anchor), place(range.head)),
      ),
      set.mainIndex,
    );
  } else {
    // A caret that stood beside the block goes where its text went (after
    // it), or to the start of the body; every other caret follows its own
    // change.
    const beside = changes.mapPos(landing, landed === "" ? -1 : 1);
    selection = EditorSelection.create(
      start.selection.ranges.map((range) =>
        range.from < protectTo
          ? EditorSelection.cursor(beside)
          : range.map(changes, 1),
      ),
      start.selection.mainIndex,
    );
  }
  // Every annotation the transaction carried (input type, history, a picked
  // completion and the rest). The list is not in the typed interface, so it
  // is read with a fallback to the ones this guard knows by name. The test
  // "a transaction still carries its annotations as an array" in
  // frontmatterFold.test.ts fails if a @codemirror/state release renames or
  // removes this field.
  const carried = (tr as unknown as { annotations?: Annotation<unknown>[] })
    .annotations;
  const annotations: Annotation<unknown>[] =
    carried !== undefined
      ? carried.filter((one) => one.type !== Transaction.time)
      : [
          Transaction.userEvent.of(
            tr.annotation(Transaction.userEvent) ?? "input",
          ),
        ];
  if (tr.annotation(Transaction.userEvent) === undefined) {
    annotations.push(Transaction.userEvent.of("input"));
  }
  const spec: TransactionSpec = {
    changes,
    selection,
    effects: StateEffect.mapEffects(tr.effects, mapping),
    scrollIntoView: tr.scrollIntoView,
    annotations,
  };
  return spec;
});

/**
 * Whether a frontmatter block is hidden from this state's screen right now.
 *
 * The live state of the fold, not a mode: false where the field was never
 * installed (Raw mode empties the compartment this rides in, and the MANIFEST
 * surface never had it), false once the block was shown, and false for a
 * document with no block to hide. A caller that must not write into hidden
 * text asks this rather than guessing from the layer it thinks is on.
 */
export function frontmatterHidden(state: EditorState): boolean {
  const decorations = state.field(foldField, false);
  return decorations !== undefined && decorations.size > 0;
}

/** The frontmatter block hidden from the text, with typing kept out of it. */
export function frontmatterFold(): Extension {
  return [foldField, guard];
}
