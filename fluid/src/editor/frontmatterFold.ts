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

import type { Extension, TransactionSpec } from "@codemirror/state";
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

/** Shows the block again for the life of this field (tests, and any caller
 *  that wants the yaml in view without leaving preview). */
export const unfoldEffect = StateEffect.define<boolean>();

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
    for (const effect of tr.effects) {
      if (effect.is(unfoldEffect)) {
        return Decoration.none;
      }
    }
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
  // A block with nothing after it: text typed beside it needs its own line.
  const prefix = region.to === length ? start.lineBreak : "";
  let touched = false;
  let moved = false;
  const specs: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    const reaches =
      toA > fromA ? fromA < protectTo : text !== "" && fromA <= region.to;
    if (!reaches) {
      specs.push({ from: fromA, to: toA, insert: text });
      return;
    }
    touched = true;
    // The block (which starts the document) and the break after it stay;
    // whatever the change reached past them still goes, and its text lands
    // at the start of the body.
    const to = Math.max(toA, protectTo);
    if (to > protectTo || text !== "") {
      moved = moved || text !== "";
      specs.push({
        from: landing,
        to,
        insert: text === "" ? "" : `${prefix}${text}`,
      });
    }
  });
  if (!touched) {
    return tr;
  }
  if (specs.length === 0) {
    // Nothing outside the block was asked for: the keystroke does nothing.
    return [];
  }
  const changes = ChangeSet.of(specs, length, start.lineBreak);
  const head = changes.mapPos(landing, moved ? 1 : -1);
  const spec: TransactionSpec = {
    changes,
    selection: EditorSelection.cursor(head),
    scrollIntoView: true,
    annotations: Transaction.userEvent.of(
      tr.annotation(Transaction.userEvent) ?? "input",
    ),
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
