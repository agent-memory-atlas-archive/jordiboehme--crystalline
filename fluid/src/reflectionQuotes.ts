/**
 * From a rendered selection to a quote the engine can find, and from a found
 * quote back to the rendered words.
 *
 * A comment is anchored on a section and a passage of its SOURCE text (core
 * `resolve_anchor` searches the section's markdown, markers and all). What a
 * person selects is rendered text. `MarkdownBody` with `sourceSpans` wraps
 * every text node it could place in `<span data-src="<offset>">`, so each end
 * of a selection has an offset into the section text, and the slice between
 * them is the quote. The way back paints with the CSS Custom Highlight API,
 * which styles ranges without touching the DOM React owns.
 *
 * Where an end cannot be placed, the answer is a comment on the section with
 * no quote. A quote that is only probably right would anchor a person's
 * words to the wrong passage, which is worse than anchoring them to the
 * section they were in.
 */

import { occurrenceAt } from "./reflectionText";
import type { SectionText } from "./reflectionText";

export const SOURCE_ATTR = "data-src";
export const SECTION_ATTR = "data-section";
export const QUOTE_HIGHLIGHT = "reflection-quote";
export const ACTIVE_HIGHLIGHT = "reflection-quote-active";

/**
 * Where a parsed text node starts in `source`, or null when its words are
 * not one piece of it (an escape, an entity, a quote marker or an indent on
 * a continuation line). Inline code and similar nodes whose value sits
 * inside markup are found inside their own span of the source. Whatever it
 * answers, `source.slice(base, base + value.length)` is `value`.
 */
export function spanBase(
  source: string,
  start: number | undefined,
  end: number | undefined,
  value: string,
): number | null {
  if (start === undefined || end === undefined || value === "") {
    return null;
  }
  const slice = source.slice(start, end);
  if (slice === value) {
    return start;
  }
  const at = slice.indexOf(value);
  return at >= 0 ? start + at : null;
}

/** A line break, as the parser keeps it in a text value. */
const LINE_BREAK = /\r\n|\r|\n/g;

/** What a continuation line may start with in the source and not in the value. */
const LINE_PREFIX = /^[ \t>]*/;

/** One piece of a parsed text node: its words and their offset, or null for unplaced. */
export interface SpanPiece {
  value: string;
  base: number | null;
}

/**
 * A parsed text node cut into pieces that each sit in `source` in one piece.
 * One piece when {@link spanBase} places the whole node. Otherwise the node
 * is cut at its line breaks: a hard-wrapped list item, a blockquote or an
 * indented continuation loses its line prefix (`  `, `> `) in the value, so
 * each line is placed on its own after the prefix, and the line breaks
 * between them stay unplaced. The first line that cannot be placed ends it:
 * that line and the rest are one unplaced piece. Every placed piece holds
 * `source.slice(base, base + value.length) === value`.
 */
export function spanPieces(
  source: string,
  start: number | undefined,
  end: number | undefined,
  value: string,
): SpanPiece[] {
  const whole = spanBase(source, start, end, value);
  if (whole !== null || start === undefined || end === undefined) {
    return [{ value, base: whole }];
  }
  const pieces: SpanPiece[] = [];
  let cursor = start;
  let taken = 0;
  const lines = [...value.matchAll(LINE_BREAK)];
  for (let i = 0; i <= lines.length; i += 1) {
    const brk = lines[i];
    const lineEnd = brk === undefined ? value.length : brk.index;
    const line = value.slice(taken, lineEnd);
    if (i > 0) {
      cursor += (LINE_PREFIX.exec(source.slice(cursor, end))?.[0] ?? "").length;
    }
    if (line !== "") {
      if (!source.startsWith(line, cursor) || cursor + line.length > end) {
        break;
      }
      pieces.push({ value: line, base: cursor });
      cursor += line.length;
    }
    taken = lineEnd;
    if (brk === undefined) {
      return pieces;
    }
    // Spaces the parser trimmed before the break are in the source only.
    cursor += (/^[ \t]*/.exec(source.slice(cursor, end))?.[0] ?? "").length;
    if (!source.startsWith(brk[0], cursor)) {
      break;
    }
    pieces.push({ value: brk[0], base: null });
    cursor += brk[0].length;
    taken += brk[0].length;
  }
  if (taken < value.length) {
    pieces.push({ value: value.slice(taken), base: null });
  }
  return pieces;
}

