/**
 * A unified diff, cut for people.
 *
 * The server hands the review a raw unified diff: file header lines
 * (`--- original`, `+++ modified`), hunk headers, a `\ No newline at end of
 * file` note and the section id lines, all bookkeeping. This module keeps what
 * a reader needs: the context, added and removed lines, with a gap where two
 * hunks (or a collapsed stretch) leave lines out.
 */

import { stripIdLines } from "./reflectionText";

export type DiffKind = "add" | "del" | "ctx" | "gap";

export interface DiffLine {
  kind: DiffKind;
  /** The line without its marker character; empty for a gap. */
  text: string;
}

/** The lines of a diff worth showing, hunks joined by a gap. */
export function parseDiff(raw: string): DiffLine[] {
  const lines = stripIdLines(raw, true).split(/\r?\n/);
  const out: DiffLine[] = [];
  let inHunk = false;
  let pendingGap = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      // A second hunk is a break in the text; the first needs no gap.
      pendingGap = inHunk;
      inHunk = true;
      continue;
    }
    if (!inHunk && (line.startsWith("---") || line.startsWith("+++"))) {
      continue;
    }
    if (line.startsWith("\\")) {
      continue;
    }
    const marker = line.charAt(0);
    const kind: DiffKind =
      marker === "+" ? "add" : marker === "-" ? "del" : "ctx";
    if (kind === "ctx" && line === "" && out.length === 0) {
      continue;
    }
    if (pendingGap) {
      out.push({ kind: "gap", text: "" });
      pendingGap = false;
    }
    out.push({ kind, text: line.slice(1) });
  }
  // A split on the final line break leaves one empty context line behind.
  while (out.length > 0 && out[out.length - 1]?.kind === "ctx") {
    if ((out[out.length - 1] as DiffLine).text !== "") {
      break;
    }
    out.pop();
  }
  return out;
}

/**
 * The changed lines with `context` unchanged lines around each change; the
 * stretches left out become one gap each. `hidden` is false when nothing was
 * left out (a disclosure would show the same thing).
 */
export function collapseDiff(
  lines: DiffLine[],
  context = 2,
): { lines: DiffLine[]; hidden: boolean } {
  const keep = lines.map((line) => line.kind === "add" || line.kind === "del");
  const near = keep.map((_, i) => {
    for (let d = -context; d <= context; d += 1) {
      if (keep[i + d] === true) {
        return true;
      }
    }
    return false;
  });
  const out: DiffLine[] = [];
  let hidden = false;
  lines.forEach((line, i) => {
    if (line.kind === "gap") {
      if (out.length > 0 && out[out.length - 1]?.kind !== "gap") {
        out.push(line);
      }
      return;
    }
    if (near[i]) {
      out.push(line);
      return;
    }
    hidden = true;
    if (out.length > 0 && out[out.length - 1]?.kind !== "gap") {
      out.push({ kind: "gap", text: "" });
    }
  });
  while (out.length > 0 && out[out.length - 1]?.kind === "gap") {
    out.pop();
  }
  while (out.length > 0 && out[0]?.kind === "gap") {
    out.shift();
  }
  return { lines: out, hidden };
}
