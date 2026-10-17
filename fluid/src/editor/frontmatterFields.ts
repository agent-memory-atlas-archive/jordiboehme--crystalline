/**
 * Line-level field access to the frontmatter block. Deliberately NOT a YAML
 * parser: parsing and re-emitting the whole block would reformat lines the
 * user never touched, which is the diff noise this editor exists to never
 * make. Each write is the smallest edit that says what changed - one scalar
 * line, or one tags entry - and everything else keeps its bytes.
 *
 * Scope, honestly stated: top-level `key: value` scalars and the tags list
 * (inline or block). A key written in a fancier YAML shape (anchors, flow
 * maps) is read as its raw text and rewritten as a plain scalar when edited
 * through the form - the raw editor is always there for the fancy cases.
 *
 * String mathematics only, over the buffer's own text: nothing here reads a
 * CodeMirror document, so the offsets are offsets into that string. A caller
 * dispatching them into a view translates them through the document's line API
 * first, because a CRLF buffer counts each break as one position and these
 * offsets count it as two.
 */

import { separatorOf } from "./setup";

/** One edit, as offsets into the string it was computed from. */
export interface FieldEdit {
  from: number;
  to: number;
  insert: string;
}

/** One line, as the offsets that bound it, terminator included. */
interface LineSpan {
  lineStart: number;
  lineEnd: number;
}

/** The block's inner line spans, or null when there is no block to edit. */
function blockLines(doc: string): LineSpan[] | null {
  if (!doc.startsWith("---\n") && !doc.startsWith("---\r\n")) {
    return null;
  }
  const newline = separatorOf(doc);
  const lines: LineSpan[] = [];
  let at = doc.indexOf(newline) + newline.length;
  while (at < doc.length) {
    let end = doc.indexOf(newline, at);
    if (end === -1) {
      end = doc.length;
    } else {
      end += newline.length;
    }
    const text = doc.slice(at, end).replace(/\r?\n$/, "");
    if (text.trimEnd() === "---") {
      return lines;
    }
    lines.push({ lineStart: at, lineEnd: end });
    at = end;
  }
  // Never closed: not a block this form edits.
  return null;
}

/**
 * Whether there is a block here for the form to edit at all.
 *
 * The same question `writeScalar` and `writeTagList` answer by returning null,
 * asked before anything is drawn: a form whose every edit silently did nothing
 * - because the opening fence was never closed, say - would be worse than the
 * plain note a caller shows instead.
 */
export function hasFrontmatterBlock(doc: string): boolean {
  return blockLines(doc) !== null;
}

/** One line's text without its terminator. */
function lineText(doc: string, span: LineSpan): string {
  return doc.slice(span.lineStart, span.lineEnd).replace(/\r?\n$/, "");
}

/** The characters a one-letter yaml double-quoted escape stands for. */
const SIMPLE_ESCAPES: Record<string, string> = {
  "0": "\0",
  "\\": "\\",
  '"': '"',
  "/": "/",
  n: "\n",
  t: "\t",
  r: "\r",
};

/** The hex-digit count of the escapes that carry a code point. */
const HEX_ESCAPES: Record<string, number> = { x: 2, u: 4, U: 8 };

/**
 * Decode a yaml double-quoted body in one left-to-right pass, so `\\"` is a
 * backslash followed by a quote and never a quote followed by a backslash. An
 * escape this does not know is kept as written rather than refused.
 */
