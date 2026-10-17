/**
 * Where the caret is in a callout or a status label, and the three edits the
 * format bar's context segment makes there: a callout's kind, whether it
 * starts open or closed, and a label's colour.
 *
 * The seam `tableVerbs` and `imageVerbs` are for their elements. Detection
 * reads the syntax tree, whose dialect nodes (`dialectHighlight.ts`) are read
 * the way the reading page reads the source, so a label written inside code
 * is code and a quote that only looks like a callout stays a quote. Every
 * verb re-derives the element from `view.state` when it runs rather than
 * trusting what the bar last rendered, opens with the shared guard (off a
 * hidden id line, clear of the folded frontmatter), and is one transaction
 * over exactly the characters it changes: the kind word, the fold sign, the
 * brace text. A title, a label's words and everything around them stay as
 * the author wrote them.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { EditorView as View, ViewPlugin } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import type { CalloutKind } from "../markdown/callouts";
import { parseCalloutHead } from "../markdown/callouts";
import type { StatusColour } from "../markdown/directives";
import { statusColour } from "../markdown/directives";
import { clearOfFoldedFrontmatter } from "./toolbar";

/** The element the caret is in, in document terms. */
export type ElementContext =
  | {
      kind: "callout";
      line: number;
      callout: CalloutKind;
      fold: "open" | "closed" | null;
    }
  | { kind: "status"; from: number; to: number; colour: StatusColour }
  | null;

/**
 * What the format bar draws from: the element without its positions, so
 * typing inside a callout is not a change the bar hears about.
 */
export type ElementFace =
  | { kind: "callout"; callout: CalloutKind; fold: "open" | "closed" | null }
  | { kind: "status"; colour: StatusColour }
  | null;

/** A callout's head, with the spans the verbs rewrite. */
export interface CalloutAt {
  /** The quote the callout is. */
  quote: SyntaxNode;
  /** The document line its head stands on. */
  line: number;
  /** The marker, `[!KIND]` and its sign. */
  markFrom: number;
  markTo: number;
  /** The kind word between `[!` and `]`. */
  kindFrom: number;
  kindTo: number;
  /** Where the fold sign is, or null when none is written. */
  signAt: number | null;
  callout: CalloutKind;
  fold: "open" | "closed" | null;
}

/** A status label, with the span of its closing mark. */
export interface StatusAt {
  from: number;
  to: number;
  /** The closing mark: `]` and the braces after it, if any. */
  closeFrom: number;
  colour: StatusColour;
}

/**
 * The callout `quote` is, or null when it is a plain quote: the first block
 * in it is a paragraph that opens with a callout marker.
 */
export function calloutOf(
  state: EditorState,
  quote: SyntaxNode,
): CalloutAt | null {
  let first = quote.firstChild;
  while (first !== null && first.name === "QuoteMark") {
    first = first.nextSibling;
  }
  const mark = first?.name === "Paragraph" ? first.firstChild : null;
  if (
    mark === null ||
    mark.name !== "CalloutMark" ||
    mark.from !== first?.from
  ) {
    return null;
  }
  const head = parseCalloutHead(state.doc.sliceString(mark.from, mark.to));
  if (head === null) {
    return null;
  }
  const close = state.doc.sliceString(mark.from, mark.to).indexOf("]");
  const kindTo = mark.from + close;
  return {
    quote,
    line: state.doc.lineAt(mark.from).number,
    markFrom: mark.from,
    markTo: mark.to,
    kindFrom: mark.from + 2,
    kindTo,
    signAt: kindTo + 1 < mark.to ? kindTo + 1 : null,
    callout: head.kind,
    fold: head.fold,
  };
}

/** The label `node` is, read off its two marks. */
export function statusOf(
  state: EditorState,
  node: SyntaxNode,
): StatusAt | null {
  const close = node.lastChild;
  if (
    close === null ||
    close.name !== "StatusMark" ||
    close === node.firstChild
  ) {
    return null;
  }
  const mark = state.doc.sliceString(close.from, close.to);
  const braces = mark.length > 1 ? mark.slice(2, -1) : null;
  return {
    from: node.from,
    to: node.to,
    closeFrom: close.from,
    colour: statusColour(braces),
  };
}

/**
 * The enclosing nodes at `pos`, innermost first, looked for on both sides: a
 * position is a gap between two characters, and at an element's first
 * character only a look to the right finds it, one past its last only a look
 * to the left does.
 */
