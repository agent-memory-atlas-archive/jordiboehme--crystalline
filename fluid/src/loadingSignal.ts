/**
 * The tiny bus between the loading block and the READY. flash: a loader tells
 * it when it appears and disappears, and the flash (drawn once, over the
 * content area) listens. No screen knows about any of it.
 *
 * A loader that goes away only counts as "the content arrived" when no other
 * loader took its place in the same commit (a route's chunk fallback handing
 * over to the screen's own loader is one wait, not two), so the check runs in
 * a microtask, after the commit's effects have all run.
 */

export type LoadingEvent =
  | { kind: "busy" }
  /** `key` is the router location key the loader mounted under. */
  | { kind: "ready"; key: string };

let shown = 0;
const listeners = new Set<(event: LoadingEvent) => void>();

function emit(event: LoadingEvent): void {
  for (const listener of [...listeners]) {
    listener(event);
  }
}

/**
 * A loader appeared under the router location `key`. Returns the call for
 * when it goes away; the listener decides from the key whether that was
 * navigation (not content arriving).
 */
export function loaderShown(key: string): () => void {
  shown += 1;
  emit({ kind: "busy" });
  return () => {
    shown -= 1;
    queueMicrotask(() => {
      if (shown === 0) {
        emit({ kind: "ready", key });
      }
    });
  };
}

export function onLoadingEvent(
  listener: (event: LoadingEvent) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
