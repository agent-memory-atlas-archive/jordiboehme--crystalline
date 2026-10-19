/**
 * Every element the editor can insert, in one list: the Insert menu in the
 * format bar and the `/` menu both read it, so an element added here is in
 * both at once and spelled the same in each.
 *
 * Each action is one transaction, like every other command of the bar (see
 * `toolbar.ts`), so it is one undo step and safe in a room. Block actions go
 * through `insertBlock` and inline ones through the same guard it opens with
 * (`clearOfFoldedFrontmatter`), which also steps a caret off a Reflection's
 * hidden id line first: no insert writes into an id or parts one from its
 * heading.
 *
 * `replace` is the `/query` the slash menu was opened with: it goes in the
 * same transaction as the insert, so one undo puts the typed text back.
 */

import { EditorSelection } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type { CalloutKind } from "../markdown/callouts";
import { CALLOUT_KINDS } from "../markdown/callouts";
import { STATUS_COLOURS } from "../markdown/directives";
import { isLevelTwo } from "../reflectionText";
import { hidesIdLines } from "./hiddenIdLines";
import { MERMAID_STARTER_GROUPS, mermaidFence } from "./mermaidStarters";
import type { TextRange } from "./toolbar";
import {
  CODE_SKELETON,
  clearOfFoldedFrontmatter,
  insertBlock,
  selectToken,
  tableSkeleton,
  toggleLinePrefix,
} from "./toolbar";

export interface InsertAction {
  /** Stable name, for tests and keys: "callout-note", "diagram-flowchart". */
  id: string;
  /** The word on the menu row. */
  label: string;
  /** The menu section it is listed under. */
  group: "Callout" | "Blocks" | "Diagram" | "Inline";
  /** The diagram starter's own group ("Everyday"), for the Diagram submenu. */
  subgroup?: string;
  /** Other words the `/` filter finds it by. */
  keywords: string[];
  /** Insert it, in one transaction; `replace` goes in the same one. */
  run(view: EditorView, replace?: TextRange): boolean;
}

/** A block of lines with `token` selected once it is in. */
function block(lines: readonly string[], token: string | null) {
  return (view: EditorView, replace?: TextRange): boolean =>
    insertBlock(
      view,
      lines,
      token === null ? null : selectToken(lines, token),
      replace,
    );
}

/**
 * `before` + words + `after` at the caret, the words selected. Selected words
 * on one line become the words; otherwise the placeholder `token` does.
 */
function inline(before: string, token: string, after: string) {
  return (view: EditorView, replace?: TextRange): boolean => {
    if (!clearOfFoldedFrontmatter(view)) {
      return false;
    }
    const { state } = view;
    const main = state.selection.main;
    const chosen = state.sliceDoc(main.from, main.to);
    const own =
      replace === undefined && chosen !== "" && !/[\r\n]/.test(chosen);
    const words = own ? chosen : token;
    const range = replace ?? (own ? main : { from: main.head, to: main.head });
    const start = range.from + before.length;
    view.dispatch({
      changes: { ...range, insert: `${before}${words}${after}` },
      selection: EditorSelection.range(start, start + words.length),
      userEvent: "input",
    });
    view.focus();
    return true;
  };
}

