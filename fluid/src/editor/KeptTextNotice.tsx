/**
 * The editors' notice for a text the server kept for this page: when the
 * last person left a room that was still in a conflict, or whose save
 * failed, the server kept the unsaved text. The notice offers it the way the
 * draft banners offer a browser's own copy: see it, take it, or let it go.
 *
 * Quiet on purpose. It is there when the page opens and waits for a choice,
 * so it is a note, not an alert, and a person with no right to the kept
 * texts (or none kept) never sees it: every refusal of the listing reads as
 * "nothing kept here".
 *
 * Use it reads the text first and changes nothing when that fails. The
 * editor then puts it in as one change the person can undo, and only after
 * that is the kept copy dropped. A drop that fails then leaves the notice up
 * and says the text is in the editor already.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import { problemDetail } from "../api/client";
import {
  dropKeptText,
  fetchKeptText,
  isNoKeptRight,
  keptForPage,
  keptKey,
  keptQuery,
  keptTextKey,
} from "../api/kept";
import type { KeptTextEntry } from "../api/kept";
import { useAuth } from "../auth/AuthContext";
import { KeptTextDialog } from "../components/KeptTextDialog";
import { FOCUS_RING } from "../components/primitives";

const NOTICE =
  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-hair bg-sunken px-3 py-2 text-sm text-ink-2";
const DANGER = `rounded font-medium text-red-700 underline underline-offset-[3px] hover:no-underline dark:text-red-300 ${FOCUS_RING}`;
const ACTION = `rounded text-link underline decoration-(--link-line) underline-offset-[3px] hover:no-underline aria-disabled:cursor-default aria-disabled:opacity-50 ${FOCUS_RING}`;

export function KeptTextNotice({
  domain,
  kind,
  path,
  draft,
  canUse,
  onUse,
}: {
  domain: string;
  /** The kind of room this editor is. */
  kind: "engram" | "reflection";
  /** The page's path in its domain (inside `reflections/` for a page); null
   *  when this editor has no page of its own to offer a text for. */
  path: string | null;
  /** Whether the editor holds the caller's own review draft. */
  draft: boolean;
  /** Whether the editor can take a text now: false once a room has ended. */
  canUse: boolean;
  /** Put `text` in the editor as one change the person can undo. */
  onUse: (text: string) => void;
}): ReactElement | null {
  const { user, capabilities } = useAuth();
  const queryClient = useQueryClient();
  const listing = useQuery(keptQuery(domain, user !== null && path !== null));
  const [showing, setShowing] = useState<KeptTextEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Drop asks once, in the note itself: a short confirm, and the focus goes
  // back to Drop when the person keeps the text.
  const [asking, setAsking] = useState(false);
  const dropButton = useRef<HTMLButtonElement>(null);
  const kept = useRef(false);
  useEffect(() => {
    if (!asking && kept.current) {
      kept.current = false;
      dropButton.current?.focus();
    }
  }, [asking]);
  const entry =
    path === null ? null : keptForPage(listing.data, kind, path, draft);
  if (entry === null) {
    return null;
  }
  // A read-only instance refuses the delete, and Use it ends with one: the
  // note then only shows the text.
  const writable = !capabilities.readOnly;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keptKey(domain) });
  };

  const drop = async (used: boolean) => {
    try {
      await dropKeptText(domain, entry.id);
      setProblem(null);
      queryClient.removeQueries({ queryKey: keptTextKey(domain, entry.id) });
    } catch (error) {
      // A text somebody else dropped meanwhile is gone either way.
      if (!(error instanceof Error && isNoKeptRight(error))) {
        const why = error instanceof Error ? problemDetail(error) : "";
        setProblem(
          used
            ? `The kept text is in the editor now, but its copy on the server could not be dropped. ${why}`
            : why,
        );
      }
    } finally {
      refresh();
    }
  };

  const use = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      let text: string;
      try {
        const read = await queryClient.fetchQuery({
          queryKey: keptTextKey(domain, entry.id),
          queryFn: () => fetchKeptText(domain, entry.id),
          retry: false,
        });
        text = read.text;
      } catch (error) {
        setProblem(error instanceof Error ? problemDetail(error) : null);
        return;
      }
      onUse(text);
      await drop(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside role="note" aria-label="Kept text" className={NOTICE}>
      <span>You have a kept text for this page.</span>
      <button
        type="button"
        className={ACTION}
        onClick={() => {
          setShowing(entry);
        }}
      >
        Show
      </button>
      {canUse && writable && !asking && (
        <button
          type="button"
          className={ACTION}
          aria-disabled={busy}
          onClick={() => {
            void use();
          }}
        >
          Use it
        </button>
      )}
      {writable &&
        (asking ? (
          <span
            className="inline-flex flex-wrap items-center gap-3"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                kept.current = true;
                setAsking(false);
              }
            }}
          >
            <span>Drop it for good?</span>
            <button
              type="button"
              autoFocus
              className={DANGER}
              onClick={() => {
                setAsking(false);
                void drop(false);
              }}
            >
              Drop it
            </button>
            <button
              type="button"
              className={ACTION}
              onClick={() => {
                kept.current = true;
                setAsking(false);
              }}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            ref={dropButton}
            type="button"
            aria-label="Drop the kept text"
            aria-disabled={busy}
            className={ACTION}
            onClick={() => {
              if (!busy) {
                setAsking(true);
              }
            }}
          >
            Drop
          </button>
        ))}
      {problem !== null && problem !== "" && (
        <p role="alert" className="basis-full text-red-800 dark:text-red-200">
          {problem}
        </p>
      )}
      {showing !== null && (
        <KeptTextDialog
          domain={domain}
          entry={showing}
          onClose={() => {
            setShowing(null);
          }}
        />
      )}
    </aside>
  );
}