/** The element a DOM point sits in: the parent of a text node, else the node. */
function elementOf(node: Node): Element | null {
  return node.nodeType === Node.TEXT_NODE
    ? node.parentElement
    : (node as Element);
}

/** The stamped span holding `node`, or null. */
function stampOf(node: Node): Element | null {
  return elementOf(node)?.closest(`[${SOURCE_ATTR}]`) ?? null;
}

/** The source offset a stamped span starts at, or null. */
function baseOf(span: Element): number | null {
  const base = Number(span.getAttribute(SOURCE_ATTR));
  return Number.isInteger(base) && base >= 0 ? base : null;
}

/** The source offset of a DOM point inside `scope`, or null when it is not in a stamped span. */
export function sourceOffset(
  scope: Element,
  node: Node,
  offset: number,
): number | null {
  const span = stampOf(node);
  if (!span || !scope.contains(span)) {
    return null;
  }
  const base = baseOf(span);
  if (base === null) {
    return null;
  }
  const before = document.createRange();
  before.setStart(span, 0);
  before.setEnd(node, offset);
  return base + before.toString().length;
}

export interface SelectionAnchor {
  /** The section's id, `_top`, or its heading when it has no id yet. */
  section: string;
  heading: string;
  /** Null when the passage could not be placed: a comment on the section. */
  quote: string | null;
  occurrence: number | null;
}

/** The section element holding `node` inside `root`, or null. */
function sectionOf(root: Element, node: Node): Element | null {
  const found = elementOf(node)?.closest(`[${SECTION_ATTR}]`) ?? null;
  return found !== null && root.contains(found) ? found : null;
}

interface Point {
  node: Node;
  offset: number;
}

/** Every non-empty text node under `root`, in document order. */
function textsIn(root: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).length > 0) {
      out.push(node as Text);
    }
  }
  return out;
}

/**
 * The nearest placed words from a boundary, looking forward (`start`) or
 * back (`end`). Whitespace the renderer put between blocks is passed over;
 * any other unplaced text stops the search, so a selection is never quietly
 * shrunk past words it covered.
 */
function nearestPlaced(
  root: Element,
  at: Point,
  edge: "start" | "end",
): Point | null {
  const probe = document.createRange();
  probe.setStart(at.node, at.offset);
  const texts = textsIn(root);
  if (edge === "end") {
    texts.reverse();
  }
  for (const text of texts) {
    if (text === at.node) {
      continue;
    }
    const side =
      edge === "start"
        ? probe.comparePoint(text, 0)
        : -probe.comparePoint(text, text.length);
    if (side < 0) {
      continue;
    }
    if (stampOf(text) !== null) {
      return edge === "start"
        ? { node: text, offset: 0 }
        : { node: text, offset: text.length };
    }
    if (text.data.trim() !== "") {
      return null;
    }
  }
  return null;
}

/** Whether a point is in text the renderer left unplaced and that says nothing. */
function isBlankUnplaced(node: Node): boolean {
  return (
    node.nodeType === Node.TEXT_NODE &&
    stampOf(node) === null &&
    (node.textContent ?? "").trim() === ""
  );
}

/**
 * One end of a selection as a point in text. A boundary between elements
 * (where a triple click or a drag across blocks puts one) becomes the
 * nearest placed words in its direction.
 */
function textPoint(
  root: Element,
  at: Point,
  edge: "start" | "end",
): Point | null {
  if (at.node.nodeType === Node.TEXT_NODE && !isBlankUnplaced(at.node)) {
    return at;
  }
  return nearestPlaced(root, at, edge);
}

