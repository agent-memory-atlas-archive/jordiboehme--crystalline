/**
 * Conventional comments (conventionalcomments.org) in a thread: a first line
 * `<label> [decorations]: <subject>`, then an optional discussion. A comment
 * is stored as the text it is; this reads its first line so a thread can draw
 * the label, and so the comment box can turn a typed head into its chip.
 *
 * The parse is strict, the way a status label's is: only the exact form is a
 * label, anything else is plain text. The grammar is
 * `<label>( \(<decoration>(, <decoration>)*\))?: <subject>`, where the label
 * is one of {@link LABELS} in any case (drawn lowercase), a decoration is one
 * or more ASCII letters, digits or hyphens, and the subject is not empty once
 * its spaces are trimmed. The core reads the same grammar
 * (`crates/core/src/conventional.rs`); both are tested against
 * `crates/core/tests/fixtures/conventional-comments.json`.
 */

/** The fixed label set, in the order the Label menu lists it. */
export const LABELS = [
  "praise",
  "nitpick",
  "suggestion",
  "issue",
  "todo",
  "question",
  "thought",
  "chore",
  "note",
] as const;

export type Label = (typeof LABELS)[number];

/** The decorations the Label menu offers, in its order. */
export const DECORATIONS = ["blocking", "non-blocking", "if-minor"] as const;

/** A label and its decorations: what a comment's chip holds. */
export interface ConventionalHead {
  label: Label;
  /** As written, in their order; one the menu does not offer is kept. */
  decorations: string[];
}

/** A comment whose first line is a conventional head and a subject. */
export interface ConventionalComment extends ConventionalHead {
  /** The first line after `: `, trimmed. */
  subject: string;
  /** The lines after the first, as written. */
  discussion: string;
}

const DECORATION = /^[A-Za-z0-9-]+$/;

function labelOf(word: string): Label | null {
  const lower = word.toLowerCase();
  return LABELS.find((label) => label === lower) ?? null;
}

/** The head the words `head` name (no colon), or null. */
export function parseHead(head: string): ConventionalHead | null {
  const space = head.indexOf(" ");
  if (space === -1) {
    const label = labelOf(head);
    return label === null ? null : { label, decorations: [] };
  }
  const label = labelOf(head.slice(0, space));
  const rest = head.slice(space + 1);
  if (label === null || !rest.startsWith("(") || !rest.endsWith(")")) {
    return null;
  }
  const decorations = rest.slice(1, -1).split(", ");
  return decorations.every((d) => DECORATION.test(d))
    ? { label, decorations }
    : null;
}

/**
 * The head `text` opens with, up to and with its `: `, and where the words
 * after it start; null when the first line does not open with one. A head
 * whose colon is not yet followed by a space is still being typed.
 */
export function matchHead(
  text: string,
): { head: ConventionalHead; end: number } | null {
  const newline = text.indexOf("\n");
  const line = newline === -1 ? text : text.slice(0, newline);
  const colon = line.indexOf(": ");
  if (colon === -1) {
    return null;
  }
  const head = parseHead(line.slice(0, colon));
  return head === null ? null : { head, end: colon + 2 };
}

/** The conventional comment `text` is, or null when it is plain text. */
export function parseConventional(text: string): ConventionalComment | null {
  const match = matchHead(text);
  if (match === null) {
    return null;
  }
  const newline = text.indexOf("\n");
  const first = newline === -1 ? text : text.slice(0, newline);
  const subject = first.slice(match.end).trim();
  if (subject === "") {
    return null;
  }
  return {
    ...match.head,
    subject,
    discussion: newline === -1 ? "" : text.slice(newline + 1),
  };
}

/** Whether a head blocks: it carries `blocking`, in any case. */
export function isBlocking(head: ConventionalHead): boolean {
  return hasDecoration(head, "blocking");
}

/** A head as it is written before the colon: `question (non-blocking)`. */
export function formatHead(head: ConventionalHead): string {
  return head.decorations.length === 0
    ? head.label
    : `${head.label} (${head.decorations.join(", ")})`;
}

/**
 * The text a comment box sends: the head, then the person's words, whose
 * first line is the subject. Without a head, the words alone.
 */
export function composeComment(
  head: ConventionalHead | null,
  words: string,
): string {
  const text = words.trim();
  return head === null ? text : `${formatHead(head)}: ${text}`;
}

/**
 * `decorations` with `decoration` switched: on at the end, or off. Blocking
 * and non-blocking exclude each other, so turning one on takes the other off.
 * A decoration is compared in any case, as {@link isBlocking} reads it.
 */
export function toggleDecoration(
  decorations: readonly string[],
  decoration: string,
): string[] {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (decorations.some((d) => same(d, decoration))) {
    return decorations.filter((d) => !same(d, decoration));
  }
  const other =
    decoration === "blocking"
      ? "non-blocking"
      : decoration === "non-blocking"
        ? "blocking"
        : null;
  return [
    ...decorations.filter((d) => other === null || !same(d, other)),
    decoration,
  ];
}

/** Whether `head` carries `decoration`, in any case. */
export function hasDecoration(
  head: ConventionalHead,
  decoration: string,
): boolean {
  return head.decorations.some(
    (d) => d.toLowerCase() === decoration.toLowerCase(),
  );
}
