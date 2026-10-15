/**
 * The boundary every lazy part of Fluid waits behind: `Suspense` with the
 * part's own loading shape while its chunk is on the way, and a short
 * message with a reload button if the chunk never arrives.
 *
 * Only a {@link ChunkLoadError} is caught (see `lazyChunk.ts`). Any other
 * error is thrown on from here, so a bug in a screen still fails a test and
 * still reaches the console the way it did before this boundary existed.
 * React keeps a failed lazy import's rejection for the life of the page, so
 * trying again in place cannot work; a reload fetches the new `index.html`
 * and the chunk names that go with it.
 */

import { Component, Suspense } from "react";
import type { ReactNode } from "react";

import { ChunkLoadError } from "../lazyChunk";
import { BUTTON } from "./primitives";

export function LazyBoundary({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}

class ChunkErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    if (!(error instanceof ChunkLoadError)) {
      // Not ours: pass it up to whatever would have caught it before. React
      // hands a boundary whatever was thrown, typed as unknown; it is thrown
      // on exactly as it arrived.
      throw error as Error;
    }
    return <ChunkFailed />;
  }
}

function ChunkFailed() {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        This part of Fluid could not load. Reload the page to get the newest
        version.
      </p>
      <button
        type="button"
        onClick={() => {
          location.reload();
        }}
        className={BUTTON.secondary}
      >
        Reload
      </button>
    </div>
  );
}
