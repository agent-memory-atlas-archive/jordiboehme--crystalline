/**
 * Where a page hands its outline to the frame.
 *
 * On a phone the outline does not sit in the page's own rail but at the top
 * of the sidebar drawer, which the frame draws. The page builds the rendered
 * outline and fills this slot, so the frame never imports the outline's code;
 * the drawer shows the node and `close` shuts it after a link.
 */

import type { ReactNode } from "react";
import { createContext, useContext, useEffect } from "react";

export interface OutlineSlot {
  node: ReactNode;
  set: (node: ReactNode) => void;
  /** Shut the drawer. */
  close: () => void;
}

export const OutlineSlotContext = createContext<OutlineSlot | null>(null);

/** Fill the frame's slot while `node` is non-null; empty it on the way out. */
export function useOutlineSlot(node: ReactNode): void {
  const slot = useContext(OutlineSlotContext);
  const set = slot?.set;
  useEffect(() => {
    if (!set || node === null) {
      return;
    }
    set(node);
    return () => {
      set(null);
    };
  }, [set, node]);
}
