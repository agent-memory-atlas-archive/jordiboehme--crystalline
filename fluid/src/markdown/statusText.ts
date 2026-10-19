/**
 * The words a status label shows, in plain text: `:status[In review]{blue}`
 * reads "In review". For text that is read without the renderer (a heading's
 * slug on the domain home), so it matches what the rendered heading says.
 *
 * A label closes on its balanced `]` and `\]` is no close, the way the
 * parser reads it; a label that never closes stays as written.
 */

const HEAD = ":status[";

/**
 * The index of the `]` that closes a label whose words start at `from`, or
 * -1. A label stays on one line.
 */
export function labelEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\n") {
      return -1;
    }
    if (c === "\\") {
      i += 1;
    } else if (c === "[") {
      depth += 1;
    } else if (c === "]") {
      if (depth === 0) {
        return i;
      }
      depth -= 1;
    }
  }
  return -1;
}

export function statusLabelWords(text: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const head = text.indexOf(HEAD, at);
    if (head === -1) {
      return out + text.slice(at);
    }
    const from = head + HEAD.length;
    const close = labelEnd(text, from);
    if (close === -1) {
      out += text.slice(at, from);
      at = from;
      continue;
    }
    out += text.slice(at, head) + text.slice(from, close);
    at = close + 1;
    if (text[at] === "{") {
      const brace = text.indexOf("}", at);
      if (brace !== -1) {
        at = brace + 1;
      }
    }
  }
}

/**
 * A label's words as a pill shows them: its inline Markdown read as plain
 * text (emphasis and code marks dropped, a link as its words, an escape as
 * the character it escapes).
 */
export function labelPlainWords(label: string): string {
  return label.replace(
    /\\(.)|!?\[([^\]]*)\]\([^)]*\)|\*\*|__|~~|\*|`/g,
    (_mark, escaped?: string, link?: string) => escaped ?? link ?? "",
  );
}
