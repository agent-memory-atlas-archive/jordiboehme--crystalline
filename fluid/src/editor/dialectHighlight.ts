/**
 * The dialect's two inline constructs, taught to the editor grammar: the
 * `[!KIND]` that opens a callout and the `:status[Label]{colour}` label.
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
 * `markdown/directives.ts`): a callout marker counts only at the very start
 * of a paragraph and only for the six kinds, in any case; a label needs at
 * least one word, and only `:status[` starts one. The grammar cannot see
 * whether a paragraph stands in a quote, so a `[!NOTE]` paragraph outside
 * one is marked too; everything that acts on a callout asks for the quote.
 */

import type { markdown } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";

import { CALLOUT_KINDS } from "../markdown/callouts";

/** The parser extension type `markdown()` takes, named without the package. */
type MarkdownExtension = NonNullable<
  NonNullable<Parameters<typeof markdown>[0]>["extensions"]
>;

/** The small part of the inline context the two parsers use. */
interface Inline {
  readonly offset: number;
  readonly end: number;
  slice(from: number, to: number): string;
  elt(type: string, from: number, to: number, children?: unknown[]): unknown;
  addElement(element: unknown): number;
}

const OPEN_BRACKET = 91;
const COLON = 58;

/** `[!WORD]` and an optional fold sign. */
const CALLOUT_MARK = /^\[!([A-Za-z0-9_-]+)\][+-]?/;

/** The opening of a label, the only directive this dialect has. */
export const STATUS_OPEN = ":status[";

/** A whole label: words, then optional braces, on one line. */
export const STATUS_LABEL = /^:status\[([^\]\n]+)\](?:\{([^}\n]*)\})?/;

/** The longest marker a kind can make, so a long paragraph is not sliced. */
const LONGEST_MARK =
  Math.max(...CALLOUT_KINDS.map((kind) => kind.length)) + "[!]+".length;

export const dialectGrammar = {
  defineNodes: [
    { name: "CalloutMark", style: tags.processingInstruction },
    { name: "StatusLabel" },
    { name: "StatusMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "CalloutMark",
      before: "Link",
      parse(cx: Inline, next: number, pos: number): number {
        if (next !== OPEN_BRACKET || pos !== cx.offset) {
          return -1;
        }
        const head = CALLOUT_MARK.exec(
          cx.slice(pos, Math.min(cx.end, pos + LONGEST_MARK)),
        );
        const kind = head?.[1]?.toLowerCase();
        if (
          head === null ||
          kind === undefined ||
          !(CALLOUT_KINDS as readonly string[]).includes(kind)
        ) {
          return -1;
        }
        return cx.addElement(cx.elt("CalloutMark", pos, pos + head[0].length));
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
        const label = STATUS_LABEL.exec(cx.slice(pos, cx.end));
        if (label === null) {
          return -1;
        }
        const end = pos + label[0].length;
        const close = pos + STATUS_OPEN.length + (label[1] ?? "").length;
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
