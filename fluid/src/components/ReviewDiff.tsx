/**
 * One section's change in the review: the engine's hunks as they are (three
 * lines of context around each change), a gap between two hunks. Added and
 * removed lines wear a calm tint and keep their `+` and `-` marker, and each
 * run of them is announced once to a screen reader, so colour is never the
 * only cue. The box scrolls sideways; the page never does.
 */

import type { ReactElement } from "react";

import { parseDiff } from "../reviewDiff";
import type { DiffLine } from "../reviewDiff";
import { FOCUS_RING } from "./primitives";

const ROW: Record<DiffLine["kind"], string> = {
  add: "bg-(--color-diff-added)",
  del: "bg-(--color-diff-removed)",
  ctx: "",
  gap: "text-muted",
};

export function ReviewDiff({
  diff,
  label,
}: {
  diff: string;
  label: string;
}): ReactElement | null {
  const lines = parseDiff(diff);
  if (lines.length === 0) {
    return null;
  }
  return (
    <div
      role="group"
      aria-label={label}
      tabIndex={0}
      className={`mt-2 max-w-full overflow-x-auto rounded-md border border-hair font-mono text-xs leading-[1.6] text-ink-2 ${FOCUS_RING}`}
    >
      <div className="w-max min-w-full py-1">
        {lines.map((line, index) => {
          if (line.kind === "gap") {
            return (
              <div key={`gap-${String(index)}`} className={`px-2.5 ${ROW.gap}`}>
                <span aria-hidden>...</span>
                <span className="sr-only">Unchanged lines left out</span>
              </div>
            );
          }
          const before = lines[index - 1]?.kind;
          // One announcement at the start of each run, not on every line.
          const starts =
            (line.kind === "add" || line.kind === "del") &&
            before !== line.kind;
          return (
            <div
              key={`${String(index)}-${line.kind}`}
              className={`flex gap-2 px-2.5 whitespace-pre ${ROW[line.kind]}`}
            >
              <span aria-hidden className="w-2 shrink-0 select-none">
                {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
              </span>
              {starts && (
                <span className="sr-only">
                  {line.kind === "add" ? "Added: " : "Removed: "}
                </span>
              )}
              <span>{line.text === "" ? " " : line.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
