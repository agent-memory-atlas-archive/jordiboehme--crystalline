/**
 * The live preview of the dialect's elements: off the lines a selection
 * touches, a callout, a status label, a colour code and math draw the way
 * the reading page draws them; on those lines the text shows as written. The
 * rule `preview.ts` keeps for headings and emphasis, applied to the elements
 * it does not know.
 *
 * - A callout's lines wear the page's `.callout` rule and tint, its `> `
 *   marks fold away, and its head marker becomes the head the page draws:
 *   the fold chevron, the kind's icon, and the kind word when no title is
 *   written (a title stays as text, set in the head's weight).
 * - A status label becomes the page's pill.
 * - A colour code in inline code gets the page's swatch before it.
 * - Inline math (`` $`...`$ ``) and display math (a `math` fence, a `$$`
 *   block) are set by KaTeX through the reading page's own lazy `MathPart`,
 *   so KaTeX loads only once a document holds math.
 *
 * Nothing here writes the document: every decoration is a view over the
 * bytes. Positions come from the syntax tree, whose dialect nodes
 * (`dialectHighlight.ts`) are read as the reading page reads the source, and
 * the callout and label readers are `elementContext.ts`'s, so the bar and the
 * preview agree on where an element is.
 *
 * Two layers, because CodeMirror takes a block decoration only from a state
 * field: the inline elements are a view plugin over the visible ranges, the
 * display math is a field over the whole document.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";

import { CALLOUT_ICONS, CALLOUT_WORDS } from "../components/calloutFace";
import { lazyPart } from "../components/lazyPart";
import type { CalloutKind } from "../markdown/callouts";
import type { StatusColour } from "../markdown/directives";
import { SWATCH_CLASSES, colourOf } from "../markdown/swatch";
import { calloutOf, statusOf } from "./elementContext";
import { frontmatterRegion } from "./frontmatterRegion";
import { parseAdvanced } from "./parseProgress";
import { CODE_CONTEXTS } from "./prose";

/** The reading page's formula part: its own chunk, KaTeX inside it. */
const MathPart = lazyPart(() => import("../components/MathPart"));

/** The React roots the widgets below draw into, by their element. */
const roots = new WeakMap<HTMLElement, Root>();

/**
 * Draw `element` into `dom`. Never synchronously: a widget can be drawn while
 * React is committing the screen that mounts the buffer, and the inline
 * pieces are one line tall whenever they land.
 */
function draw(dom: HTMLElement, element: ReactElement): void {
  const root = createRoot(dom);
  roots.set(dom, root);
  root.render(element);
}

/** Take a widget's React root down once the editor has let go of it. */
function undraw(dom: HTMLElement): void {
  const root = roots.get(dom);
  if (root !== undefined) {
    roots.delete(dom);
    // Never during a render React may be in the middle of.
    queueMicrotask(() => {
      root.unmount();
    });
  }
}

/** A callout's head as the page draws it, in place of its marker. */
class CalloutHeadWidget extends WidgetType {
  readonly kind: CalloutKind;
  readonly fold: "open" | "closed" | null;
  readonly titled: boolean;

  constructor(
    kind: CalloutKind,
    fold: "open" | "closed" | null,
    titled: boolean,
  ) {
    super();
    this.kind = kind;
    this.fold = fold;
    this.titled = titled;
  }

  override eq(other: CalloutHeadWidget): boolean {
    return (
      other.kind === this.kind &&
      other.fold === this.fold &&
      other.titled === this.titled
    );
  }

  override toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "cm-callout-head";
    const Icon = CALLOUT_ICONS[this.kind];
    const icon = {
      "aria-hidden": true,
      size: 16,
      className: "shrink-0 text-(--callout)",
    };
    draw(
      dom,
      createElement(
        "span",
        { className: "inline-flex items-center gap-1.5 align-[-0.15em]" },
        // The page's head: a chevron when it folds, the kind's icon unless
        // the kind is the fold itself, the word when nothing else names it.
        this.fold === null
          ? null
          : createElement(ChevronRight, {
              ...icon,
              key: "fold",
              className: `${icon.className} ${this.fold === "open" ? "rotate-90" : ""}`,
            }),
        this.fold !== null && this.kind === "details"
          ? null
          : createElement(Icon, { ...icon, key: "kind" }),
        this.titled
          ? null
          : createElement("span", { key: "word" }, CALLOUT_WORDS[this.kind]),
      ),
    );
    return dom;
  }

  override destroy(dom: HTMLElement): void {
    undraw(dom);
  }

  override ignoreEvent(): boolean {
    // A click is a click into the text: the caret lands on the head's line
    // and the marker shows as written.
    return false;
  }
}

/** A status label as the page's pill. */
class StatusWidget extends WidgetType {
  readonly label: string;
  readonly colour: StatusColour;

  constructor(label: string, colour: StatusColour) {
    super();
    this.label = label;
    this.colour = colour;
  }

