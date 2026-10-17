/**
 * `lazy()` for a part of Fluid that ships in its own chunk, with one change:
 * a failed import is marked as a {@link ChunkLoadError}.
 *
 * An import fails when the chunk cannot be fetched, most often in a tab left
 * open across a deploy: the page still names the old chunk hashes and the
 * server no longer has them. Vite's preload helper rejects the same import
 * promise when a chunk's preloaded dependency fails (after it fires
 * `vite:preloadError`), so this one wrapper sees both cases and no window
 * listener is needed.
 *
 * The mark is what lets `LazyBoundary` catch exactly this and nothing else:
 * an error thrown while a screen renders is a bug, and it must keep failing
 * loudly in tests and in the console rather than turn into a reload prompt.
 */

import { lazy } from "react";

/** A lazy part's import was refused or never arrived. */
export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super("a part of Fluid could not be loaded", { cause });
    this.name = "ChunkLoadError";
  }
}

/**
 * `React.lazy`, with a failed import rethrown as a {@link ChunkLoadError}.
 * Typed as `lazy` itself, so a call reads and infers exactly like one.
 */
export const lazyChunk: typeof lazy = (load) =>
  lazy(() =>
    load().catch((cause: unknown) => {
      // The screen says "could not load" for a module that threw while it
      // evaluated as well as for a missing chunk; keep the original visible.
      console.error(cause);
      throw new ChunkLoadError(cause);
    }),
  );