/** The next footnote number: one past the highest the text already uses. */
function nextFootnote(text: string): number {
  let highest = 0;
  for (const match of text.matchAll(/\[\^(\d+)\]/g)) {
    highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

/**
 * Where a note for a reference at `pos` goes: after the last line with text
 * of the caret's section on a Reflection page (each section renders on its
 * own, so a note elsewhere would not resolve), else of the document, and
 * never above the caret's own line.
 */
function noteEnd(state: EditorState, pos: number): number {
  const { doc } = state;
  const sections = hidesIdLines(state);
  let last = doc.lineAt(pos);
  for (let n = last.number + 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    if (sections && isLevelTwo(line.text)) {
      break;
    }
    if (line.text.trim() !== "") {
      last = line;
    }
  }
  return last.to;
}

/** "Note" placeholder for the footnote's own text. */
const NOTE = "Note";

/**
 * `[^n]` at the caret and `[^n]: Note` at the end of the text, in one
 * transaction, with `Note` selected. A blank line goes in front of the note,
 * so it never reads as part of the paragraph above it.
 */
function insertFootnote(view: EditorView, replace?: TextRange): boolean {
  if (!clearOfFoldedFrontmatter(view)) {
    return false;
  }
  const { state } = view;
  const separator = state.lineBreak;
  const n = nextFootnote(state.doc.toString());
  const main = state.selection.main;
  const at = replace ?? { from: main.to, to: main.to };
  const ref = `[^${String(n)}]`;
  const head = `${ref}: `;
  const end = noteEnd(state, at.to);
  // The reference goes in before the note's spot, so it shifts it; the
  // two line breaks are a position each however they are written.
  const shift = ref.length - (at.to - at.from);
  const note = end + shift + 2 + head.length;
  view.dispatch({
    changes: [
      { ...at, insert: ref },
      { from: end, insert: `${separator}${separator}${head}${NOTE}` },
    ],
    selection: EditorSelection.range(note, note + NOTE.length),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
  return true;
}

const TASK = "- [ ] ";

/**
 * The task list: the format bar's own toggle, or from the `/` menu, the
 * `/query` taken out and the box put in front of the line, caret after it.
 */
function insertTask(view: EditorView, replace?: TextRange): boolean {
  if (replace === undefined) {
    return toggleLinePrefix(view, TASK);
  }
  if (!clearOfFoldedFrontmatter(view)) {
    return false;
  }
  const { state } = view;
  const line = state.doc.lineAt(replace.from);
  const removed = replace.to - replace.from;
  const head = state.selection.main.head;
  const caret =
    head >= replace.to ? head - removed : Math.min(head, replace.from);
  view.dispatch({
    changes: [
      { from: line.from, insert: TASK },
      { ...replace, insert: "" },
    ],
    selection: EditorSelection.cursor(caret + TASK.length),
    userEvent: "input",
  });
  view.focus();
  return true;
}

/** What the `/` filter also answers to, per callout kind. */
const CALLOUT_WORDS: Record<Exclude<CalloutKind, "details">, string[]> = {
  note: ["info"],
  tip: ["hint"],
  important: [],
  warning: ["warn"],
  caution: ["danger"],
};

const CALLOUTS: InsertAction[] = CALLOUT_KINDS.filter(
  (kind): kind is Exclude<CalloutKind, "details"> => kind !== "details",
).map((kind) => ({
  id: `callout-${kind}`,
  label: `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`,
  group: "Callout",
  keywords: ["callout", "alert", ...CALLOUT_WORDS[kind]],
  run: block([`> [!${kind.toUpperCase()}]`, "> Text"], "Text"),
}));

const DIAGRAMS: InsertAction[] = MERMAID_STARTER_GROUPS.flatMap((group) =>
  group.starters.map((starter) => {
    // The body and the caret come from one call, so the range can never
    // describe lines other than these.
    const { lines, select } = mermaidFence(starter);
    return {
      id: `diagram-${starter.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: starter.label,
      group: "Diagram" as const,
      subgroup: group.label,
      keywords: ["diagram", "mermaid", "chart", group.label.toLowerCase()],
      run: (view: EditorView, replace?: TextRange) =>
        insertBlock(view, lines, select, replace),
    };
  }),
);

const MATH_WORDS = ["math", "formula", "equation", "latex"];

/** The registry, in the order the elements are listed. */
export const INSERT_ACTIONS: readonly InsertAction[] = [
  ...CALLOUTS,
  {
    id: "expand",
    label: "Expand block",
    group: "Blocks",
    keywords: ["details", "collapse", "fold", "toggle", "callout"],
    // Folded: `-` after the kind, so it starts closed on the page.
    run: block(["> [!DETAILS]- Title", "> Text"], "Title"),
  },
  {
    id: "status",
    label: "Status label",
    group: "Inline",
    keywords: ["badge", "lozenge", "tag", "colour", "color"],
    run: inline(":status[", "Status", `]{${STATUS_COLOURS[0]}}`),
  },
  {
    id: "table",
    label: "Table",
    group: "Blocks",
    keywords: ["grid", "columns", "rows"],
    run: block(tableSkeleton(2, 2), "Column"),
  },
  ...DIAGRAMS,
  {
    id: "code",
    label: "Code block",
    group: "Blocks",
    keywords: ["fence", "snippet", "source"],
    // No token: the caret lands in the fence's language slot.
    run: block(CODE_SKELETON, null),
  },
  {
    id: "math-inline",
    label: "Inline math",
    group: "Inline",
    keywords: MATH_WORDS,
    run: inline("$`", "x", "`$"),
  },
  {
    id: "math-block",
    label: "Math block",
    group: "Blocks",
    keywords: MATH_WORDS,
    run: block(["$$", "x", "$$"], "x"),
  },
  {
    id: "footnote",
    label: "Footnote",
    group: "Inline",
    keywords: ["note", "reference", "citation"],
    run: insertFootnote,
  },
  {
    id: "task",
    label: "Task list",
    group: "Blocks",
    keywords: ["todo", "checkbox", "checklist"],
    run: insertTask,
  },
];
