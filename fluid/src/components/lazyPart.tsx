/**
 * A lazy part of a screen (a dialog body, the Markdown renderer, the graph
 * canvas, the diff pane) with its own way out when the chunk does not arrive.
 *
 * `LazyBoundary` serves the routes and answers a failed chunk with a reload,
 * because a route is the whole screen and a deploy that removed its chunk
 * has usually changed the page around it too. A part is smaller: the screen
 * around it is fine, and a lost network is more often the cause than a
 * deploy. So this one offers "Try again" in the part's place and does
 * not touch the rest of the screen.
 *
 * Trying again has to call `import()` again. React keeps a rejected lazy
 * component for the life of the page, so the retry builds a fresh `lazy` over
 * the same loader. The new one is made only when the old one failed, so a
 * part that loaded stays mounted as it was. A second failure in a row also
 * offers a reload, which is what a chunk removed by a deploy needs.
 */

import { Suspense, lazy, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import { ChunkLoadError } from "../lazyChunk";
import { PartBoundary } from "./PartBoundary";

/** What a part takes on top of its own props. */
export interface PartFrame {
  /** What shows while the chunk is on the way. */
  fallback: ReactNode;
  /**
   * Set for a dialog, whose fallback is a card over a dimmed screen: the
   * failure then takes the same place, and "Close" calls the part's own
   * `onClose` prop.
   */
  overlay?: boolean;
}

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

/**
 * The part behind `load`, as a component taking its own props plus a
 * {@link PartFrame}. Call it once at module level, as `lazy` is.
 */
export function lazyPart<P extends object>(
  load: Loader<P>,
): ComponentType<P & PartFrame> {
  let failed = false;
  // How many imports of this part have failed since one last worked.
  let failures = 0;
  const make = () =>
    lazy<ComponentType<P>>(() =>
      load().then(
        (module) => {
          failures = 0;
          return module;
        },
        (cause: unknown) => {
          failed = true;
          failures += 1;
          // The part shows "did not load" for a module that threw while it
          // evaluated as well as for a chunk that never arrived; the original
          // stays in the console so that bug is not hidden by the message.
          console.error(cause);
          throw new ChunkLoadError(cause);
        },
      ),
    );
  let Body = make();

  function retry(): void {
    if (failed) {
      failed = false;
      Body = make();
    }
  }

  // Reads `Body` when it renders, not when `Part` does: after a retry the
  // boundary mounts this afresh, and it must pick up the new `lazy`.
  function Slot(props: P) {
    return <Body {...props} />;
  }

  return function Part(all: P & PartFrame) {
    // A part mounted again after a failure (a dialog opened a second time)
    // starts a new import rather than meeting the old rejection.
    useState(retry);
    const { fallback, overlay = false, ...rest } = all;
    const { onClose, returnFocusTo } = rest as {
      onClose?: unknown;
      returnFocusTo?: unknown;
    };
    // Where the focus goes when the failure card is closed: the opener the
    // part names, else whatever had the focus when the part was mounted.
    const [cameFrom] = useState(() => document.activeElement);
    const goesTo =
      returnFocusTo instanceof HTMLElement ? returnFocusTo : cameFrom;
    return (
      <PartBoundary
        overlay={overlay}
        onClose={typeof onClose === "function" ? (onClose as () => void) : null}
        returnTo={goesTo instanceof HTMLElement ? goesTo : null}
        failures={() => failures}
        onRetry={retry}
      >
        <Suspense fallback={fallback}>
          <Slot {...(rest as unknown as P)} />
        </Suspense>
      </PartBoundary>
    );
  };
}
