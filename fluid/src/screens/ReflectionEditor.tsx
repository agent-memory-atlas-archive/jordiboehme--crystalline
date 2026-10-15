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
 */

import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";

import { problemDetail } from "../api/client";
import { fetchReflection, reflectionKey } from "../api/reflection";
import { mayEditPage } from "../api/reflectionDomains";
import { useAuth } from "../auth/AuthContext";
import { CollabConflictDialog } from "../collab/CollabConflictDialog";
import { normalizePastedEndings } from "../collab/pastedEndings";
import { PresenceChips } from "../collab/PresenceChips";
import { reflectionCollabUrl, reflectionRoomKey } from "../collab/provider";
import type { CollabSession } from "../collab/useCollabSession";
import { useCollabSession } from "../collab/useCollabSession";
import { useReflectionStatus } from "../components/ReflectionModeSwitch";
import { ReflectionStateNotice } from "../components/ReflectionStateNotice";
import { BUTTON } from "../components/primitives";
import { Skeleton } from "../components/Skeleton";
import CmEditor from "../editor/CmEditor";
import type { Draft } from "../editor/drafts";
import { clearDraft, readDraft, writeDraft } from "../editor/drafts";
import { frontmatterFold } from "../editor/frontmatterFold";
import { hiddenIdLines } from "../editor/hiddenIdLines";
import { livePreview } from "../editor/preview";
import { baseExtensions } from "../editor/setup";
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
  if (status.isPending) {
    return <Skeleton label="Loading the page" rows={6} />;
  }
  if (status.error) {
    return (
      <p role="alert" className={ALERT}>
        {problemDetail(status.error)}
      </p>
    );
  }
  if (status.data.state !== "on") {
    return <ReflectionStateNotice status={status.data} />;
  }
  if (!mayEditPage(status.data.right, path)) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p>You can comment on this page, but not edit it.</p>
        <Link to={reflectionPageRoute(domain, path)} className={LINK}>
          Back to the page
        </Link>
      </div>
    );
  }
  return (
    <Room
      key={attempt}
      domain={domain}
      path={path}
      onRetry={() => {
        setAttempt(attempt + 1);
      }}
    />
  );
}

function Room({
  domain,
  path,
  onRetry,
}: {
  domain: string;
  path: string;
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
  if (
    collab.mode === "connecting" ||
    (collab.mode === "collab" && collab.ytext === null)
  ) {
    return <Skeleton label="Connecting the session" rows={8} />;
  }
  if (
    collab.mode === "solo" ||
    collab.ytext === null ||
    collab.awareness === null
  ) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p>Live editing is not available right now.</p>
        <button type="button" onClick={onRetry} className={BUTTON.secondary}>
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
    />
  );
}

/** What the banner says once the room has closed, by the server's reason. */
function closedSentence(reason: string | null): string {
  switch (reason) {
    case "deleted":
      return "This page was deleted; your text is kept as a draft";
    case "switched_off":
      return "The Reflection was switched off. Your text was saved first.";
    default:
      return "The session ended; your text is kept as a draft";
  }
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

function Surface({
  domain,
  path,
  collab,
  account,
}: {
  domain: string;
  path: string;
  collab: CollabSession;
  account: string;
}): ReactElement {
  const { resolved } = useTheme();
  const queryClient = useQueryClient();
  const ytext = collab.ytext as Y.Text;
  const awareness = collab.awareness as NonNullable<CollabSession["awareness"]>;
  const key = reflectionRoomKey(path);
  const [kept, setKept] = useState<Draft | null>(() => {
    const draft = readDraft(account, domain, key);
    return draft !== null && differsFromRoom(draft, ytext.toJSON())
      ? draft
      : null;
  });
  const [resolving, setResolving] = useState(false);
  const [mountText] = useState(() => ytext.toJSON());
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
    ],
    [ytext, awareness, resolved],
  );

  // A close from outside (a deletion, a shutdown) or a refused save (the
  // Reflection switched off while the room held unsaved text) leaves this
  // tab's copy as the only one a person can reach: keep it as a draft, which
  // the next mount offers back. Text typed after the refusal is kept too: the
  // server's refusal tells the person "this tab keeps a copy", so the copy
  // follows the text.
  useEffect(() => {
    if (!collab.closed && collab.saveState !== "failed") {
      return undefined;
    }
    const keep = () => {
      writeDraft(account, domain, key, {
        content: ytext.toJSON(),
        baseChecksum: "",
        savedAt: new Date().toISOString(),
      });
    };
    keep();
    ytext.observe(keep);
    return () => {
      ytext.unobserve(keep);
    };
  }, [collab.closed, collab.saveState, account, domain, key, ytext]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-slate-500 dark:text-slate-400">{`${domain} / ${path}`}</p>
        <div className="flex items-center gap-2">
          <PresenceChips
            participants={collab.participants}
            offline={collab.status !== "connected"}
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
      {collab.saveState === "pending" && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Saving...</p>
      )}
      {collab.saveState === "ok" && (
        <p className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <Check aria-hidden="true" size={14} strokeWidth={2} />
          Saved
        </p>
      )}
      {collab.saveState === "failed" && collab.saveDetail !== null && (
        <p role="alert" className={ALERT}>
          {collab.saveDetail}
        </p>
      )}
      {collab.closed && (
        <p role="status" className={AMBER_BANNER}>
          {closedSentence(collab.closedReason)}
        </p>
      )}
      {kept !== null && (
        <aside role="note" className={AMBER_BANNER}>
          <span>Text from an earlier session was kept.</span>
          <button
            type="button"
            className={BANNER_BUTTON}
            onClick={() => {
              const text = kept.content.replace(/\r\n/g, "\n");
              ytext.doc?.transact(() => {
                ytext.delete(0, ytext.length);
                ytext.insert(0, text);
              });
              clearDraft(account, domain, key);
              setKept(null);
            }}
          >
            Put it back
          </button>
          <button
            type="button"
            className={BANNER_BUTTON}
            onClick={() => {
              clearDraft(account, domain, key);
              setKept(null);
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
        />
      </div>
      {collab.conflict !== null && resolving && (
        <CollabConflictDialog
          conflict={collab.conflict}
          mine={ytext.toJSON()}
          onResolve={(choice) => {
            if (choice === "theirs") {
              // Taking their text drops this tab's: keep it as a draft first.
              writeDraft(account, domain, key, {
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
