/**
 * Reading and respelling the `domain_name:` line of a MANIFEST's frontmatter.
 *
 * The MANIFEST editor only needs to know whether the name the text declares is
 * the one it was loaded with, and to put a name back. Both work on the one
 * frontmatter line and leave every other byte of the text alone, so this is a
 * line scan and not a YAML parser.
 */

const NAME_LINE = /^domain_name[ \t]*:[ \t]*(.*?)[ \t]*$/;

/** Where the frontmatter body starts and ends, as line indexes; null without one. */
function frontmatterLines(lines: string[]): { end: number } | null {
  if (lines[0]?.trim() !== "---") {
    return null;
  }
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (line === "---" || line === "...") {
      return { end: index };
    }
  }
  return null;
}

/** The value of a YAML scalar as written: quotes taken off, a trailing comment dropped. */
function scalarOf(raw: string): string {
  const quote = raw.at(0);
  if (quote === '"' || quote === "'") {
    const close = raw.indexOf(quote, 1);
    if (close > 0) {
      return raw.slice(1, close);
    }
  }
  return raw.replace(/[ \t]+#.*$/, "").trim();
}

/** The name the text declares, or null when it has no frontmatter or no such line. */
export function domainNameOf(markdown: string): string | null {
  const lines = markdown.split("\n");
  const front = frontmatterLines(lines);
  if (front === null) {
    return null;
  }
  for (let index = 1; index < front.end; index += 1) {
    const match = NAME_LINE.exec(lines[index]?.replace(/\r$/, "") ?? "");
    if (match) {
      const name = scalarOf(match[1] ?? "");
      return name === "" ? null : name;
    }
  }
  return null;
}

/**
 * The text with its `domain_name:` value set to `name`; the quote style the
 * line wore stays. A text with no such line gets one right under the opening
 * fence, and a text with no frontmatter is returned as it is.
 */
export function withDomainName(markdown: string, name: string): string {
  const lines = markdown.split("\n");
  const front = frontmatterLines(lines);
  if (front === null) {
    return markdown;
  }
  for (let index = 1; index < front.end; index += 1) {
    const line = lines[index] ?? "";
    const cr = line.endsWith("\r") ? "\r" : "";
    const match = NAME_LINE.exec(line.replace(/\r$/, ""));
    if (match) {
      const raw = match[1] ?? "";
      const quote = raw.at(0);
      const quoted = quote === '"' || quote === "'" ? quote : "";
      lines[index] = `domain_name: ${quoted}${name}${quoted}${cr}`;
      return lines.join("\n");
    }
  }
  const cr = (lines[0] ?? "").endsWith("\r") ? "\r" : "";
  lines.splice(1, 0, `domain_name: ${name}${cr}`);
  return lines.join("\n");
}
