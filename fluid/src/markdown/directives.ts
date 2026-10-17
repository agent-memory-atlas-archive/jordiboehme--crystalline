/**
 * Status labels: `:status[Text]{colour}`, the one directive this dialect has.
 *
 * Read the same way as the core lint Q006 reads a label: the palette below,
 * the braces holding exactly one palette word without regard to case, no
 * braces meaning grey. Anything else in the braces is grey here and a warning
 * there.
 *
 * The parser is restricted so nothing else is a directive: only `:status[`
 * starts one, and there are no leaf or container directives at all. A colon
 * in prose (`10:30`, `note:this`, `foo:bar[link](url)`, `::toc`, a `:::note`
 * block from other editors) is ordinary Markdown text, and the Markdown in
 * and after it renders as it always did.
 */

import remarkDirective from "remark-directive";

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

/** Whether `value` is one of the palette's names, as written here. */
export function isStatusColour(value: unknown): value is StatusColour {
  return (
    typeof value === "string" &&
    (STATUS_COLOURS as readonly string[]).includes(value)
  );
}

/** The colour a label's brace text names: one palette word, else grey. */
export function statusColour(braces: string | null): StatusColour {
  const word = braces?.trim().toLowerCase();
  return isStatusColour(word) ? word : "grey";
}

/*
 * The small part of micromark's tokenizer shape the guard below needs. The
 * types package is not a dependency of this app, and the guard only passes
 * the directive construct's own pieces through.
 */
type Code = number | null;
type State = (code: Code) => State | undefined;
interface Effects {
  enter(type: string): unknown;
  exit(type: string): unknown;
  consume(code: Code): void;
  check(construct: Construct, ok: State, nok: State): State;
}
interface Construct {
  tokenize: (
    this: unknown,
    effects: Effects,
    ok: State,
    nok: State,
  ) => State | undefined;
  previous?: (this: unknown, code: Code) => boolean;
  partial?: boolean;
  name?: string;
}
interface Extension {
  text?: Record<number, Construct>;
  flow?: unknown;
}

const COLON = 58;
const HEAD = ":status[";

/** Succeeds on `:status[` and nothing else, consuming nothing for good. */
const statusHead: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    let at = 0;
    const next: State = (code) => {
      if (code !== HEAD.charCodeAt(at)) {
        return nok(code);
      }
      if (at === 0) {
        effects.enter("statusHead");
      }
      effects.consume(code);
      at += 1;
      if (at === HEAD.length) {
        effects.exit("statusHead");
        return ok;
      }
      return next;
    };
    return next;
  },
};

/** The text directive construct, run only where `:status[` stands. */
function statusOnly(directiveText: Construct): Construct {
  return {
    name: "statusDirective",
    ...(directiveText.previous ? { previous: directiveText.previous } : {}),
    tokenize(effects, ok, nok) {
      const start: State = (code) =>
        effects.check(
          statusHead,
          (at) => directiveText.tokenize.call(this, effects, ok, nok)?.(at),
          nok,
        )(code);
      return start;
    },
  };
}

/**
 * The parser plugin, in the place of `remark-directive`: its syntax with the
 * text construct guarded to `:status[` and the flow constructs (leaf and
 * container directives) left out. Its mdast conversion is kept as it is.
 */
export function remarkStatusSyntax(this: unknown): void {
  const data = (
    this as { data(): { micromarkExtensions?: Extension[] } }
  ).data();
  const before = data.micromarkExtensions?.length ?? 0;
  (remarkDirective as (this: unknown) => void).call(this);
  const extensions = data.micromarkExtensions ?? [];
  // Exactly the one syntax extension remark-directive adds, with its text
  // construct on the colon. Anything else means the dependency changed
  // shape, and guessing would let every colon construct through again.
  const added = extensions.slice(before);
  const text = added[0]?.text?.[COLON];
  if (added.length !== 1 || text === undefined) {
    throw new Error(
      "remark-directive no longer adds one text construct on ':'; check remarkStatusSyntax",
    );
  }
  extensions.splice(before, 1, { text: { [COLON]: statusOnly(text) } });
}

/** The small part of the mdast shape the transform reads and writes. */
interface MdNode {
  type: string;
  name?: string;
  value?: string;
  children?: MdNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
  data?: Record<string, unknown>;
}

/** The source of a node, or null when its position is missing. */
function sliceOf(node: MdNode, source: string): string | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || end > source.length) {
    return null;
  }
  return source.slice(start, end);
}

/** The plain words of a node and everything inside it. */
function wordsOf(node: MdNode): string {
  return typeof node.value === "string"
    ? node.value
    : (node.children ?? []).map(wordsOf).join("");
}

/** The text between a label's closing `{` and `}`, or null for no braces. */
function bracesOf(slice: string): string | null {
  if (!slice.endsWith("}")) {
    return null;
  }
  const open = slice.lastIndexOf("{");
  return open === -1 ? null : slice.slice(open + 1, -1);
}

function walk(node: MdNode, source: string): void {
  if (!node.children) {
    return;
  }
  node.children = node.children.map((child) => {
    walk(child, source);
    if (child.type !== "textDirective") {
      return child;
    }
    const slice = sliceOf(child, source);
    // A label with no words (or only spaces), or one the parser could not
    // close, is text.
    if (slice === null || wordsOf(child).trim() === "") {
      return child.position === undefined
        ? { type: "text", value: slice ?? HEAD }
        : { type: "text", value: slice ?? HEAD, position: child.position };
    }
    child.data = {
      ...child.data,
      hName: "span",
      hProperties: { "data-status": statusColour(bracesOf(slice)) },
    };
    return child;
  });
}

/**
 * The transform, run after {@link remarkStatusSyntax} on the text it parsed:
 * a status label becomes a `span` with `data-status`, its label words kept
 * with their positions, and a label with no words goes back to its source.
 */
export function remarkCrystallineDirectives(
  source: string,
): () => (tree: Root) => void {
  return () => (tree) => {
    walk(tree, source);
  };
}
