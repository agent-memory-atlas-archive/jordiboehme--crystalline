/**
 * What the sidebar remembers outside its own subtree.
 *
 * The sidebar is drawn in two places: a column from the medium breakpoint
 * up and a drawer below it. A window that crosses the breakpoint, or a
 * drawer that is shut and opened again, mounts the rows anew, so anything
 * held in them would be lost: folders a reader opened by hand, and a create
 * dialog with half-typed text. Both live here instead, provided once by the
 * frame (`Layout.tsx`), which also draws the dialogs.
 */

import { createContext, useContext, useEffect, useState } from "react";

/** A create dialog the sidebar asked for, with the control that asked. */
export type SidebarCreate =
  | { kind: "engram"; domain: string; launcher: HTMLElement | null }
  | {
      kind: "page";
      domain: string;
      folder: string;
      launcher: HTMLElement | null;
    };

export interface SidebarState {
  /** Folder key to open or shut, for every folder somebody has decided. */
  folders: Readonly<Record<string, boolean>>;
  setFolder: (key: string, open: boolean) => void;
  /** Open a create dialog; the frame draws it, outside the sidebar. */
  create: (request: SidebarCreate) => void;
}

export const SidebarStateContext = createContext<SidebarState | null>(null);

/** The frame's sidebar state, or null outside the frame (a bare test). */
export function useSidebarState(): SidebarState | null {
  return useContext(SidebarStateContext);
}

/**
 * Whether one folder of a sidebar tree is open, kept by the frame.
 *
 * `start` is what the folder would be on its own: open when the reader is
 * inside it. Once open it stays open until somebody shuts it, as before,
 * and that decision outlives the rows that draw it. Outside the frame the
 * state is the row's own.
 */
export function useFolderOpen(
  key: string,
  start: boolean,
): [boolean, (open: boolean) => void] {
  const shared = useSidebarState();
  const [local, setLocal] = useState(start);
  // The reader moving into a folder opens it, in the same render that
  // noticed (no flash of a shut folder); the frame is told after, and the
  // mark holds until somebody shuts the folder by hand.
  const [prev, setPrev] = useState(start);
  const [forced, setForced] = useState(false);
  if (prev !== start) {
    setPrev(start);
    if (start) {
      setLocal(true);
      setForced(true);
    }
  }
  const decided = shared?.folders[key];
  useEffect(() => {
    if (shared === null) {
      return;
    }
    if (forced && decided !== true) {
      shared.setFolder(key, true);
    } else if (decided === undefined && start) {
      // A folder that starts open is recorded, so leaving it later does
      // not fold it away: a folder never closes itself.
      shared.setFolder(key, true);
    }
  }, [shared, forced, decided, start, key]);
  if (shared === null) {
    return [local, setLocal];
  }
  return [
    forced || (decided ?? start),
    (open) => {
      setForced(false);
      shared.setFolder(key, open);
    },
  ];
}
