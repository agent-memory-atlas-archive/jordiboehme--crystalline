/**
 * The catching half of `lazyPart`: a failed chunk becomes a short message with
 * a button that tries the import again.
 */

import { Component, useId } from "react";
import type { ReactNode } from "react";

import { ChunkLoadError } from "../lazyChunk";
import { BUTTON } from "./primitives";

interface BoundaryProps {
  overlay: boolean;
  onClose: (() => void) | null;
  onRetry: () => void;
  children: ReactNode;
}

/** Catches a {@link ChunkLoadError} only; any other error goes on up. */
export class PartBoundary extends Component<BoundaryProps, { error: unknown }> {
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
      throw error as Error;
    }
    return (
      <PartFailed
        overlay={this.props.overlay}
        onClose={this.props.onClose}
        onRetry={() => {
          this.props.onRetry();
          this.setState({ error: null });
        }}
      />
    );
  }
}

function PartFailed({
  overlay,
  onClose,
  onRetry,
}: {
  overlay: boolean;
  onClose: (() => void) | null;
  onRetry: () => void;
}) {
  const id = useId();
  const body = (
    <div
      role="alert"
      aria-describedby={id}
      className="flex flex-wrap items-center gap-3"
    >
      <p id={id} className="text-sm text-slate-600 dark:text-slate-300">
        This part did not load. Try again.
      </p>
      <button type="button" onClick={onRetry} className={BUTTON.secondary}>
        Try again
      </button>
      {overlay && onClose !== null && (
        <button type="button" onClick={onClose} className={BUTTON.secondary}>
          Close
        </button>
      )}
    </div>
  );
  if (!overlay) {
    return body;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="rounded border border-slate-200 bg-white px-4 py-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        {body}
      </div>
    </div>
  );
}
