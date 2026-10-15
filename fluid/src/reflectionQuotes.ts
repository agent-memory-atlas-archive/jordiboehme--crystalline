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

/** Whether a stamped span still reads what the source holds at its offset. */
function trueToSource(node: Node, text: string): boolean {
  const span = stampOf(node);
  const base = span === null ? null : baseOf(span);
  if (span === null || base === null) {
    return false;
  }
  const words = span.textContent ?? "";
  return text.slice(base, base + words.length) === words;
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
  scope: Element,
  offset: number,
  edge: "start" | "end",
): { point: Point; at: number } | null {
  let near: { span: Element; at: number } | null = null;
  for (const span of Array.from(scope.querySelectorAll(`[${SOURCE_ATTR}]`))) {
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

/** The rendered words between two source offsets, or null when they are not on the page. */
export function domRange(
  scope: Element,
  start: number,
  end: number,
): Range | null {
  const from = pointAt(scope, start, "start");
  const to = pointAt(scope, end, "end");
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
