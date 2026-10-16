/**
 * Done in a room: the server saves the room on its own, so leaving is usually
 * just leaving. A standing conflict holds every save, so Done keeps the text
 * as a draft at once and says so. Not while that save is owed - a save in flight, a refused one,
 * a conflict, or the socket away. Then Done asks the room to save now and
 * waits a moment for it to land; once it has, the editor leaves. If it does
 * not land in time, the text is kept as a draft on this device, the editor
 * says so, and leaves a beat later. Nothing is lost without a word.
 */

import type { MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { CollabSession } from "../collab/useCollabSession";

/** How long Done waits for an owed save to land, in milliseconds. */
export const ROOM_EXIT_WAIT_MS = 2500;

/** How long the "kept as a draft" sentence stays before the editor leaves. */
export const ROOM_EXIT_NOTICE_MS = 1500;

export type RoomExitPhase = "idle" | "waiting" | "kept";

export function useRoomExit(
  collab: Pick<CollabSession, "saveState" | "status" | "flush" | "conflict">,
  /** Keep this tab's text as a draft (each editor's own keeper). */
  keep: () => void,
  /** Go to the reading page. */
  leave: () => void,
  /** The room has ended: whatever it owed is already kept by the editor's
   *  own close handling, and there is no save left to wait for. */
  ended = false,
): {
  phase: RoomExitPhase;
  /** For the Done link: lets a settled room go, holds an owed one. */
  onDone: (event: MouseEvent) => void;
} {
  const [phase, setPhase] = useState<RoomExitPhase>("idle");
  const settled =
    ended || (collab.saveState === "ok" && collab.status === "connected");
  // The latest callbacks, read when a timer fires rather than captured when
  // it was set: both are rebuilt on renders the room causes.
  const keepRef = useRef(keep);
  const leaveRef = useRef(leave);
  useEffect(() => {
    keepRef.current = keep;
    leaveRef.current = leave;
  });

  useEffect(() => {
    if (phase !== "waiting") {
      return undefined;
    }
    if (settled) {
      leaveRef.current();
      return undefined;
    }
    const timer = setTimeout(() => {
      keepRef.current();
      setPhase("kept");
    }, ROOM_EXIT_WAIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [phase, settled]);

  useEffect(() => {
    if (phase !== "kept") {
      return undefined;
    }
    const timer = setTimeout(() => {
      leaveRef.current();
    }, ROOM_EXIT_NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [phase]);

  return {
    phase,
    onDone: (event) => {
      if (settled) {
        // Nothing owed: the link goes at once.
        return;
      }
      event.preventDefault();
      if (phase !== "idle") {
        // A second press while waiting does not start a second wait.
        return;
      }
      if (collab.conflict !== null || collab.saveState === "conflict") {
        // A standing conflict holds every save until somebody resolves it,
        // so there is nothing to wait for: the text is kept at once.
        keep();
        setPhase("kept");
        return;
      }
      collab.flush();
      setPhase("waiting");
    },
  };
}
