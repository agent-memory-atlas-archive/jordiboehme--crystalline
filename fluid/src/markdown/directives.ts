/**
 * Directives, after `remark-directive` has parsed them: `:status[Text]{colour}`
 * becomes a status label, and every other directive goes back to the text the
 * writer typed.
 *
 * Read the same way as the core lint Q006 reads a label: the palette below,
 * the colour matched without regard to case, no braces meaning grey. A colour
 * outside the palette is grey here and a warning there.
 *
 * Nothing else is a directive in this dialect, so a colon in prose (`10:30`,
 * `note:this`, `::toc`, a `:::note` block from other editors) must read as
 * typed. The text that replaces a directive is its own source slice at its own
 * position, so source spans on a Reflection page still read the source at
 * their offsets. A container directive keeps its parsed children: only its
 * marker lines become text, because an unclosed one runs to the end of the
 * document like an unclosed fence, and turning its body into one block of
 * literal text would flatten the rest of the page.
 */

import type { Root } from "./callouts";

export const STATUS_COLOURS = [
  "grey",
  "blue",
  "green",
  "yellow",
  "red",
  "purple",
] as const;

export type StatusColour = (typeof STATUS_COLOURS)[number];

/** The small part of the mdast shape this plugin reads and writes. */
interface Point {
  line: number;
  column: number;
  offset?: number;
}

interface Position {
  start: Point;
  end: Point;
}

interface MdNode {
  type: string;
  name?: string;
  value?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MdNode[];
  position?: Position;
  data?: Record<string, unknown>;
}

const DIRECTIVES = new Set([
  "textDirective",
  "leafDirective",
  "containerDirective",
]);

/** A line of colons and spaces only: the fence that closes a container. */
const CLOSING_FENCE = /^([ \t>]*)(:{3,}[ \t]*)$/;

function isColour(word: string): word is StatusColour {
  return (STATUS_COLOURS as readonly string[]).includes(word);
}

/** The colour a status label's attributes name: the first key, else grey. */
export function statusColour(attributes: MdNode["attributes"]): StatusColour {
  const first = Object.keys(attributes ?? {})[0]?.toLowerCase();
  return first !== undefined && isColour(first) ? first : "grey";
}

/** The source between two offsets, or null when a position is missing. */
function sliceOf(node: MdNode, source: string): string | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || end > source.length) {
    return null;
  }
  return source.slice(start, end);
}

function textNode(value: string, position: Position | undefined): MdNode {
  return position === undefined
    ? { type: "text", value }
    : { type: "text", value, position };
}

function paragraph(text: MdNode): MdNode {
  return text.position === undefined
    ? { type: "paragraph", children: [text] }
    : { type: "paragraph", children: [text], position: text.position };
}

/** `:status[...]`, with its brackets: a bare `:status` is no label. */
function isStatusLabel(node: MdNode, source: string): boolean {
  return (
    node.type === "textDirective" &&
    node.name === "status" &&
    (sliceOf(node, source)?.startsWith(":status[") ?? false)
  );
}

/** A container's opening line, and its closing line when the source has one. */
function markerLines(
  node: MdNode,
  slice: string,
): { open: MdNode; close: MdNode | null } {
  const start = node.position!.start;
  const startOffset = start.offset!;
  const firstBreak = slice.indexOf("\n");
  const openText = (
    firstBreak === -1 ? slice : slice.slice(0, firstBreak)
  ).replace(/\r$/, "");
  const open = textNode(openText, {
    start,
    end: {
      line: start.line,
      column: start.column + openText.length,
      offset: startOffset + openText.length,
    },
  });

  const lastBreak = slice.lastIndexOf("\n");
  const last =
    lastBreak === -1 ? null : CLOSING_FENCE.exec(slice.slice(lastBreak + 1));
  const lastChild = node.children?.at(-1)?.position?.end.offset;
  const lineStart = startOffset + lastBreak + 1;
  // Only a fence after the last child closes this container; a fence the
  // children end on belongs to them.
  if (last === null || (lastChild !== undefined && lastChild > lineStart)) {
    return { open, close: null };
  }
  const prefix = last[1]!.length;
  const closeText = last[2]!.trimEnd();
  const line = start.line + (slice.match(/\n/g)?.length ?? 0);
  const close = textNode(closeText, {
    start: { line, column: prefix + 1, offset: lineStart + prefix },
    end: {
      line,
      column: prefix + closeText.length + 1,
      offset: lineStart + prefix + closeText.length,
    },
  });
  return { open, close };
}

/** What stands in the parent's place of one unknown directive. */
function asText(node: MdNode, source: string): MdNode[] {
  const slice = sliceOf(node, source);
  if (node.type === "textDirective") {
    return [textNode(slice ?? `:${node.name ?? ""}`, node.position)];
  }
  if (node.type === "leafDirective") {
    return [
      paragraph(textNode(slice ?? `::${node.name ?? ""}`, node.position)),
    ];
  }
  // The label of a container is a paragraph the parser marks; it is part of
  // the opening line, which already holds it as text.
  const children = (node.children ?? []).filter(
    (child) => child.data?.directiveLabel !== true,
  );
  if (slice === null) {
    return [
      paragraph(textNode(`:::${node.name ?? ""}`, undefined)),
      ...children,
    ];
  }
  const { open, close } = markerLines(node, slice);
  return [
    paragraph(open),
    ...children,
    ...(close === null ? [] : [paragraph(close)]),
  ];
}

function walk(node: MdNode, source: string): void {
  if (!node.children) {
    return;
  }
  // Children first, so a container lifted into this node is already done.
  for (const child of node.children) {
    walk(child, source);
  }
  let replaced = false;
  const children = node.children.flatMap((child) => {
    if (!DIRECTIVES.has(child.type)) {
      return [child];
    }
    if (isStatusLabel(child, source)) {
      child.data = {
        ...child.data,
        hName: "span",
        hProperties: { "data-status": statusColour(child.attributes) },
      };
      return [child];
    }
    replaced = true;
    return asText(child, source);
  });
  node.children = replaced ? joinTexts(children) : children;
}

/**
 * Join text nodes that now stand side by side, so a `[[moon:Crater Base]]`
 * the parser cut at its colon is one text again for the wikilink rewrite.
 * The joined node spans both positions, or none when one of them has none.
 */
function joinTexts(children: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (const child of children) {
    const prev = out.at(-1);
    if (prev?.type !== "text" || child.type !== "text") {
      out.push(child);
      continue;
    }
    const start = prev.position?.start;
    const end = child.position?.end;
    out[out.length - 1] = textNode(
      (prev.value ?? "") + (child.value ?? ""),
      start === undefined || end === undefined ? undefined : { start, end },
    );
  }
  return out;
}

/**
 * The remark plugin, run after `remark-directive` on the text it parsed:
 * a status label becomes a `span` with `data-status`, its label words kept
 * with their positions, and every other directive goes back to its source.
 */
export function remarkCrystallineDirectives(
  source: string,
): () => (tree: Root) => void {
  return () => (tree) => {
    walk(tree, source);
  };
}
