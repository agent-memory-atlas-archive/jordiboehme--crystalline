/**
 * One reflection, edited live.
 *
 * The editor is the room and only the room: people and agents edit the same
 * text at once, saves land in the file without a draft, and there is no
 * second, solo save path. A room that cannot be joined says so and offers to
 * try again. The section id lines stay in the text, hidden; the frontmatter
 * folds to its chip, as it does in the engram editor.
 *
 * A daemon that restarted while this tab was away (a laptop that slept)
 * greets the reconnect with a new session; the hook keeps what this tab had
 * as a draft under the room's key first, and the next mount of this screen
 * offers it back.
 *
 * The Reflection's status and this person's right decide whether the room is
 * opened at all, once. After that the room is the authority: a status that
 * turns off or a refetch that fails is shown beside the editor, and the room
 * ends the session itself with its own `closed` control. Unmounting a live
 * room over a status refetch would drop text the server has not saved.
 */

import type { Extension } from "@codemirror/state";
import { Compartment, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { EditorView as View, keymap } from "@codemirror/view";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";

import { problemDetail } from "../api/client";
import {
  assetVersions,
  fetchReflection,
  fetchReflectionAssets,
  reflectionAssetHome,
  reflectionAssetsKey,
  reflectionKey,
} from "../api/reflection";
import { mayEditPage } from "../api/reflectionDomains";
import { useAuth } from "../auth/AuthContext";
import { CollabConflictDialog } from "../collab/CollabConflictDialog";
import { normalizePastedEndings } from "../collab/pastedEndings";
import { PresenceChips } from "../collab/PresenceChips";
import {
  reflectionCollabUrl,
  reflectionOfferKey,
  reflectionRoomKey,
} from "../collab/provider";
import type { CollabSession } from "../collab/useCollabSession";
import { useCollabSession } from "../collab/useCollabSession";
import { useReflectionStatus } from "../components/ReflectionModeSwitch";
import { ReflectionStateNotice } from "../components/ReflectionStateNotice";
import { BUTTON } from "../components/primitives";
import { Skeleton } from "../components/Skeleton";
import { AttachButton } from "../editor/AttachButton";
import CmEditor from "../editor/CmEditor";
import type { Draft } from "../editor/drafts";
import { assetRefsIn } from "../editor/imageFormat";
import { clearDraft, readDraft, writeDraft } from "../editor/drafts";
import { frontmatterFold } from "../editor/frontmatterFold";
import { hiddenIdLines } from "../editor/hiddenIdLines";
import { imagePreviews } from "../editor/imagePreviews";
import { livePreview } from "../editor/preview";
import { baseExtensions } from "../editor/setup";
import { useAttachmentUploads } from "../editor/useAttachmentUploads";
import { reflectionPageRoute } from "../paths";
import { stripIdLines, stripProvenance } from "../reflectionText";
import { useTheme } from "../theme/context";

const LINK =
  "text-sky-700 underline underline-offset-2 hover:no-underline dark:text-sky-400";
const ALERT =
  "rounded bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";
/** The session banners' faces, as the engram editor draws them. */
const AMBER_BANNER =
  "flex flex-wrap items-baseline gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100";
const RED_BANNER =
  "flex flex-wrap items-baseline gap-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100";
const BANNER_BUTTON = "underline underline-offset-2 hover:no-underline";

export default function ReflectionEditor(): ReactElement {
  const { domain = "", "*": path = "" } = useParams();
  const status = useReflectionStatus(domain);
  const [attempt, setAttempt] = useState(0);
  const [admitted, setAdmitted] = useState(false);
  const data = status.data;
  const opens =
    data !== undefined && data.state === "on" && mayEditPage(data.right, path);
  if (opens && !admitted) {
    // Decided once: see the module comment.
    setAdmitted(true);
  }
  if (!admitted && !opens) {
    if (data === undefined) {
      return status.isPending ? (
        <Skeleton label="Loading the page" rows={6} />
      ) : (
        <p role="alert" className={ALERT}>
          {problemDetail(status.error)}
        </p>
      );
    }
    if (data.state !== "on") {
      return <ReflectionStateNotice status={data} />;
    }
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p>
          {data.right === "none"
            ? "You cannot edit this page."
            : "You can comment on this page, but not edit it."}
        </p>
        {data.right !== "none" && (
          <Link to={reflectionPageRoute(domain, path)} className={LINK}>
            Back to the page
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {status.error !== null ? (
        <p role="alert" className={ALERT}>
          {problemDetail(status.error)}
        </p>
      ) : (
        data !== undefined &&
        data.state !== "on" && <ReflectionStateNotice status={data} />
      )}
      <Room
        key={attempt}
        domain={domain}
        path={path}
        retried={attempt > 0}
        onRetry={() => {
          setAttempt(attempt + 1);
        }}
      />
    </div>
  );
}

function Room({
  domain,
  path,
  retried,
  onRetry,
}: {
  domain: string;
  path: string;
  /** Whether this mount is a "Try again": focus then goes somewhere useful. */
  retried: boolean;
  onRetry: () => void;
}): ReactElement {
  const { user } = useAuth();
  const account = user?.name ?? "anonymous";
  const target = useMemo(
    () => ({
      url: reflectionCollabUrl(domain, path),
      // The room holds the page without its provenance block, so the text a
      // conflict is judged against leaves it out too.
      readCurrent: () =>
        fetchReflection(domain, path).then((doc) =>
          stripProvenance(doc.markdown),
        ),
    }),
    [domain, path],
  );
  const collab = useCollabSession({
    domain,
    permalink: reflectionRoomKey(path),
    account,
    displayName: user?.display ?? user?.name ?? "someone",
    enabled: true,
    room: target,
  });
  const connecting =
    collab.mode === "connecting" ||
    (collab.mode === "collab" && collab.ytext === null);
  const failed =
    !connecting &&
    (collab.mode === "solo" ||
      collab.ytext === null ||
      collab.awareness === null);
  // The button that was pressed is gone with the room it remounted; when the
  // new room fails too, focus goes back to the new button.
  const retry = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (retried && failed) {
      retry.current?.focus();
    }
  }, [retried, failed]);
  if (connecting) {
    return <Skeleton label="Connecting the session" rows={8} />;
  }
  if (failed) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p>Live editing is not available right now.</p>
        <button
          ref={retry}
          type="button"
          onClick={onRetry}
          className={BUTTON.secondary}
        >
          Try again
        </button>
        <Link to={reflectionPageRoute(domain, path)} className={LINK}>
          Back to the page
        </Link>
      </div>
    );
  }
  return (
    <Surface
      key={collab.epoch ?? ""}
      domain={domain}
      path={path}
      collab={collab}
      account={account}
      focusOnReady={retried}
    />
  );
}