function decodeDoubleQuoted(body: string): string {
  return body.replace(
    /\\(?:([0\\"/ntr])|([xuU])([0-9a-fA-F]+))/g,
    (whole: string, simple?: string, kind?: string, digits?: string) => {
      if (simple !== undefined) {
        return SIMPLE_ESCAPES[simple] ?? whole;
      }
      const width = HEX_ESCAPES[kind ?? ""];
      if (width === undefined || digits === undefined) {
        return whole;
      }
      // Exactly `width` digits belong to the escape; any more are text.
      const code = Number.parseInt(digits.slice(0, width), 16);
      if (digits.length < width || code > 0x10ffff) {
        return whole;
      }
      return String.fromCodePoint(code) + digits.slice(width);
    },
  );
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return decodeDoubleQuoted(trimmed.slice(1, -1));
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/** Quote a value yaml would misread as structure; pass plain ones through. */
function plainOrQuoted(value: string): string {
  // The backslash is escaped first: escaping the quote first would hand its
  // own new backslash to this pass and double it.
  return /[:#[\]{}&*!|>'"%@`]|^\s|\s$/.test(value) &&
    !/^\d+(\.\d+)?$/.test(value)
    ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    : value;
}

function findKey(doc: string, key: string): LineSpan | null {
  const lines = blockLines(doc);
  if (!lines) {
    return null;
  }
  const shape = new RegExp(`^${key}\\s*:`);
  return lines.find((span) => shape.test(lineText(doc, span))) ?? null;
}

/** The trimmed, unquoted value of a top-level scalar key, or null. */
export function readScalar(doc: string, key: string): string | null {
  const span = findKey(doc, key);
  if (!span) {
    return null;
  }
  const text = lineText(doc, span);
  const value = unquote(text.slice(text.indexOf(":") + 1));
  return value === "" ? null : value;
}

/**
 * The edit that sets, rewrites or (value = null) removes the key's line.
 * Null when the document has no frontmatter block to edit.
 */
export function writeScalar(
  doc: string,
  key: string,
  value: string | null,
): FieldEdit | null {
  const lines = blockLines(doc);
  if (!lines) {
    return null;
  }
  const newline = separatorOf(doc);
  const span = findKey(doc, key);
  if (value === null) {
    // Absent means unbounded (or unset): the line goes, whole. Nothing here
    // ever writes a sentinel date or an empty value in its place.
    return span ? { from: span.lineStart, to: span.lineEnd, insert: "" } : null;
  }
  const line = `${key}: ${plainOrQuoted(value)}`;
  if (span) {
    const text = lineText(doc, span);
    return {
      from: span.lineStart,
      to: span.lineStart + text.length,
      insert: line,
    };
  }
  // A new key lands just before the closing fence.
  const last = lines.at(-1);
  const at = last ? last.lineEnd : doc.indexOf(newline) + newline.length;
  return { from: at, to: at, insert: `${line}${newline}` };
}

/**
 * Whether a key's value stands on its own line, which is the one shape the
 * form may rewrite. A block scalar (`key: >-` or `key: |` with the text on
 * indented lines below) and a plain scalar folded onto continuation lines both
 * reach past the key line, and `writeScalar` replaces that line alone: it
 * would leave the rest of the old text behind as broken yaml. A caller shows
 * such a value read-only and points at Raw instead. True for an absent key.
 */
export function scalarIsOneLine(doc: string, key: string): boolean {
  const lines = blockLines(doc);
  const span = findKey(doc, key);
  if (!lines || !span) {
    return true;
  }
  const text = lineText(doc, span);
  const value = text.slice(text.indexOf(":") + 1).trim();
  if (/^[|>]/.test(value)) {
    return false;
  }
  // A quoted scalar whose closing quote is not on this line goes on below,
  // indented or not.
  if (!quoteClosed(value)) {
    return false;
  }
  const next = lines.find((line) => line.lineStart === span.lineEnd);
  return next === undefined || !/^\s/.test(lineText(doc, next));
}

/**
 * Whether a value that opens a quote closes it on the same line (a trailing
 * comment allowed). A value that opens no quote is closed by definition.
 */
export function quoteClosed(value: string): boolean {
  if (value.startsWith('"')) {
    return /^"(?:[^"\\]|\\.)*"\s*(?:#.*)?$/.test(value);
  }
  if (value.startsWith("'")) {
    return /^'(?:[^']|'')*'\s*(?:#.*)?$/.test(value);
  }
  return true;
}

/**
 * A value written over several lines, as one line of text to read: a block
 * scalar's lines, a plain scalar's continuation lines, or a quoted scalar up
 * to its closing quote, joined by spaces and unquoted. Empty for an absent
 * key.
 */
export function readMultiLine(doc: string, key: string): string {
  const lines = doc.split(/\r?\n/);
  const at = lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line));
  if (at === -1) {
    return "";
  }
  const first = lines[at] ?? "";
  const head = first.slice(first.indexOf(":") + 1).trim();
  const parts: string[] = /^[|>]/.test(head) ? [] : [head];
  const quoted = /^["']/.test(head) && !quoteClosed(head);
  for (const line of lines.slice(at + 1)) {
    if (line.trimEnd() === "---") {
      break;
    }
    if (quoted) {
      parts.push(line.trim());
      if (quoteClosed(parts.join(" "))) {
        break;
      }
      continue;
    }
    if (!/^\s/.test(line) || line.trim() === "") {
      break;
    }
    parts.push(line.trim());
  }
  return unquote(parts.join(" "));
}

