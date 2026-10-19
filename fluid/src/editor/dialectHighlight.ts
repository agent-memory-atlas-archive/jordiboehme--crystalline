/**
 * The dialect's constructs, taught to the editor grammar: the `[!KIND]` that
 * opens a callout, the `:status[Label]{colour}` label and `$$...$$` math on
 * one line.
 *
 * Without this the markdown parser reads both brackets as a link (it cannot
 * know there is no reference definition), and the buffer paints `[!NOTE]` and
 * `[Done]` underlined in the link colour. As nodes of their own the markers
 * wear the token class every other markup mark wears (a heading's `#`, a
 * quote's `>`), in the buffer and in the diff pane, which share this grammar.
 * The previews and the format bar's context segment read the same nodes, so
 * the three agree on where an element is.
 *
 * Read the way the reading page reads them (`markdown/callouts.ts`,
 * `markdown/directives.ts`, `markdown/math.ts`):
 *
 * - A callout marker is taken only at the start of a paragraph that stands
 *   directly in a quote, only for the six kinds in any case, and never when
 *   a `(` follows its `]`, which keeps `[!note](url)` a link. A paragraph,
 *   heading, list item or table cell elsewhere that starts with `[!NOTE]` is
 *   left to the markdown parser. The grammar asks only the public parent
 *   type, so a later paragraph of a quote that starts with a marker is
 *   marked too; that is the colour of the marker and nothing more, because
 *   everything that acts on a callout (`calloutOf`) asks for the quote's
 *   first paragraph, as the reading page does.
 * - A label needs at least one word, and only `:status[` starts one.
 * - Inline math opens with two or more dollar signs and closes with the same
 *   run on the same line. Code that starts first is code; a single dollar
 *   sign is never math.
 */

import type { markdown } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";

import { CALLOUT_KINDS } from "../markdown/callouts";
import { labelEnd } from "../markdown/statusText";

/** The parser extension type `markdown()` takes, named without the package. */
type MarkdownExtension = NonNullable<
  NonNullable<Parameters<typeof markdown>[0]>["extensions"]
>;

/** The small part of the inline context the inline parsers use. */
interface Inline {
  readonly offset: number;
  readonly end: number;
  char(pos: number): number;
  slice(from: number, to: number): string;
  elt(type: string, from: number, to: number, children?: unknown[]): unknown;
  addElement(element: unknown): number;
}

/** The small part of the block context the callout parser uses. */
interface Block {
  parentType(): { name: string };
  elt(type: string, from: number, to: number, children?: unknown[]): unknown;
  addLeafElement(leaf: Leaf, element: unknown): void;
  parser: { parseInline(text: string, offset: number): unknown[] };
}

/** A paragraph as the block parser hands it over. */
interface Leaf {
  start: number;
  content: string;
}

const COLON = 58;
const DOLLAR = 36;
const LINE_FEED = 10;
const OPEN_PAREN = "(";

/** `[!WORD]` and an optional fold sign. */
const CALLOUT_MARK = /^\[!([A-Za-z0-9_-]+)\][+-]?/;

/** The opening of a label, the only directive this dialect has. */
export const STATUS_OPEN = ":status[";

/**
 * A whole label at the start of `text`: words up to their balanced `]` (the
 * way the reader and core close it), then optional braces, on one line. The
 * length of the whole label and of its words, or null.
 */
export function statusLabelAt(
  text: string,
): { length: number; words: number } | null {
  if (!text.startsWith(STATUS_OPEN)) {
    return null;
  }
  const close = labelEnd(text, STATUS_OPEN.length);
  const words = close - STATUS_OPEN.length;
  // A label of nothing but spaces is text, as the reader reads it.
  if (close === -1 || text.slice(STATUS_OPEN.length, close).trim() === "") {
    return null;
  }
  const braces = /^\{[^}\n]*\}/.exec(text.slice(close + 1));
  return { length: close + 1 + (braces?.[0].length ?? 0), words };
}

/** The marker at the start of `content`, or null when it is no callout's. */
function calloutMarkIn(content: string): number | null {
  const head = CALLOUT_MARK.exec(content);
  const kind = head?.[1]?.toLowerCase();
  if (
    head === null ||
    kind === undefined ||
    !(CALLOUT_KINDS as readonly string[]).includes(kind)
  ) {
    return null;
  }
  // `[!note](url)` is a link.
  if (content[content.indexOf("]") + 1] === OPEN_PAREN) {
    return null;
  }
  return head[0].length;
}

/** The paragraph that opens a callout: its marker, then its words as usual. */
class CalloutHeadParser {
  readonly length: number;

  constructor(length: number) {
    this.length = length;
  }

  nextLine(): boolean {
    return false;
  }

  finish(cx: Block, leaf: Leaf): boolean {
    cx.addLeafElement(
      leaf,
      cx.elt("Paragraph", leaf.start, leaf.start + leaf.content.length, [
        cx.elt("CalloutMark", leaf.start, leaf.start + this.length),
        ...cx.parser.parseInline(
          leaf.content.slice(this.length),
          leaf.start + this.length,
        ),
      ]),
    );
    return true;
  }
}

export const dialectGrammar = {
  defineNodes: [
    { name: "CalloutMark", style: tags.processingInstruction },
    { name: "StatusLabel" },
    { name: "StatusMark", style: tags.processingInstruction },
    { name: "InlineMath" },
    { name: "MathMark", style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: "CalloutHead",
      leaf(cx: Block, leaf: Leaf): CalloutHeadParser | null {
        const length = calloutMarkIn(leaf.content);
        if (length === null || cx.parentType().name !== "Blockquote") {
          return null;
        }
        return new CalloutHeadParser(length);
      },
      after: "SetextHeading",
    },
  ],
  parseInline: [
    {
      name: "InlineMath",
      before: "InlineCode",
      parse(cx: Inline, next: number, pos: number): number {
        // A run is read from its first sign only.
        if (
          next !== DOLLAR ||
          (pos > cx.offset && cx.char(pos - 1) === DOLLAR)
        ) {
          return -1;
        }
        let run = 0;
        while (cx.char(pos + run) === DOLLAR) {
          run += 1;
        }
        if (run < 2) {
          return -1;
        }
        for (let at = pos + run; at < cx.end; at += 1) {
          const code = cx.char(at);
          if (code === LINE_FEED) {
            return -1;
          }
          if (code !== DOLLAR) {
            continue;
          }
          let close = 0;
          while (cx.char(at + close) === DOLLAR) {
            close += 1;
          }
          if (close === run && cx.slice(pos + run, at).trim() !== "") {
            return cx.addElement(
              cx.elt("InlineMath", pos, at + close, [
                cx.elt("MathMark", pos, pos + run),
                cx.elt("MathMark", at, at + close),
              ]),
            );
          }
          at += close - 1;
        }
        return -1;
      },
    },
    {
      name: "StatusLabel",
      before: "Link",
      parse(cx: Inline, next: number, pos: number): number {
        if (
          next !== COLON ||
          cx.slice(pos, Math.min(cx.end, pos + STATUS_OPEN.length)) !==
            STATUS_OPEN
        ) {
          return -1;
        }
        const label = statusLabelAt(cx.slice(pos, cx.end));
        if (label === null) {
          return -1;
        }
        const end = pos + label.length;
        const close = pos + STATUS_OPEN.length + label.words;
        return cx.addElement(
          cx.elt("StatusLabel", pos, end, [
            cx.elt("StatusMark", pos, pos + STATUS_OPEN.length),
            cx.elt("StatusMark", close, end),
          ]),
        );
      },
    },
  ],
} as unknown as MarkdownExtension;