/** Whether a text point sits at the far edge of its node: the end for a start, the start for an end. */
function atEdge(at: Point, edge: "start" | "end"): boolean {
  return (
    at.node.nodeType === Node.TEXT_NODE &&
    (edge === "start"
      ? at.offset === (at.node.textContent ?? "").length
      : at.offset === 0)
  );
}

/**
 * Whether a stamped span still is what the stamp made: one text node that
 * reads what the source holds at its offset. A later pass that rewrote the
 * words inside it (a wikilink turned into its label) fails both tests.
 */
function spanTrue(span: Element, text: string): boolean {
  const base = baseOf(span);
  const only = span.firstChild;
  if (
    base === null ||
    span.childNodes.length !== 1 ||
    only === null ||
    only.nodeType !== Node.TEXT_NODE
  ) {
    return false;
  }
  const words = only.textContent ?? "";
  return text.slice(base, base + words.length) === words;
}

/** Whether the stamped span holding `node` is true to the source. */
function trueToSource(node: Node, text: string): boolean {
  const span = stampOf(node);
  return span !== null && spanTrue(span, text);
}

/** What a comment on this selection anchors on, or null for no comment at all. */
export function selectionAnchor(
  root: Element,
  range: Range | null,
  sections: readonly SectionText[],
): SelectionAnchor | null {
  if (range === null || range.collapsed) {
    return null;
  }
  let from = textPoint(
    root,
    { node: range.startContainer, offset: range.startOffset },
    "start",
  );
  let to = textPoint(
    root,
    { node: range.endContainer, offset: range.endOffset },
    "end",
  );
  if (from === null || to === null) {
    // The boundary had no words near it: read the section off the raw ends.
    from ??= { node: range.startContainer, offset: range.startOffset };
    to ??= { node: range.endContainer, offset: range.endOffset };
  }
  // An end at the very edge of its text that lands in another section or in
  // unplaced words (a drag that began at the end of the line above) is
  // moved to the nearest placed words inside the selection.
  const spills = (at: Point, other: Point) =>
    sectionOf(root, at.node) !== sectionOf(root, other.node) ||
    stampOf(at.node) === null;
  if (atEdge(from, "start") && spills(from, to)) {
    from = nearestPlaced(root, from, "start") ?? from;
  }
  if (atEdge(to, "end") && spills(to, from)) {
    to = nearestPlaced(root, to, "end") ?? to;
  }
  const first = sectionOf(root, from.node);
  const last = sectionOf(root, to.node);
  if (first === null || first !== last) {
    return null;
  }
  const key = first.getAttribute(SECTION_ATTR) ?? "";
  const section = sections.find((s) => (s.id ?? s.heading) === key);
  if (section === undefined) {
    return null;
  }
  const bare = {
    section: key,
    heading: section.heading,
    quote: null,
    occurrence: null,
  };
  if (
    !trueToSource(from.node, section.text) ||
    !trueToSource(to.node, section.text)
  ) {
    return bare;
  }
  const start = sourceOffset(first, from.node, from.offset);
  const end = sourceOffset(first, to.node, to.offset);
  if (start === null || end === null || end <= start) {
    return bare;
  }
  const quote = section.text.slice(start, end);
  if (quote.trim() === "") {
    return bare;
  }
  return {
    section: key,
    heading: section.heading,
    quote,
    occurrence: occurrenceAt(section.text, quote, start),
  };
}

/** The DOM point `left` characters into a stamped span. */
function pointIn(span: Element, left: number): Point | null {
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const size = (node.textContent ?? "").length;
    if (left <= size) {
      return { node, offset: left };
    }
    left -= size;
  }
  return null;
}

/**
 * The DOM point for a source offset inside `scope`, and the offset it
 * really stands for. An offset on markup the page does not show (the `**`
 * around a word, a link's target) moves to the nearest shown words inside
 * the range: forward for a start, back for an end.
 */