/** The words yaml reads as something other than a string when unquoted. */
const YAML_WORDS = /^(?:true|false|yes|no|on|off|null|~)$/i;

/**
 * Free text as one yaml line: plain where it is plainly a string, otherwise
 * double-quoted with its backslashes and quotes escaped. Line breaks become
 * spaces first, so the value can never leave its own line.
 */
/** Whether a character is a C0 control character or DEL. */
function isControl(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

function textScalar(value: string): string {
  const flat = value.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const plain =
    /^[A-Za-z][^:#[\]{}&*!|>'"%@`\\]*$/.test(flat) &&
    ![...flat].some(isControl) &&
    !/\s$/.test(flat) &&
    !YAML_WORDS.test(flat);
  if (plain) {
    return flat;
  }
  // Backslash first, so the escapes added after it are not escaped again.
  // A C0 control character (and DEL) is written as its `\x` escape, which
  // the reader above decodes; everything else, unicode included, as is.
  const escaped = [...flat.replace(/\\/g, "\\\\").replace(/"/g, '\\"')]
    .map((char) =>
      isControl(char)
        ? `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`
        : char,
    )
    .join("");
  return `"${escaped}"`;
}

/**
 * `writeScalar` for free text such as a description: the value is flattened
 * to one line and quoted whenever yaml could read it as anything but a string.
 */
export function writeText(
  doc: string,
  key: string,
  value: string | null,
): FieldEdit | null {
  const flat = value === null ? "" : value.replace(/\s+/g, " ").trim();
  if (flat === "") {
    return writeScalar(doc, key, null);
  }
  const edit = writeScalar(doc, key, flat);
  if (edit === null) {
    return null;
  }
  return {
    ...edit,
    insert: edit.insert.replace(
      /^([^:]+: ).*/,
      (_m, head: string) => `${head}${textScalar(flat)}`,
    ),
  };
}

/** The tags entry's whole span (key line plus any block items), or null. */
function tagsSpan(
  doc: string,
): { from: number; to: number; inline: string | null } | null {
  const lines = blockLines(doc);
  if (!lines) {
    return null;
  }
  const index = lines.findIndex((span) =>
    /^tags\s*:/.test(lineText(doc, span)),
  );
  if (index === -1) {
    return null;
  }
  const key = lines[index];
  if (!key) {
    return null;
  }
  const keyText = lineText(doc, key);
  const after = keyText.slice(keyText.indexOf(":") + 1).trim();
  let to = key.lineEnd;
  if (after === "") {
    // Any indentation, none included: a block sequence under a mapping key is
    // yaml whether or not its items are indented, and the flush form is what
    // the core's emitter writes. Requiring the indent read those files as
    // having no tags, and - worse - wrote a fresh list over the key line
    // alone, stranding the original items below it as a second list.
    // The closing fence never reaches here (`blockLines` stops at it) and
    // would not match anyway: `---` has no space after its first dash.
    for (let i = index + 1; i < lines.length; i += 1) {
      const item = lines[i];
      if (!item || !/^\s*-\s/.test(lineText(doc, item))) {
        break;
      }
      to = item.lineEnd;
    }
  }
  return { from: key.lineStart, to, inline: after === "" ? null : after };
}

/** The tags, from an inline [a, b] or a block list. */
export function readTagList(doc: string): string[] {
  const span = tagsSpan(doc);
  if (!span) {
    return [];
  }
  if (span.inline !== null) {
    return span.inline
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((tag) => unquote(tag))
      .filter((tag) => tag !== "");
  }
  return doc
    .slice(span.from, span.to)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => unquote(line.slice(2)));
}

/**
 * The edit that replaces the whole tags entry with a block list (or removes
 * it for an empty list). Null without a frontmatter block.
 */
export function writeTagList(doc: string, tags: string[]): FieldEdit | null {
  const lines = blockLines(doc);
  if (!lines) {
    return null;
  }
  const newline = separatorOf(doc);
  const span = tagsSpan(doc);
  if (tags.length === 0) {
    return span ? { from: span.from, to: span.to, insert: "" } : null;
  }
  const entry =
    `tags:${newline}` +
    tags.map((tag) => `  - ${plainOrQuoted(tag)}`).join(newline) +
    newline;
  if (span) {
    return { from: span.from, to: span.to, insert: entry };
  }
  const last = lines.at(-1);
  const at = last ? last.lineEnd : doc.indexOf(newline) + newline.length;
  return { from: at, to: at, insert: entry };
}
