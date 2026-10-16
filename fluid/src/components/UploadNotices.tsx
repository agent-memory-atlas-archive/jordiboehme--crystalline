/**
 * The host of the notices about uploads whose screen has gone
 * (`uploadNotices.ts`). Mounted once at the top of the app, so a notice is
 * shown on whatever screen the person went to. Each one stays until it is
 * dismissed: it names a file that did not arrive, or arrived without its
 * link, and a notice that faded on its own could go unread.
 *
 * Plain alerts in the corner the version notice uses, stacked above it, and
 * on purpose not toasts of the toast library: a toast there is a dismissable
 * layer, and the newest layer takes every Escape on the page, so a notice
 * that arrived while a dialog was open would keep that dialog from closing.
 * Only the Dismiss button takes a notice down. When the last one goes and it
 * held the focus, the focus goes back to where it was before it came here.
 */

import type { FocusEvent, ReactElement } from "react";
import { useRef, useSyncExternalStore } from "react";

import type { UploadNotice } from "../uploadNotices";
import {
  dismissUploadNotice,
  subscribeUploadNotices,
  uploadNotices,
} from "../uploadNotices";

export function UploadNotices(): ReactElement | null {
  const notices = useSyncExternalStore(subscribeUploadNotices, uploadNotices);
  const region = useRef<HTMLElement | null>(null);
  // Where the focus was before it entered the notices.
  const before = useRef<HTMLElement | null>(null);
  if (notices.length === 0) {
    return null;
  }
  const dismiss = (notice: UploadNotice) => {
    const held =
      region.current !== null &&
      region.current.contains(document.activeElement);
    const rest = notices.filter((other) => other.id !== notice.id);
    dismissUploadNotice(notice.id);
    if (!held) {
      return;
    }
    const next = rest[0];
    if (next !== undefined) {
      // Another notice is still there: its own Dismiss takes the focus.
      queueMicrotask(() => {
        region.current
          ?.querySelector<HTMLElement>(`[data-notice="${String(next.id)}"]`)
          ?.focus();
      });
    } else if (before.current?.isConnected === true) {
      before.current.focus();
    }
  };
  return (
    <section
      ref={region}
      aria-label="Upload notices"
      onFocus={(event: FocusEvent<HTMLElement>) => {
        const from = event.relatedTarget;
        if (
          from instanceof HTMLElement &&
          !event.currentTarget.contains(from)
        ) {
          before.current = from;
        }
      }}
      className="pointer-events-auto flex w-full max-w-md flex-col gap-2"
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          role="alert"
          className="flex items-start gap-3 rounded border border-hair bg-raised px-4 py-3 text-sm text-ink shadow-lg"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-medium">{notice.title}</p>
            <p className="break-words text-ink-2">{notice.detail}</p>
          </div>
          <button
            type="button"
            data-notice={notice.id}
            aria-label={`Dismiss: ${notice.files.join(", ")}`}
            onClick={() => {
              dismiss(notice);
            }}
            className="ml-auto rounded px-1 hover:bg-sunken focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:outline-none dark:focus-visible:ring-accent-400"
          >
            <span aria-hidden="true">x</span>
          </button>
        </div>
      ))}
    </section>
  );
}
