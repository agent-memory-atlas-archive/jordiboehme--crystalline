/**
 * The pure half of the printed page (`components/PrintSheet.tsx` draws it):
 * the words of the running header and footer as CSS strings, and the facts
 * of an engram's title block.
 */

import { distinctSources } from "./reflectionSources";
import type { ReflectionDoc } from "./api/reflection";
import { formatDayLong, plural } from "./format";

/** A CSS string literal of `text`. */
export function cssString(text: string): string {
  const body = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
  return `"${body}"`;
}

/**
 * When the engram was last written, out of its frontmatter: `generated`'s
 * `timestamp`, or the older top-level `timestamp`. Null when it says neither.
 */
export function lastWrite(content: string): string | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
  if (block === undefined) {
    return null;
  }
  const generated = /^generated:[ \t]*\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/m.exec(
    block,
  )?.[1];
  const stamp =
    (generated === undefined
      ? undefined
      : /^[ \t]+timestamp:[ \t]*["']?([^"'\s]+)/m.exec(generated)?.[1]) ??
    /^timestamp:[ \t]*["']?([^"'\s]+)/m.exec(block)?.[1];
  return stamp ?? null;
}

/** One fact in the title block: a label and its value. */
export interface PrintFact {
  label: string;
  value: string;
}

/**
 * The facts of an engram's title block, in the order they print: the dates
 * first, so they always share the start of the line, then Status, Type and
 * Tags, which may wrap onto a second line. A fact the engram lacks is left
 * out.
 */
export function engramFacts(fields: {
  status: string | null;
  type: string | null;
  tags: string[];
  recordedAt: string | null;
  content: string;
}): PrintFact[] {
  const facts: PrintFact[] = [];
  if (fields.recordedAt !== null) {
    facts.push({ label: "Recorded", value: formatDayLong(fields.recordedAt) });
  }
  const written = lastWrite(fields.content);
  if (written !== null) {
    facts.push({ label: "Updated", value: formatDayLong(written) });
  }
  if (fields.status !== null) {
    facts.push({ label: "Status", value: fields.status });
  }
  if (fields.type !== null) {
    facts.push({ label: "Type", value: fields.type });
  }
  if (fields.tags.length > 0) {
    facts.push({ label: "Tags", value: fields.tags.join(", ") });
  }
  return facts;
}

/** The facts of a Reflection page's title block. */
export function reflectionFacts(
  page: Pick<ReflectionDoc, "sections" | "threads">,
  engramsVisible: boolean,
): PrintFact[] {
  const facts: PrintFact[] = [
    { label: "Sections", value: String(page.sections.length) },
  ];
  if (engramsVisible) {
    const sources = distinctSources(page.sections);
    if (sources > 0) {
      facts.push({
        label: "Built from",
        value: plural(sources, "engram", "engrams"),
      });
    }
  }
  const open = page.threads.filter((t) => t.status === "open").length;
  if (open > 0) {
    facts.push({ label: "Open threads", value: String(open) });
  }
  return facts;
}

/** One SVG path for the dark modules, a run of them per rectangle. */
export function qrPath(data: readonly (readonly boolean[])[]): string {
  let path = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run]) {
        run += 1;
      }
      path += `M${String(x)} ${String(y)}h${String(run)}v1h-${String(run)}z`;
      x += run;
    }
  });
  return path;
}
