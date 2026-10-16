/**
 * A unified diff, cut for people.
 *
 * The server hands the review a raw unified diff: file header lines
 * (`--- original`, `+++ modified`), hunk headers, a `\ No newline at end of
 * file` note and the section id lines, all bookkeeping. This module keeps what
 * a reader needs: the engine's own hunks (three lines of context each), with
 * a gap where two hunks leave lines out.
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
