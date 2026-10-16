/**
 * The catching half of `lazyPart`: a failed chunk becomes a short message with
 * a button that tries the import again, and after a second failure one that
 * reloads the page, as the route-level prompt does.
 *
 * For a dialog (`overlay`) the message is a small modal of its own: named,
 * keeping the focus inside, closed by Escape. It is hand-built rather than a
 * Radix dialog because the point of the parts it stands in for is to keep that
 * code out of the entry bundle.
 */

import { Component, useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { ChunkLoadError } from "../lazyChunk";
import { BUTTON } from "./primitives";

interface BoundaryProps {
  overlay: boolean;
  onClose: (() => void) | null;
  /** Where the focus goes when the card is closed. */
  returnTo: HTMLElement | null;
  /** How many imports of this part have failed in a row. */
  failures: () => number;
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
    const { overlay, onClose, returnTo, failures } = this.props;
    return (
      <PartFailed
        overlay={overlay}
        reload={failures() >= 2}
        onClose={
          onClose === null
            ? null
            : () => {
                onClose();
                if (returnTo?.isConnected === true) {
                  returnTo.focus();
                }
              }
        }
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
  reload,
  onClose,
  onRetry,
}: {
  overlay: boolean;
  reload: boolean;
  onClose: (() => void) | null;
  onRetry: () => void;
}) {
  const retry = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    retry.current?.focus();
  }, []);

  const body = (
    <div role={overlay ? undefined : "alert"} className="flex flex-col gap-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {reload
          ? "This part did not load. Try again, or reload the page to get the newest version."
          : "This part did not load. Try again."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          ref={retry}
          type="button"
          onClick={onRetry}
          className={BUTTON.secondary}
        >
          Try again
        </button>
        {reload && (
          <button
            type="button"
            onClick={() => {
              location.reload();
            }}
            className={BUTTON.secondary}
          >
            Reload the page
          </button>
        )}
        {overlay && onClose !== null && (
          <button type="button" onClick={onClose} className={BUTTON.secondary}>
            Close
          </button>
        )}
      </div>
    </div>
  );
  if (!overlay) {
    return body;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && onClose !== null) {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    // Keep the focus on the card's own buttons.
    const buttons = Array.from(
      card.current?.querySelectorAll<HTMLElement>("button") ?? [],
    );
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label="Not loaded"
        onKeyDown={onKeyDown}
        className="rounded border border-slate-200 bg-white px-4 py-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        {body}
      </div>
    </div>
  );
}
