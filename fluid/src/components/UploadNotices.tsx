/**
 * The host of the notices about uploads whose screen has gone
 * (`uploadNotices.ts`). Mounted once at the top of the app, so a notice is
 * shown on whatever screen the person went to. Each one stays until it is
 * dismissed: it names a file that did not arrive, or arrived without its
 * link, and a notice that faded on its own could go unread.
 */

import { Toast } from "radix-ui";
import type { ReactElement } from "react";
import { useSyncExternalStore } from "react";

import {
  dismissUploadNotice,
  subscribeUploadNotices,
  uploadNotices,
} from "../uploadNotices";

export function UploadNotices(): ReactElement | null {
  const notices = useSyncExternalStore(subscribeUploadNotices, uploadNotices);
  if (notices.length === 0) {
    return null;
  }
  return (
    <Toast.Provider duration={Infinity} label="Upload notice">
      {notices.map((notice) => (
        <Toast.Root
          key={notice.id}
          open
          onOpenChange={(open) => {
            if (!open) {
              dismissUploadNotice(notice.id);
            }
          }}
          className="flex items-start gap-3 rounded border border-hair bg-raised px-4 py-3 text-sm text-ink shadow-lg"
        >
          <div className="flex flex-col gap-0.5">
            <Toast.Title className="font-medium">{notice.title}</Toast.Title>
            <Toast.Description className="text-ink-2">
              {notice.detail}
            </Toast.Description>
          </div>
          <Toast.Close
            aria-label="Dismiss"
            className="ml-auto rounded px-1 hover:bg-sunken focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:outline-none dark:focus-visible:ring-accent-400"
          >
            <span aria-hidden="true">x</span>
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport className="fixed right-4 bottom-4 z-50 flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2 outline-none" />
    </Toast.Provider>
  );
}
