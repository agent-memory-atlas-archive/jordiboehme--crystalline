/**
 * On paper a heading is never the last line of a page: each top-level
 * heading and the block right after it are wrapped in one
 * `<div data-keep>`, which the print sheet lays out as a block that may not
 * break (`index.css`). On screen the wrapper is `display: contents`, so it
 * draws no box and moves nothing.
 *
 * A block that would make the pair taller than about half a page is left
 * out (a long table, a long list, a picture whose height is not known yet):
 * keeping it with its heading could leave a page half empty, or a pair
 * taller than the page. Its heading then keeps only its own lines together.
 *
 * It also marks a table short enough to keep on one page (`data-short`).
 *
 * Only the document's own top level is grouped; a heading inside a callout
 * or a list stays where it is. It runs last in the chain, after the plugins
 * that read headings and their neighbours.
 */

interface Node {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
  value?: string;
}

/** The attribute the wrapper carries; the print sheet keys on it. */
export const KEEP_ATTR = "data-keep";

/** About half an A4 page of body text, in lines. */
const HALF_PAGE_LINES = 24;

/** Characters on one printed line of body text, roughly. */
const LINE_CHARS = 95;

const HEADING = /^h[1-6]$/;

function textOf(node: Node): string {
  return node.type === "text"
    ? (node.value ?? "")
    : (node.children ?? []).map(textOf).join("");
}

function elements(node: Node, tag: string): Node[] {
  const found: Node[] = [];
  const walk = (n: Node) => {
    if (n.type === "element" && n.tagName === tag) {
      found.push(n);
    }
    (n.children ?? []).forEach(walk);
  };
  walk(node);
  return found;
}

/**
 * How many printed lines a block takes, roughly, or null when it cannot be
 * told before it is drawn (a picture).
 */
export function linesOf(node: Node): number | null {
  if (elements(node, "img").length > 0) {
    return null;
  }
  switch (node.tagName) {
    case "table":
      return elements(node, "tr").length * 1.6;
    case "ul":
    case "ol":
      return elements(node, "li").reduce(
        (sum, item) =>
          sum + Math.max(1, Math.ceil(textOf(item).length / LINE_CHARS)),
        0,
      );
    case "pre": {
      const source = textOf(node);
      // A diagram draws taller than its source reads.
      const factor = /language-mermaid/.test(
        JSON.stringify(node.children?.[0]?.properties ?? {}),
      )
        ? 2.5
        : 1;
      return source.split("\n").length * factor + 1;
    }
    default:
      return Math.max(1, Math.ceil(textOf(node).length / LINE_CHARS)) + 1;
  }
}

/** A node between two blocks that draws nothing: a line break or a comment. */
function between(node: Node): boolean {
  return (
    (node.type === "text" && textOf(node).trim() === "") ||
    node.type === "comment" ||
    (node.type === "raw" && (node.value ?? "").trim().startsWith("<!--"))
  );
}

/** Rows a table may have and still be kept on one page whole. */
const SHORT_TABLE_ROWS = 25;

export function keepWithNext() {
  return (tree: unknown) => {
    const root = tree as Node;
    // A short table prints on one page; a long one breaks between rows.
    for (const table of elements(root, "table")) {
      if (elements(table, "tr").length <= SHORT_TABLE_ROWS) {
        table.properties = { ...table.properties, dataShort: "" };
      }
    }
    const kids = root.children ?? [];
    const out: Node[] = [];
    for (let i = 0; i < kids.length; i += 1) {
      const kid = kids[i]!;
      if (kid.type !== "element" || !HEADING.test(kid.tagName ?? "")) {
        out.push(kid);
        continue;
      }
      // The next element, past the line breaks between blocks and a hidden
      // comment (a Reflection section's id line).
      let j = i + 1;
      while (j < kids.length && between(kids[j]!)) {
        j += 1;
      }
      const next = kids[j];
      const lines = next?.type === "element" ? linesOf(next) : null;
      if (
        next === undefined ||
        next.type !== "element" ||
        HEADING.test(next.tagName ?? "") ||
        lines === null ||
        lines > HALF_PAGE_LINES
      ) {
        out.push(kid);
        continue;
      }
      out.push({
        type: "element",
        tagName: "div",
        properties: { [KEEP_ATTR]: "" },
        children: kids.slice(i, j + 1),
      });
      i = j;
    }
    root.children = out;
  };
}
