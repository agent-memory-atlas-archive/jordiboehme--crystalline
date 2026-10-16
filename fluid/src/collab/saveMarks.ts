/**
 * How an editor in a room tells the save after a kept text apart from the
 * saves before it, for the kept text note.
 *
 * A room that answers flush marks gets one with an immediate flush, sent
 * only on a live connection; the first save that began after it names it,
 * and the note drops the kept copy on its own. A room from before marks
 * cannot tell its saves apart: the note then asks the person after the next
 * save receipt, and never drops on its own.
 */

import type {
  SaveMark,
  SaveMarked,
  SaveStatus,
} from "../editor/KeptTextNotice";
import type { CollabSession } from "./useCollabSession";

/**
 * A fresh mark: random, at most 64 characters (the room's limit). From
 * `crypto.randomUUID` where the browser has it, else from random bytes.
 */
export function newMark(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The note's save props for an editor bound to `collab`. */
export function roomSaveMarks(collab: CollabSession): {
  markSave: () => SaveMarked | null;
  saveStatus: (mark: SaveMark) => SaveStatus;
  releaseMark: (mark: SaveMark) => void;
} {
  return {
    markSave: () => {
      if (!collab.live) {
        return null;
      }
      if (!collab.marksSupported) {
        // Asked now all the same; the next receipt is the person's cue.
        collab.flush();
        return { mark: collab.receipts, auto: false };
      }
      const mark = newMark();
      return collab.flush(mark) ? { mark, auto: true } : null;
    },
    saveStatus: (mark) => {
      if (typeof mark === "number") {
        if (collab.closed) {
          return "lost";
        }
        return collab.receipts > mark ? "saved" : "waiting";
      }
      const status = collab.markStatus(mark);
      return status === "unknown" ? "lost" : status;
    },
    releaseMark: (mark) => {
      if (typeof mark === "string") {
        collab.releaseMark(mark);
      }
    },
  };
}
