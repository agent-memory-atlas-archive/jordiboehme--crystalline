/**
 * One section's change in the review, as the changed lines with a little
 * context. A disclosure shows the whole diff. Added and removed lines wear a
 * calm tint and keep their `+` and `-` marker (and a screen-reader word), so
 * colour is never the only cue. The box scrolls sideways; the page never does.
 */

import type { ReactElement } from "react";
import { useState } from "react";

import { collapseDiff, parseDiff } from "../reviewDiff";
import type { DiffLine } from "../reviewDiff";
import { FOCUS_RING } from "./primitives";

const ROW: Record<DiffLine["kind"], string> = {
  add: "bg-(--color-diff-added)",
  del: "bg-(--color-diff-removed)",
  ctx: "",
  gap: "text-faint",
};

export function ReviewDiff({
  diff,
  label,
}: {
  diff: string;
  label: string;
}): ReactElement | null {
  const [full, setFull] = useState(false);
  const all = parseDiff(diff);
  if (all.length === 0) {
    return null;
  }
  const collapsed = collapseDiff(all);
  const shown = full ? all : collapsed.lines;
  return (
    <div className="mt-2">
      <div
        role="group"
        aria-label={label}
        tabIndex={0}
        className={`max-w-full overflow-x-auto rounded-md border border-hair font-mono text-xs leading-[1.6] text-ink-2 ${FOCUS_RING}`}
      >
        <div className="w-max min-w-full py-1">
          {shown.map((line, index) =>
            line.kind === "gap" ? (
              <div key={`gap-${String(index)}`} className={`px-2.5 ${ROW.gap}`}>
                <span aria-hidden>...</span>
                <span className="sr-only">Unchanged lines left out</span>
              </div>
            ) : (
              <div
                key={`${String(index)}-${line.kind}`}
                className={`flex gap-2 px-2.5 whitespace-pre ${ROW[line.kind]}`}
              >
                <span aria-hidden className="w-2 shrink-0 select-none">
                  {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
                </span>
                {line.kind !== "ctx" && (
                  <span className="sr-only">
                    {line.kind === "add" ? "Added: " : "Removed: "}
                  </span>
                )}
                <span>{line.text === "" ? " " : line.text}</span>
              </div>
            ),
          )}
        </div>
      </div>
      {collapsed.hidden && (
        <button
          type="button"
          aria-expanded={full}
          onClick={() => {
            setFull((on) => !on);
          }}
          className={`mt-1.5 text-xs text-link underline decoration-(--link-line) decoration-1 underline-offset-[3px] hover:no-underline ${FOCUS_RING}`}
        >
          {full ? "Show only the changed lines" : "Show the full diff"}
        </button>
      )}
    </div>
  );
}
