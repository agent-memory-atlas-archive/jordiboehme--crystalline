/**
 * What a MANIFEST section that is not declared says instead of nothing, and
 * the bullets the core crate flagged in one that is. Shared by the domain's
 * front page (the routing sections) and its settings screen (the
 * configuration sections).
 *
 * The line and the example come from the server's registry, never from a
 * list kept here: a section added to the registry in core shows up with its
 * meaning and its syntax without a line of this file changing, and the
 * core-side guard test parses every example back into the declaration it
 * advertises, so what a person is shown is what the parser accepts.
 *
 * The action does not write anything. It seeds the editor and hands over:
 * the document is the source and the editor is where a change goes.
 */

import type { ReactElement } from "react";

import type {
  ManifestProblem,
  ManifestSections,
  StarterStanza,
} from "../api/domain";
import { BUTTON } from "./primitives";

/**
 * The stanza the server sent for `section`, or null when it sent none: an
 * older daemon answered sections without the registry of startable ones.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function starterFor(
  sections: ManifestSections,
  section: string,
): StarterStanza | null {
  return sections.starters.find((row) => row.section === section) ?? null;
}

export function EmptySection({
  starter,
  fallback,
  onStart,
}: {
  starter: StarterStanza | null;
  /** What to say when the server sent no registry to say anything from. */
  fallback: string;
  /** Seed the section into the editor, or null for a reader who may not. */
  onStart: ((section: string) => void) | null;
}): ReactElement {
  if (starter === null) {
    return <p className="text-sm text-muted">{fallback}</p>;
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-slate-600 dark:text-slate-400">{starter.meaning}</p>
      <pre className="text-caption overflow-x-auto rounded bg-sunken p-2 font-mono whitespace-pre">
        {starter.example}
      </pre>
      {onStart !== null && (
        <button
          type="button"
          className={`self-start ${BUTTON.secondary}`}
          onClick={() => {
            onStart(starter.section);
          }}
        >
          {`Add ${starter.section}`}
        </button>
      )}
    </div>
  );
}

/**
 * The bullets the core crate flagged, each with its reason in the crate's
 * own words. The bullet in monospace, because it is quoted from the file.
 */
export function Problems({
  items,
}: {
  items: ManifestProblem[];
}): ReactElement | null {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 text-sm">
      <h4 className="text-caption font-semibold text-red-700 dark:text-red-300">
        Problems
      </h4>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={`${item.kind}:${item.bullet}`}>
            <span className="font-mono">{item.bullet}</span>
            <span className="block text-slate-500 dark:text-slate-400">
              {item.reason}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