/**
 * What the banner says once the room has ended, by the server's reason and
 * the room's last save verdict. Only "ok" means the text landed: a refused
 * save, a conflict (whose close saves nothing) and a save still in flight
 * all leave the text with this tab.
 */
function endedSentence(
  reason: string | null,
  saveState: CollabSession["saveState"],
): string {
  if (reason === "deleted") {
    return "This page was deleted; your text is kept as a draft";
  }
  if (saveState !== "ok") {
    return "The session ended; your text is kept as a draft";
  }
  return reason === "switched_off"
    ? "The Reflection was switched off. Your text was saved first."
    : "The session ended. Your text was saved.";
}

/**
 * Whether a kept draft says something the room does not. Id lines are left
 * out on both sides: a save adds an id under a new `##`, and a draft written
 * before that save would otherwise differ from the room by bookkeeping alone.
 */
function differsFromRoom(draft: Draft, room: string): boolean {
  const kept = stripIdLines(draft.content.replace(/\r\n/g, "\n"));
  return kept !== stripIdLines(room);
}

/** The editor's switch for a room that has ended: the text stays, typing stops. */
function readOnly(ended: boolean): Extension {
  return ended ? [View.editable.of(false), EditorState.readOnly.of(true)] : [];
}

function Surface({
  domain,
  path,
  collab,
  account,
  focusOnReady,
}: {
  domain: string;
  path: string;
  collab: CollabSession;
  account: string;
  focusOnReady: boolean;
}): ReactElement {
  const { resolved } = useTheme();
  const queryClient = useQueryClient();
  const ytext = collab.ytext as Y.Text;
  const awareness = collab.awareness as NonNullable<CollabSession["awareness"]>;
  // Two keys, two jobs: `key` is the copy that follows the live text (the
  // hook's epoch-gap draft lands there too), `offerKey` holds text set aside
  // for a later mount, which that copy can therefore never overwrite.
  const key = reflectionRoomKey(path);
  const offerKey = reflectionOfferKey(path);

  /*
   * The room has ended: closed by the server, or a connection refused for
   * good after the join (a 44xx close without a `closed` control), which
   * leaves a room nobody will save from here either.
   */
  const ended = collab.closed || collab.status === "failed";
  /*
   * What this tab owes the person: text the server has not confirmed while
   * something stands between it and the file (a refusal, a conflict, a lost
   * connection, an ended room). A latch rather than a reading of the current
   * verdict, because a keystroke after a refusal turns the verdict into
   * "pending" and the server does not repeat the same refusal; only the next
   * landed save (or a healthy connection with nothing pending) releases it.
   * An ended room whose last verdict is "ok" owes nothing, unless the page
   * was deleted: then the text in this tab is the only copy left.
   */
  const healthy =
    !ended && collab.saveState === "ok" && collab.status === "connected";
  const troubled =
    ended ||
    collab.saveState === "failed" ||
    collab.saveState === "conflict" ||
    collab.status !== "connected";
  const latches =
    troubled &&
    !(ended && collab.saveState === "ok" && collab.closedReason !== "deleted");
  const [owed, setOwed] = useState(latches);
  const [wasHealthy, setWasHealthy] = useState(healthy);
  // The server's refusal, held while the latch holds: a keystroke clears the
  // hook's `saveDetail`, but the sentence is still true until a save lands.
  const [refusal, setRefusal] = useState<string | null>(null);
  if (healthy !== wasHealthy) {
    setWasHealthy(healthy);
    if (healthy) {
      setOwed(false);
      setRefusal(null);
    }
  }
  if (latches && !owed) {
    setOwed(true);
  }
  if (
    collab.saveState === "failed" &&
    collab.saveDetail !== null &&
    collab.saveDetail !== refusal
  ) {
    setRefusal(collab.saveDetail);
  }

  /*
   * What this mount finds: a copy left under `key` by an earlier mount (a
   * refusal, a lost connection, an epoch gap) and an offer under `offerKey`.
   * Either is offered when it says something the room does not; the copy is
   * the newer work, so it wins and moves to the offer key (an older offer
   * that differs as well is then replaced). Read here, moved by the effect
   * below, so a render stays free of storage writes.
   */
  const [found] = useState(() => {
    const room = ytext.toJSON();
    const copy = readDraft(account, domain, key);
    const offered = readDraft(account, domain, offerKey);
    const copyDiffers = copy !== null && differsFromRoom(copy, room);
    const offerDiffers = offered !== null && differsFromRoom(offered, room);
    return {
      copy,
      offered,
      copyDiffers,
      offer: copyDiffers ? copy : offerDiffers ? offered : null,
    };
  });
  const [kept, setKept] = useState<Draft | null>(found.offer);
  // Whether the copy under `key` is this mount's own.
  const wrote = useRef(false);
  const [resolving, setResolving] = useState(false);
  const [mountText] = useState(() => ytext.toJSON());
  const [mountEnded] = useState(ended);
  const [view, setView] = useState<EditorView | null>(null);
  /*
   * Files: pasted, dropped or picked, stored in the Reflection's own files
   * under a name nobody holds, and linked relative to this page. A refusal
   * gets its own line: it is not a failed save, and it never keeps a draft.
   * The link lands in the room's text like any typing; a block inserted from
   * a heading line goes below the heading's id (`hiddenIdLines`), so nothing
   * has to place it first. A ref for the view, because the paste and drop
   * handlers are read once at mount and must reach the live buffer.
   */
  const home = useMemo(() => reflectionAssetHome(domain, path), [domain, path]);
  // The listing's sha256 per file makes a preview's address name its current
  // bytes, so a file replaced elsewhere is drawn anew. Read once a page
  // links a file: at mount, or after the first upload of this session (its
  // onSettled below refreshes it). A page without files asks nothing. The
  // previews sit in a compartment of their own: the editor takes its
  // extensions once, at mount.
  const [linksFiles, setLinksFiles] = useState(
    () => assetRefsIn(mountText, home.resolve).length > 0,
  );
  const listing = useQuery({
    queryKey: reflectionAssetsKey(domain),
    queryFn: () => fetchReflectionAssets(domain),
    enabled: linksFiles,
  });
  const versions = useMemo(() => assetVersions(listing.data), [listing.data]);
  const previewHome = useMemo(
    () => reflectionAssetHome(domain, path, versions),
    [domain, path, versions],
  );
  const previews = useMemo(() => new Compartment(), []);
  const uploadView = useRef<EditorView | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const uploads = useAttachmentUploads({
    domain,
    home,
    view: () => uploadView.current,
    onError: setAttachError,
    onSettled: () => {
      setLinksFiles(true);
      void queryClient.invalidateQueries({
        queryKey: reflectionAssetsKey(domain),
      });
    },
  });
  const editable = useMemo(() => new Compartment(), []);
  const extensions = useMemo(
    () => [
      // The shared text is LF space by construction (see EngramEditor).
      EditorState.lineSeparator.of("\n"),
      // The room's own undo stack replaces CodeMirror's.
      ...baseExtensions(resolved === "dark", { history: false }),
      yCollab(ytext, awareness, { undoManager: new Y.UndoManager(ytext) }),
      keymap.of(yUndoManagerKeymap),
      normalizePastedEndings,
      livePreview(),
      frontmatterFold(),
      hiddenIdLines(),
      uploads.extension,
      previews.of(imagePreviews(home)),
      editable.of(readOnly(mountEnded)),
    ],
    [
      ytext,
      awareness,
      resolved,
      editable,
      mountEnded,
      uploads.extension,
      home,
      previews,
    ],
  );
  useEffect(() => {
    view?.dispatch({
      effects: previews.reconfigure(imagePreviews(previewHome)),
    });
  }, [view, previews, previewHome]);
  useEffect(() => {
    view?.dispatch({ effects: editable.reconfigure(readOnly(ended)) });
  }, [view, editable, ended]);

  const keep = useMemo(
    () => () => {
      writeDraft(account, domain, key, {
        content: ytext.toJSON(),
        baseChecksum: "",
        savedAt: new Date().toISOString(),
      });
      wrote.current = true;
    },
    [account, domain, key, ytext],
  );

  /**
   * Clear the offer key, but only while it still holds the offer on screen:
   * text set aside after the banner appeared ("Take the file version")
   * is newer, and stays for the next mount to offer.
   */
  const dropOffer = (shown: Draft) => {
    const stored = readDraft(account, domain, offerKey);
    if (
      stored !== null &&
      stored.content === shown.content &&
      stored.savedAt === shown.savedAt
    ) {
      clearDraft(account, domain, offerKey);
    }
  };

  // Declared before the copy below, so a copy this mount writes at once is
  // never the one moved away here.
  useEffect(() => {
    if (found.copy !== null) {
      clearDraft(account, domain, key);
      if (found.copyDiffers) {
        writeDraft(account, domain, offerKey, found.copy);
      }
    }
    if (found.offer === null && found.offered !== null) {
      clearDraft(account, domain, offerKey); // only repeats the room
    }
  }, [found, account, domain, key, offerKey]);

  // While the latch holds, the draft follows the text: the server's refusal
  // tells the person "this tab keeps a copy", and the reconnect line says
  // edits are kept locally.
  useEffect(() => {
    if (!owed) {
      return undefined;
    }
    keep();
    ytext.observe(keep);
    return () => {
      ytext.unobserve(keep);
    };
  }, [owed, keep, ytext]);

  // The latch released by a landed save: this mount's own copy is no longer
  // needed. The offer key is never touched here.
  useEffect(() => {
    if (!owed && wrote.current) {
      clearDraft(account, domain, key);
      wrote.current = false;
    }
  }, [owed, account, domain, key]);

  // Text still owed when the screen goes ("Done", any navigation, a status
  // change above) is kept as a draft on the way out. Owed means the latch: a
  // plain "pending" on a connected room is text the room already holds and
  // saves on its own, and a draft of it would come back as a false offer.
  const owedSave =
    owed ||
    collab.saveState === "pending" ||
    collab.saveState === "failed" ||
    collab.saveState === "conflict";
  const leaving = useRef(owed);
  useEffect(() => {
    leaving.current = owed;
  }, [owed]);
  useEffect(
    () => () => {
      if (leaving.current) {
        keep();
      }
    },
    [keep],
  );
  // And the browser asks before a tab with unsaved text unloads, as the engram
  // editor does.
  useEffect(() => {
    if (!owedSave) {
      return undefined;
    }
    const prompt = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", prompt);
    return () => {
      window.removeEventListener("beforeunload", prompt);
    };
  }, [owedSave]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-slate-500 dark:text-slate-400">{`${domain} / ${path}`}</p>
        <div className="flex items-center gap-2">
          <PresenceChips
            participants={collab.participants}
            offline={collab.status !== "connected"}
          />
          {/*
            Off while the room is away or over: the bytes would not wait for
            it, but a person should not start what the page cannot take now.
            A paste while reconnecting still uploads, and the room merges the
            link on its return.
          */}
          <AttachButton
            onAttach={uploads.attach}
            disabled={view === null || ended || collab.status !== "connected"}
          />
          <Link
            to={reflectionPageRoute(domain, path)}
            onClick={() => {
              collab.flush();
              void queryClient.invalidateQueries({
                queryKey: reflectionKey(domain),
              });
            }}
            className={BUTTON.primary}
          >
            Done
          </Link>
        </div>
      </header>
      {collab.status === "reconnecting" && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
          Reconnecting - edits are kept locally
        </p>
      )}
      {collab.saveState === "pending" && refusal === null && !ended && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Saving...</p>
      )}
      {collab.saveState === "ok" && !ended && (
        <p className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <Check aria-hidden="true" size={14} strokeWidth={2} />
          Saved
        </p>
      )}
      {refusal !== null && (
        <p role="alert" className={ALERT}>
          {refusal}
        </p>
      )}
      {attachError !== null && (
        <p role="alert" className={ALERT}>
          {attachError}
        </p>
      )}
      {/*
        Mounted from the start and filled when the room ends, so a screen
        reader announces the change rather than meeting a region that
        arrived with its text already in it.
      */}
      <div role="status">
        {ended && (
          <p className={AMBER_BANNER}>
            {endedSentence(collab.closedReason, collab.saveState)}
          </p>
        )}
      </div>
      {/*
        A note, not a status: the offer is there when the screen opens and
        waits for a choice, it is not news that happened while the person
        was looking.
      */}
      {kept !== null && (
        <aside role="note" className={AMBER_BANNER}>
          <span>Text from an earlier session was kept.</span>
          {!ended && (
            <button
              type="button"
              className={BANNER_BUTTON}
              onClick={() => {
                const text = kept.content.replace(/\r\n/g, "\n");
                ytext.doc?.transact(() => {
                  ytext.delete(0, ytext.length);
                  ytext.insert(0, text);
                });
                // Owed until the room saves it: the copy follows it there.
                dropOffer(kept);
                setOwed(true);
                setKept(null);
                view?.focus();
              }}
            >
              Put it back
            </button>
          )}
          <button
            type="button"
            className={BANNER_BUTTON}
            onClick={() => {
              dropOffer(kept);
              setKept(null);
              view?.focus();
            }}
          >
            Discard
          </button>
        </aside>
      )}
      {collab.conflict !== null && (
        <aside role="alert" className={RED_BANNER}>
          <span>Saving is paused: this page changed outside the session.</span>
          <button
            type="button"
            className={`rounded ${BANNER_BUTTON} focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none`}
            onClick={() => {
              setResolving(true);
            }}
          >
            Resolve
          </button>
        </aside>
      )}
      <div className="rounded border border-slate-200 dark:border-slate-800">
        <CmEditor
          initialDoc={mountText}
          extensions={extensions}
          ariaLabel="Page source"
          onReady={(ready) => {
            uploadView.current = ready;
            setView(ready);
            if (focusOnReady) {
              ready.focus();
            }
          }}
        />
      </div>
      {collab.conflict !== null && resolving && (
        <CollabConflictDialog
          conflict={collab.conflict}
          mine={ytext.toJSON()}
          onResolve={(choice) => {
            if (choice === "theirs") {
              // Taking their text drops this tab's: set it aside for the
              // next mount to offer back.
              writeDraft(account, domain, offerKey, {
                content: ytext.toJSON(),
                baseChecksum: "",
                savedAt: new Date().toISOString(),
              });
            }
            collab.resolve(choice);
            setResolving(false);
          }}
          onClose={() => {
            setResolving(false);
          }}
        />
      )}
    </div>
  );
}