function ancestorsAt(state: EditorState, pos: number): SyntaxNode[] {
  const tree = syntaxTree(state);
  const found: SyntaxNode[] = [];
  for (const side of [-1, 1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(pos, side);
    while (node !== null) {
      if (
        !found.some(
          (seen) => seen.from === node!.from && seen.name === node!.name,
        )
      ) {
        found.push(node);
      }
      node = node.parent;
    }
  }
  return found;
}

/** The label the caret is in, or null. */
export function statusAtCaret(state: EditorState): StatusAt | null {
  const pos = state.selection.main.head;
  for (const node of ancestorsAt(state, pos)) {
    if (node.name === "StatusLabel") {
      return statusOf(state, node);
    }
  }
  return null;
}

/** The innermost callout the caret is in, or null. */
export function calloutAtCaret(state: EditorState): CalloutAt | null {
  return calloutAt(state, state.selection.main.head);
}

/** The innermost callout around `pos`, or null. */
export function calloutAt(state: EditorState, pos: number): CalloutAt | null {
  const quotes = ancestorsAt(state, pos)
    .filter((node) => node.name === "Blockquote")
    // Innermost first: the one that starts last.
    .sort((a, b) => b.from - a.from);
  for (const quote of quotes) {
    const callout = calloutOf(state, quote);
    if (callout !== null) {
      return callout;
    }
  }
  return null;
}

/** The element the caret is in: a status label first, then a callout. */
export function elementAt(state: EditorState): ElementContext {
  const status = statusAtCaret(state);
  if (status !== null) {
    return {
      kind: "status",
      from: status.from,
      to: status.to,
      colour: status.colour,
    };
  }
  const callout = calloutAtCaret(state);
  if (callout !== null) {
    return {
      kind: "callout",
      line: callout.line,
      callout: callout.callout,
      fold: callout.fold,
    };
  }
  return null;
}

/** The element without its positions. */
export function elementFace(context: ElementContext): ElementFace {
  if (context === null) {
    return null;
  }
  return context.kind === "status"
    ? { kind: "status", colour: context.colour }
    : { kind: "callout", callout: context.callout, fold: context.fold };
}

/** A face as one comparable word. */
function keyOf(face: ElementFace): string {
  if (face === null) {
    return "";
  }
  return face.kind === "status"
    ? `status:${face.colour}`
    : `callout:${face.callout}:${face.fold ?? ""}`;
}

/**
 * One edit, or none when the text already says it. Tagged `input` rather
 * than `input.type`, so it is an undo step of its own and never merges into
 * the words around it.
 */
function write(
  view: EditorView,
  from: number,
  to: number,
  insert: string,
): boolean {
  if (view.state.doc.sliceString(from, to) !== insert) {
    view.dispatch({ changes: { from, to, insert }, userEvent: "input" });
  }
  // The bar cancels its own mousedown; a menu that opened over it did take
  // focus, and this hands it back.
  view.focus();
  return true;
}

/** Give the callout the caret is in another kind, or refuse. */
export function setCalloutKind(view: EditorView, kind: CalloutKind): boolean {
  if (!clearOfFoldedFrontmatter(view)) {
    return false;
  }
  const callout = calloutAtCaret(view.state);
  if (callout === null) {
    return false;
  }
  return write(view, callout.kindFrom, callout.kindTo, kind.toUpperCase());
}

/** Make the callout the caret is in start open or closed, or refuse. */
export function setCalloutFold(
  view: EditorView,
  fold: "open" | "closed",
): boolean {
  if (!clearOfFoldedFrontmatter(view)) {
    return false;
  }
  const callout = calloutAtCaret(view.state);
  if (callout === null) {
    return false;
  }
  const sign = fold === "open" ? "+" : "-";
  return callout.signAt === null
    ? write(view, callout.markTo, callout.markTo, sign)
    : write(view, callout.signAt, callout.signAt + 1, sign);
}

/** Give the label the caret is in another colour, or refuse. */
export function setStatusColour(
  view: EditorView,
  colour: StatusColour,
): boolean {
  if (!clearOfFoldedFrontmatter(view)) {
    return false;
  }
  const status = statusAtCaret(view.state);
  if (status === null) {
    return false;
  }
  // `]` alone, or `]{...}`: the braces' words are replaced, or braces added.
  const hasBraces = status.to - status.closeFrom > 1;
  return hasBraces
    ? write(view, status.closeFrom + 2, status.to - 1, colour)
    : write(view, status.to, status.to, `{${colour}}`);
}

/**
 * Tell a screen what element the caret is in whenever that changes, so the
 * format bar draws the segment for it.
 *
 * Changes of the face only, like the table and image listeners beside it:
 * the kind, the fold or the colour, never a position, so typing inside a
 * callout costs no render. The plugin's construction reports the state a
 * buffer mounts with, which an update listener never sees.
 */
export function elementContextListener(
  onChange: (face: ElementFace) => void,
): Extension {
  let last: string | null = null;
  const cross = (state: EditorState) => {
    const face = elementFace(elementAt(state));
    const key = keyOf(face);
    if (key === last) {
      return;
    }
    last = key;
    onChange(face);
  };
  return [
    ViewPlugin.define((view) => {
      cross(view.state);
      return {};
    }),
    View.updateListener.of((update) => {
      // A parse pass is the third reason to look again, as for tables: the
      // tree that first says "this is a callout" can arrive on its own.
      if (
        !update.selectionSet &&
        !update.docChanged &&
        syntaxTree(update.startState) === syntaxTree(update.state)
      ) {
        return;
      }
      cross(update.state);
    }),
  ];
}