  override eq(other: StatusWidget): boolean {
    return other.label === this.label && other.colour === this.colour;
  }

  override toDOM(): HTMLElement {
    const pill = document.createElement("span");
    pill.className = "status-label";
    pill.dataset["status"] = this.colour;
    pill.textContent = this.label;
    return pill;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** The page's swatch, before a colour code. */
class SwatchWidget extends WidgetType {
  readonly colour: string;

  constructor(colour: string) {
    super();
    this.colour = colour;
  }

  override eq(other: SwatchWidget): boolean {
    return other.colour === this.colour;
  }

  override toDOM(): HTMLElement {
    const swatch = document.createElement("span");
    swatch.dataset["swatch"] = "";
    swatch.setAttribute("aria-hidden", "true");
    swatch.className = SWATCH_CLASSES;
    swatch.style.background = this.colour;
    return swatch;
  }
}

/** A formula, set by the reading page's lazy part. */
class MathWidget extends WidgetType {
  readonly tex: string;
  readonly display: boolean;

  constructor(tex: string, display: boolean) {
    super();
    this.tex = tex;
    this.display = display;
  }

  override eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display;
  }

  override toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement(this.display ? "div" : "span");
    dom.className = this.display ? "cm-math-block" : "cm-math-inline";
    // The source as code until the part arrives, as on the page.
    const fallback = createElement("code", null, this.tex);
    draw(
      dom,
      createElement(MathPart, {
        fallback,
        tex: this.tex,
        display: this.display,
      }),
    );
    if (this.display) {
      // The formula is taller than its fallback: measure again once it lands.
      requestAnimationFrame(() => {
        view.requestMeasure();
      });
    }
    return dom;
  }

