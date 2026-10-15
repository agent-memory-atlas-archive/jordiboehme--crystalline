/**
 * The threads of one reflection, beside the page: comments anchored on a
 * passage, like familiar document comments.
 *
 * A comment is opened on what is selected on the page at the moment the
 * Comment button is pressed. The button keeps the page's selection (its
 * mousedown is not allowed to take focus), and the anchor is computed from
 * that selection by `selectionAnchor`: a source quote with its occurrence,
 * or the section alone when the passage cannot be placed exactly.
 *
 * A thread's quote is painted on the page while it is still there, judged
 * against the text on screen rather than trusted from the answer: the page
 * and its threads arrive together, but the page is what a reader sees. Once
 * the passage is gone, the thread says so and shows the old quote as text.
 * A quote is shown without the markers its edges cut from their partner
 * (`displayQuote`); what is stored and sent is the source text as it is.
 *
 * Every call to the threads routes is made here, built from the domain and
 * the path alone, so another thread target can reuse the column later.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement, ReactNode, RefObject } from "react";
import { useEffect, useId, useMemo, useState } from "react";

import { problemDetail } from "../api/client";
import type { ReflectionDoc, ThreadView } from "../api/reflection";
import {
  fetchThreads,
  openThread,
  reflectionKey,
  reflectionThreadsKey,
  stepThread,
} from "../api/reflection";
import type { ReflectionRight } from "../api/reflectionDomains";
import { atLeast } from "../api/reflectionDomains";
import { useAuth } from "../auth/AuthContext";
import { relativeTime } from "../format";
import type { SelectionAnchor } from "../reflectionQuotes";
import {
  SECTION_ATTR,
  displayQuote,
  domRange,
  paintQuotes,
  selectionAnchor,
} from "../reflectionQuotes";
import type { SectionText } from "../reflectionText";
import { TOP_SECTION, locateQuote } from "../reflectionText";
import { BUTTON, FIELD, TOGGLE } from "./primitives";

type Where = "found" | "text_changed" | "section_gone";

/**
 * The section a thread is anchored on: by id, or by heading for a section
 * with no id yet. Two id-less sections with one heading are rare (the engine
 * gives every section an id on its next write); the first one is taken, as
 * the engine's `find_section` does.
 */
function sectionOf(
  thread: ThreadView,
  sections: readonly SectionText[],
): SectionText | undefined {
  return sections.find((s) => (s.id ?? s.heading) === thread.anchor.section);
}

/** Where a thread stands on the text on screen. */
// eslint-disable-next-line react-refresh/only-export-components
export function effectiveAnchor(
  thread: ThreadView,
  sections: readonly SectionText[],
): Where {
  const section = sectionOf(thread, sections);
  if (section === undefined) {
    return "section_gone";
  }
  if (thread.anchor.quote === null) {
    return "found";
  }
  return locateQuote(
    section.text,
    thread.anchor.quote,
    thread.anchor.occurrence,
  ) === null
    ? "text_changed"
    : "found";
}

/** The heading a thread is shown under, or null for the intro. */
function headingOf(
  thread: ThreadView,
  sections: readonly SectionText[],
): string | null {
  const section = sectionOf(thread, sections);
  return section === undefined || section.id === TOP_SECTION
    ? null
    : section.heading;
}

