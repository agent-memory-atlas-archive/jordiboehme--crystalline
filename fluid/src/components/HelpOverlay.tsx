/**
 * The launcher's own seam for the shortcut map.
 *
 * The dialog primitive lives behind a lazy import in `HelpOverlayBody.tsx`,
 * the same split every other dialog in this app uses: the frame mounts this on
 * every screen, so a help overlay nobody opened must not put Radix's dialog
 * code in the chunk that draws the first page.
 */

import type { ReactElement } from "react";
import { lazyPart } from "./lazyPart";

const HelpOverlayBody = lazyPart(() => import("./HelpOverlayBody"));

export interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
  /**
   * Where focus goes when the map closes, when it was opened from a menu item.
   * The item is gone by then and the dialog mounts lazily, so it cannot have
   * noted the trigger itself; each opener sets it, to the button or to null,
   * so a stale value never survives. Null means the dialog's default.
   */
  returnFocusTo?: HTMLElement | null | undefined;
}

export function HelpOverlay({
  open,
  onClose,
  returnFocusTo,
}: HelpOverlayProps): ReactElement {
  return (
    <>
      {open && (
        <HelpOverlayBody
          overlay
          fallback={null}
          onClose={onClose}
          returnFocusTo={returnFocusTo}
        />
      )}
    </>
  );
}