function pointAt(
  spans: readonly Element[],
  offset: number,
  edge: "start" | "end",
): { point: Point; at: number } | null {
  let near: { span: Element; at: number } | null = null;
  for (const span of spans) {
    const base = baseOf(span);
    if (base === null) {
      continue;
    }
    const length = (span.textContent ?? "").length;
    if (offset >= base && offset <= base + length) {
      const point = pointIn(span, offset - base);
      return point === null ? null : { point, at: offset };
    }
    if (
      edge === "start" &&
      base > offset &&
      (near === null || base < near.at)
    ) {
      near = { span, at: base };
    }
    const tail = base + length;
    if (edge === "end" && tail < offset && (near === null || tail > near.at)) {
      near = { span, at: tail };
    }
  }
  if (near === null) {
    return null;
  }
  const length = (near.span.textContent ?? "").length;
  const point = pointIn(near.span, edge === "start" ? 0 : length);
  return point === null ? null : { point, at: near.at };
}

/**
 * The rendered words between two source offsets of `text` (the section text
 * the page rendered), or null when they are not on the page. Null as well
 * when any stamped span the range would cover is no longer true to `text`:
 * counting rendered characters as source characters there would paint a
 * shifted passage, and no paint is better than a wrong one.
 */
export function domRange(
  scope: Element,
  start: number,
  end: number,
  text: string,
): Range | null {
  const spans = Array.from(scope.querySelectorAll(`[${SOURCE_ATTR}]`));
  for (const span of spans) {
    const base = baseOf(span);
    const length = (span.textContent ?? "").length;
    const covered = base !== null && base <= end && base + length >= start;
    if (covered && !spanTrue(span, text)) {
      return null;
    }
  }
  const from = pointAt(spans, start, "start");
  const to = pointAt(spans, end, "end");
  if (from === null || to === null || from.at >= to.at) {
    return null;
  }
  const range = document.createRange();
  range.setStart(from.point.node, from.point.offset);
  range.setEnd(to.point.node, to.point.offset);
  return range;
}

interface HighlightHost {
  CSS?: { highlights?: Map<string, unknown> };
  Highlight?: new (...ranges: Range[]) => unknown;
}

/**
 * Paint the quotes, the active one a second time on top. Answers the undo.
 * A browser without the registry paints nothing and loses nothing: every
 * thread still shows its quote as text in the threads column.
 */
export function paintQuotes(
  quotes: readonly Range[],
  active: readonly Range[],
): () => void {
  const host = globalThis as unknown as HighlightHost;
  const registry = host.CSS?.highlights;
  const Make = host.Highlight;
  if (registry === undefined || Make === undefined) {
    return () => undefined;
  }
  registry.set(QUOTE_HIGHLIGHT, new Make(...quotes));
  registry.set(ACTIVE_HIGHLIGHT, new Make(...active));
  return () => {
    registry.delete(QUOTE_HIGHLIGHT);
    registry.delete(ACTIVE_HIGHLIGHT);
  };
}

/** Whether the character at `i` is whitespace or past either end. */
function blank(text: string, i: number): boolean {
  return i < 0 || i >= text.length || /\s/.test(text.charAt(i));
}

/** Whether the character at `i` is a letter or digit. */
function wordChar(text: string, i: number): boolean {
  return /[\p{L}\p{N}]/u.test(text.charAt(i));
}

/** Whether the character at `i` follows an odd number of backslashes. */
function escaped(text: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && text.charAt(j) === "\\"; j -= 1) {
    n += 1;
  }
  return n % 2 === 1;
}

/** Two delimiters that belong together: each a `[start, end)` range. */
type Pair = [[number, number], [number, number]];