export function ThreadCard({
  thread,
  heading,
  state,
  actions,
}: {
  thread: ThreadView;
  heading: string | null;
  state: Where;
  actions: ReactNode;
}): ReactElement {
  const now = new Date();
  return (
    <article
      id={`t-${thread.id}`}
      aria-label={`Thread on ${heading ?? "the page"}`}
      className="flex flex-col gap-2 rounded border border-slate-200 p-3 text-sm dark:border-slate-800"
    >
      {thread.anchor.quote !== null && (
        <blockquote className="border-l-2 border-amber-300 pl-2 text-slate-600 dark:border-amber-700 dark:text-slate-300">
          {displayQuote(thread.anchor.quote)}
        </blockquote>
      )}
      {state === "text_changed" && (
        <p className="text-caption text-amber-700 dark:text-amber-300">
          The text changed.
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {thread.entries.map((entry, index) => (
          <li key={`${entry.at}-${String(index)}`}>
            <p className="text-caption text-slate-500 dark:text-slate-400">
              {entry.author.name}
              {entry.author.agent && <span> (agent)</span>}
              {` ${relativeTime(entry.at, now) ?? ""}`}
            </p>
            <p className="whitespace-pre-wrap">
              {entry.kind === "resolve"
                ? `Resolved: ${entry.text}`
                : entry.kind === "reopen"
                  ? entry.text === ""
                    ? "Reopened"
                    : `Reopened: ${entry.text}`
                  : entry.text}
            </p>
          </li>
        ))}
      </ol>
      {actions}
    </article>
  );
}

export function ReflectionThreads({
  domain,
  path,
  doc,
  sections,
  right,
  articleRef,
}: {
  domain: string;
  path: string;
  doc: ReflectionDoc;
  sections: SectionText[];
  right: ReflectionRight;
  articleRef: RefObject<HTMLElement | null>;
}): ReactElement {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: reflectionKey(domain) });
  // Reading and commenting are one level; the anonymous viewer of a public
  // domain is the one reader who never comments (spec B5).
  const mayComment = atLeast(right, "read") && user !== null;
  const [captured, setCaptured] = useState<SelectionAnchor | null>(null);
  const [drafting, setDrafting] = useState<SelectionAnchor | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const hint = useId();

  // What is selected on the page, read on every change of the selection.
  useEffect(() => {
    const read = () => {
      const root = articleRef.current;
      const selection = window.getSelection();
      setCaptured(
        root === null || selection === null || selection.rangeCount === 0
          ? null
          : selectionAnchor(root, selection.getRangeAt(0), sections),
      );
    };
    document.addEventListener("selectionchange", read);
    return () => {
      document.removeEventListener("selectionchange", read);
    };
  }, [articleRef, sections]);

  const resolved = useQuery({
    queryKey: reflectionThreadsKey(domain, path, "resolved"),
    queryFn: () => fetchThreads(domain, { path, status: "resolved" }),
    enabled: showResolved,
  });

  const open = useMemo(
    () =>
      doc.threads
        .filter((t) => t.status === "open")
        .map((t) => ({
          thread: t,
          state: effectiveAnchor(t, sections),
          heading: headingOf(t, sections),
        })),
    [doc.threads, sections],
  );

  // Paint the quotes still on the page, again whenever the rendered page
  // changes: the sections render lazily, so the first paint may find nothing.
  useEffect(() => {
    const root = articleRef.current;
    if (root === null) {
      return;
    }
    let stop: () => void = () => undefined;
    const paint = () => {
      stop();
      const all: Range[] = [];
      const current: Range[] = [];
      for (const { thread, state } of open) {
        if (state !== "found" || thread.anchor.quote === null) {
          continue;
        }
        const section = sectionOf(thread, sections);
        // Compared by attribute rather than by selector, so a heading used
        // as a key (a section with no id yet) needs no escaping.
        const scope =
          Array.from(root.querySelectorAll(`[${SECTION_ATTR}]`)).find(
            (el) => el.getAttribute(SECTION_ATTR) === thread.anchor.section,
          ) ?? null;
        const at = section
          ? locateQuote(
              section.text,
              thread.anchor.quote,
              thread.anchor.occurrence,
            )
          : null;
        const range =
          scope && section && at
            ? domRange(scope, at.start, at.end, section.text)
            : null;
        if (range !== null) {
          all.push(range);
          if (thread.id === active) {
            current.push(range);
          }
        }
      }
      stop = paintQuotes(all, current);
    };
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      stop();
    };
  }, [articleRef, open, sections, active]);

  const comment = useMutation({
    mutationFn: ({ anchor, text }: { anchor: SelectionAnchor; text: string }) =>
      openThread(domain, {
        path,
        section: anchor.section,
        ...(anchor.quote !== null
          ? { quote: anchor.quote, occurrence: anchor.occurrence ?? 1 }
          : {}),
        text,
      }),
    onSuccess: () => {
      setDrafting(null);
      window.getSelection()?.removeAllRanges();
      void refresh();
    },
  });

  const bySection = new Map<string, typeof open>();
  for (const item of open) {
    const key = item.state === "section_gone" ? "" : item.thread.anchor.section;
    bySection.set(key, [...(bySection.get(key) ?? []), item]);
  }
  // Two id-less sections with one heading share a key; it is listed once.
  const order = [...new Set([...sections.map((s) => s.id ?? s.heading), ""])];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section">Threads</h2>
        <button
          type="button"
          aria-pressed={showResolved}
          onClick={() => {
            setShowResolved(!showResolved);
          }}
          className={showResolved ? TOGGLE.on : TOGGLE.off}
        >
          Show resolved threads
        </button>
      </div>
      {mayComment && drafting === null && (
        <>
          <button
            type="button"
            aria-disabled={captured === null}
            aria-describedby={captured === null ? hint : undefined}
            // Keep the page's selection: a press that took focus would
            // collapse it before the click is handled.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              if (captured !== null) {
                setDrafting(captured);
              }
            }}
            className={`${BUTTON.secondary} aria-disabled:cursor-default aria-disabled:opacity-50`}
          >
            Comment
          </button>
          <span id={hint} className="sr-only">
            Select text on the page to comment on it.
          </span>
        </>
      )}
      {drafting !== null && (
        <CommentForm
          anchor={drafting}
          pending={comment.isPending}
          error={comment.error}
          onCancel={() => {
            setDrafting(null);
          }}
          onSubmit={(text) => {
            comment.mutate({ anchor: drafting, text });
          }}
        />
      )}
      {order.map((key) => {
        const items = bySection.get(key);
        if (!items) {
          return null;
        }
        return (
          <div key={key || "gone"} className="flex flex-col gap-2">
            {key === "" && (
              <h3 className="text-caption font-semibold">
                Not on the page any more
              </h3>
            )}
            {items.map(({ thread, state, heading }) => (
              <div
                key={thread.id}
                onFocusCapture={() => {
                  setActive(thread.id);
                }}
                onMouseEnter={() => {
                  setActive(thread.id);
                }}
              >
                <ThreadCard
                  thread={thread}
                  heading={heading}
                  state={state}
                  actions={
                    mayComment ? (
                      <OpenActions
                        domain={domain}
                        path={path}
                        thread={thread}
                        onDone={refresh}
                      />
                    ) : null
                  }
                />
              </div>
            ))}
          </div>
        );
      })}
      {showResolved &&
        (resolved.data ?? []).map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            heading={headingOf(thread, sections)}
            state={effectiveAnchor(thread, sections)}
            actions={
              mayComment ? (
                <ReopenAction
                  domain={domain}
                  path={path}
                  thread={thread}
                  onDone={refresh}
                />
              ) : null
            }
          />
        ))}
    </>
  );
}