  override destroy(dom: HTMLElement): void {
    undraw(dom);
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** The line numbers any selection range touches. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let line = from; line <= to; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}

/** A quote's `> ` at the start of a line: the mark and one space after it. */
const QUOTE_PREFIX = /^>[ \t]?/;

function calloutDecorations(
  state: EditorState,
  quote: SyntaxNode,
  active: Set<number>,
  out: Range<Decoration>[],
): void {
  const callout = calloutOf(state, quote);
  if (callout === null) {
    return;
  }
  const doc = state.doc;
  const first = doc.lineAt(quote.from).number;
  const last = doc.lineAt(quote.to).number;
  // A details callout folds without a sign, as on the page.
  const fold =
    callout.fold ?? (callout.callout === "details" ? "closed" : null);
  // Only a callout that is not itself inside a quote loses its marks: an
  // inner one's line starts with its outer quote's mark.
  const outermost = quote.parent?.name === "Document";
  for (let number = first; number <= last; number += 1) {
    const line = doc.line(number);
    out.push(
      Decoration.line({
        class: "callout",
        attributes: { "data-callout": callout.callout },
      }).range(line.from),
    );
    if (!outermost || active.has(number)) {
      continue;
    }
    const prefix = QUOTE_PREFIX.exec(line.text);
    if (prefix !== null) {
      out.push(
        Decoration.replace({}).range(line.from, line.from + prefix[0].length),
      );
    }
  }
  if (active.has(callout.line)) {
    return;
  }
  const head = doc.lineAt(callout.markFrom);
  const after = doc.sliceString(callout.markTo, head.to);
  const title = after.trim();
  // The marker and the space after it: a title then starts where the head's
  // words start on the page.
  const space = /^[ \t]*/.exec(after)?.[0].length ?? 0;
  out.push(
    Decoration.replace({
      widget: new CalloutHeadWidget(callout.callout, fold, title !== ""),
    }).range(callout.markFrom, callout.markTo + space),
  );
  if (title !== "") {
    out.push(
      Decoration.mark({ class: "cm-callout-title" }).range(
        callout.markTo + space,
        head.to,
      ),
    );
  }
}

/** The text inside an inline code span, between its backtick marks. */
function codeInside(node: SyntaxNode): [number, number] {
  const open = node.firstChild;
  const close = node.lastChild;
  if (open === null || close === null || open === close) {
    return [node.from, node.to];
  }
  return [open.to, close.from];
}

/** The decorations, and the hidden spans a caret steps over. */
interface Inline {
  decorations: DecorationSet;
  hidden: DecorationSet;
}

function buildInline(view: EditorView): Inline {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(state);
  const fmEnd = frontmatterRegion(doc)?.to ?? -1;
  const out: Range<Decoration>[] = [];
  // A node two visible ranges both reach is decorated once.
  const seen = new Set<string>();
  const once = (node: SyntaxNode) => {
    const key = `${node.name}:${node.from}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        if (ref.from <= fmEnd) {
          return;
        }
        if (ref.name === "FencedCode" || ref.name === "CodeBlock") {
          return false;
        }
        const node = ref.node;
        if (ref.name === "Blockquote") {
          if (once(node)) {
            calloutDecorations(state, node, active, out);
          }
          return;
        }
        const lineActive = active.has(doc.lineAt(ref.from).number);
        if (ref.name === "StatusLabel") {
          const status = statusOf(state, node);
          if (status !== null && !lineActive && once(node)) {
            const open = node.firstChild;
            const label = doc.sliceString(
              open?.to ?? node.from,
              status.closeFrom,
            );
            out.push(
              Decoration.replace({
                widget: new StatusWidget(label, status.colour),
              }).range(status.from, status.to),
            );
          }
          return false;
        }
        if (ref.name === "InlineCode") {
          if (lineActive || !once(node)) {
            return false;
          }
          const [inFrom, inTo] = codeInside(node);
          const code = doc.sliceString(inFrom, inTo);
          const math =
            doc.sliceString(ref.from - 1, ref.from) === "$" &&
            doc.sliceString(ref.from - 2, ref.from - 1) !== "\\" &&
            doc.sliceString(ref.to, ref.to + 1) === "$";
          if (math) {
            out.push(
              Decoration.replace({
                widget: new MathWidget(code, false),
              }).range(ref.from - 1, ref.to + 1),
            );
            return false;
          }
          const colour = colourOf(code);
          if (colour !== null) {
            out.push(
              Decoration.widget({
                widget: new SwatchWidget(colour),
                side: -1,
              }).range(ref.from),
            );
          }
          return false;
        }
      },
    });
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return {
    decorations: Decoration.set(out, true),
    // Only what is replaced: the line tint and the title's weight sit over
    // text a caret must still reach anywhere inside.
    hidden: Decoration.set(
      out.filter((range) => range.from < range.to && range.value.point),
      true,
    ),
  };
}

const inlinePreviews = ViewPlugin.fromClass(
  class {
    built: Inline;

    constructor(view: EditorView) {
      this.built = buildInline(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        parseAdvanced(update)
      ) {
        this.built = buildInline(update.view);
      }
    }
  },
  {
    decorations: (value) => value.built.decorations,
    // Hidden marks are not a place a caret may sit, as in `preview.ts`.
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.built.hidden ?? Decoration.none,
      ),
  },
);

/** The source and the span of one display formula. */
interface Block {
  from: number;
  to: number;
  tex: string;
}

/** A `math` fence and a `$$` block, each with its formula, outside code. */
function mathBlocks(state: EditorState): Block[] {
  const doc = state.doc;
  const blocks: Block[] = [];
  const code: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!CODE_CONTEXTS.has(node.name) || node.name === "InlineCode") {
        return;
      }
      code.push({ from: node.from, to: node.to });
      if (node.name !== "FencedCode") {
        return false;
      }
      const text = doc.sliceString(node.from, node.to);
      const fence = /^```math[ \t]*\n([\s\S]*?)\n?```[ \t]*$/.exec(text);
      if (fence !== null) {
        blocks.push({ from: node.from, to: node.to, tex: fence[1] ?? "" });
      }
      return false;
    },
  });
  const fmEnd = frontmatterRegion(doc)?.to ?? -1;
  const inCode = (pos: number) =>
    pos <= fmEnd || code.some((range) => pos >= range.from && pos <= range.to);
  let open: number | null = null;
  for (let number = 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    if (line.text.trim() !== "$$" || inCode(line.from)) {
      continue;
    }
    if (open === null) {
      open = number;
      continue;
    }
    const first = doc.line(open);
    // The lines between the two fences; none when they stand together.
    const tex =
      number === open + 1 ? "" : doc.sliceString(first.to + 1, line.from - 1);
    blocks.push({ from: first.from, to: line.to, tex });
    open = null;
  }
  return blocks;
}

function buildBlocks(state: EditorState): DecorationSet {
  const touched = (block: Block) =>
    state.selection.ranges.some(
      (range) => range.from <= block.to && range.to >= block.from,
    );
  const out = mathBlocks(state)
    .filter((block) => block.tex.trim() !== "" && !touched(block))
    .map((block) =>
      Decoration.replace({
        widget: new MathWidget(block.tex, true),
        block: true,
      }).range(block.from, block.to),
    );
  return Decoration.set(out.sort((a, b) => a.from - b.from));
}

const blockPreviews = StateField.define<DecorationSet>({
  create: (state) => buildBlocks(state),
  update: (value, tr) =>
    tr.docChanged || tr.selection !== undefined || parseAdvanced(tr)
      ? buildBlocks(tr.state)
      : value,
  provide: (field) => EditorView.decorations.from(field),
});

const elementTheme = EditorView.baseTheme({
  ".cm-callout-head": { marginRight: "0.375rem", fontWeight: "600" },
  ".cm-callout-title": { fontWeight: "600" },
  ".cm-math-block": {
    padding: "0.5rem 0.75rem",
    overflowX: "auto",
  },
});

/** The whole layer, inside the preview compartment. */
export function elementPreviews(): Extension {
  return [inlinePreviews, blockPreviews, elementTheme];
}
