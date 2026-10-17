/**
 * Callouts: a blockquote whose first line is `[!KIND]`, with an optional
 * fold sign (`+` open, `-` closed) and an optional title after it.
 *
 * Read the same way as the core lint Q007 reads it: the marker stands at the
 * start of the first line of the quote, the kind is matched without regard
 * to case, and a kind outside the six below leaves the quote a plain quote.
 *
 * The plugin only names the element and strips the head. Every other node
 * keeps its place and its `position`, and the text node that held the head
 * starts where its remaining words start in the source, so source spans on
 * a Reflection page still read the source at their offsets.
 *
 * No React and no icons here: `ReflectionThreads` imports `REVEAL_EVENT`
 * from this module, and what a callout looks like is `Callout.tsx`.
 */

export type CalloutKind =
  "note" | "tip" | "important" | "warning" | "caution" | "details";

export const CALLOUT_KINDS: readonly CalloutKind[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
  "details",
];

/**
 * The event that asks the renderer to show an element a folded callout may
 * hide: dispatched on (or bubbling up from) the element, with the element as
 * `detail.target`. `MarkdownBody` opens every `<details>` around it.
 */
export const REVEAL_EVENT = "crystalline:reveal";

/** What a {@link REVEAL_EVENT} carries. */
export interface RevealDetail {
  target: Element;
}

/** What the head of a callout says. */
export interface CalloutHead {
  kind: CalloutKind;
  fold: "open" | "closed" | null;
  title: string | null;
}

/** `[!WORD]` at the start, the word in the characters core accepts. */
const MARKER = /^\[!([A-Za-z0-9_-]+)\]/;

function isKind(word: string): word is CalloutKind {
  return (CALLOUT_KINDS as readonly string[]).includes(word);
}

/** Read the first line of a quote: `[!KIND]`, optional `+`/`-`, optional title. */
export function parseCalloutHead(line: string): CalloutHead | null {
  const rest = line.trimStart();
  const match = MARKER.exec(rest);
  const kind = match?.[1]?.toLowerCase();
  if (!match || kind === undefined || !isKind(kind)) {
    return null;
  }
  let after = rest.slice(match[0].length);
  let fold: CalloutHead["fold"] = null;
  if (after.startsWith("+") || after.startsWith("-")) {
    fold = after.startsWith("+") ? "open" : "closed";
    after = after.slice(1);
  }
  const title = after.trim();
  return { kind, fold, title: title === "" ? null : title };
}

/** The small part of the mdast shape this plugin reads and writes. */
interface Point {
  line: number;
  column: number;
  offset?: number;
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: Point; end: Point };
  data?: Record<string, unknown>;
}

/** The root of an mdast tree, as far as this plugin needs it. */
export interface Root extends MdNode {
  type: "root";
}

/** A line break as the parser keeps it in a text value. */
const LINE_BREAK = /\r\n|\r|\n/;

/** What a continuation line may start with in the source and not in the value. */
const LINE_PREFIX = /^[ \t>]*/;

/** The plain words of an inline node and everything inside it. */
function plain(node: MdNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }
  return (node.children ?? []).map(plain).join("");
}

/**
 * Cut the first line out of a paragraph's inline children: its plain text,
 * and the children that are left once it is gone. A text node the line ends
 * in keeps the words after the break, and its start moves to where they are
 * in `source` (past the break and the next line's `> `), when there is a
 * source to find them in. An inline node that runs past the break (emphasis
 * opened on the first line and closed on the next) stays whole in the body,
 * so no word of the second line becomes part of the title.
 */
function cutFirstLine(
  children: MdNode[],
  source: string,
): { line: string; rest: MdNode[] } {
  let line = "";
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]!;
    if (child.type === "break") {
      return { line, rest: children.slice(i + 1) };
    }
    if (child.type !== "text") {
      const words = plain(child);
      if (LINE_BREAK.test(words)) {
        return { line, rest: children.slice(i) };
      }
      line += words;
      continue;
    }
    const value = child.value ?? "";
    const brk = LINE_BREAK.exec(value);
    if (brk === null) {
      line += value;
      continue;
    }
    line += value.slice(0, brk.index);
    const left = value.slice(brk.index + brk[0].length);
    const rest = children.slice(i + 1);
    if (left === "") {
      return { line, rest };
    }
    return { line, rest: [moved(child, left, source), ...rest] };
  }
  return { line, rest: [] };
}

/** `node` holding only `left`, its start moved to where `left` begins in `source`. */
function moved(node: MdNode, left: string, source: string): MdNode {
  const next: MdNode = { ...node, value: left };
  const start = node.position?.start;
  const end = node.position?.end;
  if (start?.offset === undefined || end?.offset === undefined) {
    return next;
  }
  const slice = source.slice(start.offset, end.offset);
  const brk = LINE_BREAK.exec(slice);
  if (brk === null) {
    // No source to read, or no break in it: the old start would be wrong.
    delete next.position;
    return next;
  }
  const lineStart = start.offset + brk.index + brk[0].length;
  const prefix = LINE_PREFIX.exec(source.slice(lineStart, end.offset))?.[0];
  const offset = lineStart + (prefix ?? "").length;
  if (!source.startsWith(left.split(LINE_BREAK)[0] ?? "", offset)) {
    // The words are not where they should be: no position beats a wrong one.
    delete next.position;
    return next;
  }
  next.position = {
    start: {
      line: start.line + 1,
      column: offset - lineStart + 1,
      offset,
    },
    end,
  };
  return next;
}

/** Turn `quote` into a callout when its first line is a callout head. */
function transformQuote(quote: MdNode, source: string): void {
  const first = quote.children?.[0];
  if (first?.type !== "paragraph" || !first.children) {
    return;
  }
  // An escaped marker (`> \[!NOTE]`) is the writer saying "not a callout",
  // and core's Q007 reads the raw source the same way.
  const opening = first.children[0]?.position?.start.offset;
  if (opening !== undefined && source[opening] === "\\") {
    return;
  }
  const { line, rest } = cutFirstLine(first.children, source);
  const head = parseCalloutHead(line);
  if (head === null) {
    return;
  }
  if (rest.length === 0) {
    quote.children = quote.children!.slice(1);
  } else {
    first.children = rest;
  }
  // A details callout folds even without a sign: closed until opened.
  const folded = head.fold ?? (head.kind === "details" ? "closed" : null);
  quote.data = {
    ...quote.data,
    hName: folded === null ? "aside" : "details",
    hProperties: {
      "data-callout": head.kind,
      "data-fold": folded ?? undefined,
      "data-title": head.title ?? undefined,
    },
  };
}

function walk(node: MdNode, source: string): void {
  if (node.type === "blockquote") {
    transformQuote(node, source);
  }
  for (const child of node.children ?? []) {
    walk(child, source);
  }
}

/** The remark plugin: every callout quote in the tree, nested ones included. */
export function remarkCallouts(): (
  tree: Root,
  file?: { value?: unknown },
) => void {
  // The source is the file's text; without it a moved text node keeps no
  // position rather than a guessed one.
  return (tree, file) => {
    walk(tree, typeof file?.value === "string" ? file.value : "");
  };
}
