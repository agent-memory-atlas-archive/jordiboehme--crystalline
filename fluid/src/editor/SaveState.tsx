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
  room = false,
}: {
  state: SaveStateKind | null;
  /**
   * In a room the server saves every second or two while people type, and a
   * screen reader hearing "Saving", "Saved" on every round trip would hear
   * nothing else. There only "Offline" is announced; the room's saving and
   * saved are shown, not read out.
   */
  room?: boolean;
}): ReactElement {
  const tone =
    state === "offline"
      ? "text-amber-700 dark:text-amber-300"
      : "text-slate-500 dark:text-slate-400";
  const face = `inline-flex items-center gap-1.5 text-sm whitespace-nowrap ${tone}`;
  const content =
    state === null ? null : (
      <>
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
        {WORDS[state]}
      </>
    );
  const announced = !room || state === "offline";
  // One status region, mounted for the life of the editor and empty when
  // there is nothing to announce: a region that appears with its text already
  // in it is not announced, one whose text changes is.
  return (
    <span data-save-state={state ?? undefined} className="inline-flex">
      <span role="status" className={face}>
        {announced ? content : null}
      </span>
      {!announced && <span className={face}>{content}</span>}
    </span>
  );
}