function CommentForm({
  anchor,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  anchor: SelectionAnchor;
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}): ReactElement {
  const [text, setText] = useState("");
  const field = useId();
  return (
    <form
      aria-label="New comment"
      className="flex flex-col gap-2 rounded border border-slate-200 p-3 text-sm dark:border-slate-800"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() !== "" && !pending) {
          onSubmit(text.trim());
        }
      }}
    >
      {anchor.quote !== null ? (
        <blockquote className="border-l-2 border-amber-300 pl-2 dark:border-amber-700">
          {displayQuote(anchor.quote)}
        </blockquote>
      ) : (
        <p className="text-caption">
          This passage cannot be pinned exactly, so the comment goes on the
          section.
        </p>
      )}
      <label htmlFor={field} className="text-caption">
        Your comment
      </label>
      <textarea
        id={field}
        value={text}
        rows={3}
        onChange={(event) => {
          setText(event.target.value);
        }}
        className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
      />
      {error && (
        <p role="alert" className="text-red-800 dark:text-red-200">
          {problemDetail(error)}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON.primary}>
          Comment
        </button>
        <button type="button" onClick={onCancel} className={BUTTON.ghost}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function OpenActions({
  domain,
  path,
  thread,
  onDone,
}: {
  domain: string;
  path: string;
  thread: ThreadView;
  onDone: () => Promise<unknown>;
}): ReactElement {
  const [answer, setAnswer] = useState("");
  const [outcome, setOutcome] = useState("");
  const answerId = useId();
  const outcomeId = useId();
  const step = useMutation({
    mutationFn: (input: { action: "answer" | "resolve"; text: string }) =>
      stepThread(
        domain,
        thread.id,
        input.action,
        input.action === "resolve"
          ? { path, outcome: input.text }
          : { path, text: input.text },
      ),
    onSuccess: () => {
      setAnswer("");
      setOutcome("");
      void onDone();
    },
  });
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (answer.trim() !== "") {
            step.mutate({ action: "answer", text: answer.trim() });
          }
        }}
      >
        <label htmlFor={answerId} className="sr-only">
          Your answer
        </label>
        <input
          id={answerId}
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value);
          }}
          className={`min-w-0 flex-1 ${FIELD}`}
        />
        <button
          type="submit"
          disabled={step.isPending}
          className={BUTTON.secondary}
        >
          Answer
        </button>
      </form>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (outcome.trim() !== "") {
            step.mutate({ action: "resolve", text: outcome.trim() });
          }
        }}
      >
        <label htmlFor={outcomeId} className="sr-only">
          Outcome
        </label>
        <input
          id={outcomeId}
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value);
          }}
          className={`min-w-0 flex-1 ${FIELD}`}
        />
        <button
          type="submit"
          disabled={step.isPending}
          className={BUTTON.secondary}
        >
          Resolve
        </button>
      </form>
      {step.error && (
        <p role="alert" className="text-red-800 dark:text-red-200">
          {problemDetail(step.error)}
        </p>
      )}
    </div>
  );
}

function ReopenAction({
  domain,
  path,
  thread,
  onDone,
}: {
  domain: string;
  path: string;
  thread: ThreadView;
  onDone: () => Promise<unknown>;
}): ReactElement {
  const reopen = useMutation({
    mutationFn: () => stepThread(domain, thread.id, "reopen", { path }),
    onSuccess: () => {
      void onDone();
    },
  });
  return (
    <>
      <button
        type="button"
        disabled={reopen.isPending}
        onClick={() => {
          reopen.mutate();
        }}
        className={BUTTON.secondary}
      >
        Reopen
      </button>
      {reopen.error && (
        <p role="alert" className="text-red-800 dark:text-red-200">
          {problemDetail(reopen.error)}
        </p>
      )}
    </>
  );
}