/**
 * The markup pairs of a section text, found the simple way: code spans
 * (backtick runs of one length), emphasis and strike (`*`, `_` and `~~`
 * runs, one opening where a word follows and closing where a word
 * precedes; `_` between two letters is part of a word) and links and
 * images (`[` or `![` with `](destination)`). Nothing inside a code span
 * and nothing after an odd number of backslashes counts. A marker with no
 * partner is text.
 */
function markupPairs(text: string): Pair[] {
  const pairs: Pair[] = [];
  const code: [number, number][] = [];
  // A backslash escapes an opening tick only: inside a code span it is
  // text, so `a\` is a code span.
  const ticks = [...text.matchAll(/`+/g)];
  for (let i = 0; i < ticks.length; i += 1) {
    const open = ticks[i];
    if (open === undefined || escaped(text, open.index)) {
      continue;
    }
    const j = ticks.findIndex(
      (m, k) => k > i && m[0].length === open[0].length,
    );
    const close = ticks[j];
    if (close === undefined) {
      continue;
    }
    const a: [number, number] = [open.index, open.index + open[0].length];
    const b: [number, number] = [close.index, close.index + close[0].length];
    pairs.push([a, b]);
    code.push([a[0], b[1]]);
    i = j;
  }
  const inCode = (at: number) => code.some(([a, b]) => at >= a && at < b);

  const stack: { run: string; at: number }[] = [];
  for (const match of text.matchAll(/([*_~])\1*/g)) {
    const run = match[0];
    const at = match.index;
    const end = at + run.length;
    if (inCode(at) || escaped(text, at)) {
      continue;
    }
    if (run.startsWith("~") && run.length !== 2) {
      continue;
    }
    if (run.startsWith("_") && wordChar(text, at - 1) && wordChar(text, end)) {
      continue;
    }
    const opens = !blank(text, end);
    const closes = !blank(text, at - 1);
    const partner = stack.findLastIndex((o) => o.run === run);
    const open = stack[partner];
    if (closes && open !== undefined) {
      // Openers between the two never closed: they are text.
      stack.splice(partner);
      pairs.push([
        [open.at, open.at + run.length],
        [at, end],
      ]);
    } else if (opens) {
      stack.push({ run, at });
    }
  }

  const brackets: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if ((c !== "[" && c !== "]") || inCode(i) || escaped(text, i)) {
      continue;
    }
    if (c === "[") {
      brackets.push(i);
      continue;
    }
    const open = brackets.pop();
    const close = text.charAt(i + 1) === "(" ? text.indexOf(")", i + 2) : -1;
    if (open === undefined || close < 0) {
      continue;
    }
    const image =
      open > 0 && text.charAt(open - 1) === "!" && !escaped(text, open - 1);
    pairs.push([
      [image ? open - 1 : open, open + 1],
      [i, close + 1],
    ]);
  }
  return pairs;
}

/**
 * The quote at `[start, end)` of `text` (the section text it was found in)
 * as a person is shown it: a marker or link part whose partner the quote
 * cut off is left out (`at** night` reads `at night`). Markup the quote
 * holds whole, code spans, escapes and markers with no partner stay as
 * they are. For display only: the stored quote is what the engine finds,
 * so it is never changed. A quote that would show nothing is shown as is.
 */
export function displayQuote(text: string, start: number, end: number): string {
  const raw = text.slice(start, end);
  const inside = ([a, b]: [number, number]) => a >= start && b <= end;
  const cut: [number, number][] = [];
  for (const pair of markupPairs(text)) {
    if (pair.every(inside)) {
      continue;
    }
    for (const [a, b] of pair) {
      const from = Math.max(a, start);
      const to = Math.min(b, end);
      if (from < to) {
        cut.push([from, to]);
      }
    }
  }
  cut.sort((x, y) => x[0] - y[0]);
  let out = "";
  let at = start;
  for (const [from, to] of cut) {
    if (from > at) {
      out += text.slice(at, from);
    }
    at = Math.max(at, to);
  }
  out += text.slice(at, end);
  return out.trim() === "" ? raw : out;
}
