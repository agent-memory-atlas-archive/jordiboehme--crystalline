/**
 * One upload flow, three ways in, wired to a screen.
 *
 * The buffer's extensions are read once at mount, so the paste and drop
 * handlers cannot close over this render's values: they close over a ref that
 * every later render refreshes instead. That is what lets the same extension
 * live for the life of the buffer while still uploading into whatever view and
 * domain the screen holds now - and it is why `attach`, which the toolbar's
 * picker calls, is the same stable function rather than a second path with its
 * own copy of the rules.
 *
 * An upload can outlive its screen: the person presses Done or follows a link
 * while the bytes are on their way. What it has to say after that (a failure,
 * or a file stored without its link) goes to the app-wide upload notices,
 * naming the files and the page, rather than to a screen nobody sees.
 */

import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { AssetHome } from "../api/files";
import { reportOrphanUpload } from "../uploadNotices";
import { attachmentUploads, uploadAttachments } from "./attachments";

/** What a screen needs to offer uploads on its buffer. */
export interface AttachmentUploadOptions {
  /** The domain the files are stored in. */
  domain: string;
  /**
   * Where the files are stored and how the buffer links to them. Absent, it
   * is the engram home of {@link domain}.
   */
  home?: AssetHome;
  /** Runs right before the references are inserted, and may move the caret. */
  place?: (view: EditorView) => void;
  /** The live buffer, read at the moment of the upload rather than at mount. */
  view: () => EditorView | null;
  /** A refusal in words an author can act on; null clears a standing one. */
  onError: (message: string | null) => void;
  /**
   * What the screen edits, as a person names it (a title, or a path): an
   * upload that fails after its screen has gone is reported app-wide with
   * this name, since `onError` then reaches nobody.
   */
  subject?: string;
  /**
   * Runs once a batch has finished, whatever it stored: a screen that shows
   * the home's listing refreshes it here.
   */
  onSettled?: () => void;
}

/** The two halves a screen wires: into the buffer, and onto the toolbar. */
export interface AttachmentUploads {
  /** The paste and drop handlers, stable for the life of the buffer. */
  extension: Extension;
  /** What the toolbar's file picker hands its files to. */
  attach: (files: File[]) => void;
}

export function useAttachmentUploads(
  options: AttachmentUploadOptions,
): AttachmentUploads {
  const latest = useRef(options);
  // Written after the render rather than during it: what the handlers read is
  // always the last committed render's values.
  useEffect(() => {
    latest.current = options;
  });
  // Whether the screen has gone. Set on unmount and cleared on a mount, so a
  // development remount does not leave it set.
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);
  const attach = useCallback((files: File[]) => {
    const { domain, home, place, view, onSettled } = latest.current;
    const onError = (message: string | null) => {
      if (!gone.current) {
        latest.current.onError(message);
      } else if (message !== null) {
        reportOrphanUpload(
          files.map((file) => file.name),
          latest.current.subject ?? "",
          message,
        );
      }
    };
    const target = view();
    if (target === null) {
      return;
    }
    void uploadAttachments({
      ...(home === undefined ? { domain } : { home }),
      ...(place === undefined ? {} : { place }),
      files,
      view: target,
      onError,
    }).finally(() => {
      onSettled?.();
    });
  }, []);
  const extension = useMemo(
    // `attachmentUploads` only stores this callback in the DOM handlers
    // CodeMirror runs from a paste or a drop, so nothing on this call stack
    // reads `latest.current` during the render - but the checker cannot see
    // through the call to confirm it.
    // eslint-disable-next-line react-hooks/refs
    () => attachmentUploads(attach),
    [attach],
  );
  return { extension, attach };
}
