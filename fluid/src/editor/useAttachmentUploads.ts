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
 *
 * "The screen" is the editor, not the buffer: a room that reconnects mounts a
 * new buffer (and a new copy of this hook) under the same editor. So an
 * editor holds an {@link UploadScreen} for its whole life and provides it
 * through {@link UploadScreenContext}; an upload started in the old buffer
 * then speaks through whichever buffer is there now, and only an editor that
 * has gone sends it to the notices.
 */

import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AssetHome } from "../api/files";
import { reportOrphanUpload } from "../uploadNotices";
import type { UploadProblemKind } from "./attachments";
import { attachmentUploads, uploadAttachments } from "./attachments";

/**
 * An editor screen, as the uploads started on it see it: whether it is still
 * there, and the error line of the buffer it shows now.
 */
export class UploadScreen {
  private gone = false;
  private line: ((message: string | null) => void) | null = null;

  /** The editor is on screen; the returned function says it has gone. */
  open(): () => void {
    this.gone = false;
    return () => {
      this.gone = true;
    };
  }

  /** A buffer shows its error line; the returned function takes it away. */
  register(line: (message: string | null) => void): () => void {
    this.line = line;
    return () => {
      if (this.line === line) {
        this.line = null;
      }
    };
  }

  /** Where to say something now: null once the editor has gone. */
  current(): ((message: string | null) => void) | null {
    return this.gone ? null : this.line;
  }
}

/** The editor screen the uploads below it belong to. */
export const UploadScreenContext = createContext<UploadScreen | null>(null);

/**
 * The editor's own {@link UploadScreen}, for the whole life of the editor:
 * call it where the screen is (outside any key that remounts the buffer)
 * and provide it through {@link UploadScreenContext}.
 */
export function useUploadScreen(): UploadScreen {
  const [screen] = useState(() => new UploadScreen());
  useEffect(() => screen.open(), [screen]);
  return screen;
}

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
  // The editor this buffer belongs to, when one is provided; without one
  // this buffer is the screen. `gone` is set on unmount and cleared on a
  // mount, so a development remount does not leave it set.
  const screen = useContext(UploadScreenContext);
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    const unregister = screen?.register((message) => {
      latest.current.onError(message);
    });
    return () => {
      gone.current = true;
      unregister?.();
    };
  }, [screen]);
  const attach = useCallback(
    (files: File[]) => {
      const { domain, home, place, view, onSettled } = latest.current;
      const onError = (message: string | null, kind?: UploadProblemKind) => {
        const line =
          screen === null
            ? gone.current
              ? null
              : latest.current.onError
            : screen.current();
        if (line !== null) {
          line(message);
        } else if (message !== null) {
          reportOrphanUpload(
            files.map((file) => file.name),
            latest.current.subject ?? "",
            message,
            kind,
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
    },
    [screen],
  );
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
