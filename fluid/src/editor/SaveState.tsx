/**
 * The save state in an editor's header, in one place and one at a time:
 * "Saved" with a check, "Saving", "Unsaved changes", or "Offline, kept on
 * this device". Both editors draw it; each decides which state it is in.
 *
 * A refused save is not one of these: it is the server's own sentence, and
 * the editor shows it as an alert under the header.
 */

import { Check, CloudOff } from "lucide-react";
import type { ReactElement } from "react";

export type SaveStateKind = "saved" | "saving" | "unsaved" | "offline";

const WORDS: Record<SaveStateKind, string> = {
  saved: "Saved",
  saving: "Saving",
  unsaved: "Unsaved changes",
  offline: "Offline, kept on this device",
};

export function SaveState({
  state,
}: {
  state: SaveStateKind | null;
}): ReactElement {
  const tone =
    state === "offline"
      ? "text-amber-700 dark:text-amber-300"
      : "text-slate-500 dark:text-slate-400";
  // One status region, mounted for the life of the editor and empty when
  // there is nothing to say: a region that appears with its text already in
  // it is not announced, one whose text changes is.
  return (
    <p
      role="status"
      data-save-state={state ?? undefined}
      className={`inline-flex items-center gap-1.5 text-sm whitespace-nowrap ${tone}`}
    >
      {state === "saved" && (
        <Check
          aria-hidden="true"
          size={15}
          strokeWidth={2.25}
          className="text-emerald-600 dark:text-emerald-400"
        />
      )}
      {state === "offline" && (
        <CloudOff aria-hidden="true" size={15} strokeWidth={2} />
      )}
      {state === null ? null : WORDS[state]}
    </p>
  );
}
