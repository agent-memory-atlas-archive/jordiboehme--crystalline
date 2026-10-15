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
 * A quote found on the page is shown without the markers whose partner it
 * cut off (`displayQuote`); one that is not found is shown as stored. What
 * is stored and sent is always the source text as it is.
 *
 * Every call to the threads routes is made here, built from the domain and
 * the path alone, so another thread target can reuse the column later.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement, ReactNode, RefObject } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { problemDetail } from "../api/client";
import type { AnchorState, ReflectionDoc, ThreadView } from "../api/reflection";
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

const ALERT = "text-red-800 dark:text-red-200";

/** A quote, with an empty one read as none, as the server reads it. */
function quoteOf(quote: string | null): string | null {
  return quote === "" ? null : quote;
}

/**
 * The section a thread is anchored on: by id, or by heading for a section
 * with no id yet. Two id-less sections with one heading are rare (the engine
 * gives every section an id on its next write); the first one is taken, as
 * the engine's `find_section` does.
 */
function sectionOf(
  key: string,
  sections: readonly SectionText[],
): SectionText | undefined {
  return sections.find((s) => (s.id ?? s.heading) === key);
}

/** Where a thread stands on the text on screen. */
// eslint-disable-next-line react-refresh/only-export-components
export function effectiveAnchor(
  thread: ThreadView,
  sections: readonly SectionText[],
): AnchorState {
  const section = sectionOf(thread.anchor.section, sections);
  if (section === undefined) {
    return "section_gone";
  }
  const quote = quoteOf(thread.anchor.quote);
  if (quote === null) {
    return "found";
  }
  return locateQuote(section.text, quote, thread.anchor.occurrence) === null
    ? "text_changed"
    : "found";
}

/** The heading a thread is shown under, or null for the intro. */
function headingOf(
  thread: ThreadView,
  sections: readonly SectionText[],
): string | null {
  const section = sectionOf(thread.anchor.section, sections);
  return section === undefined || section.id === TOP_SECTION
    ? null
    : section.heading;
}

/**
 * A quote as a person is shown it: cleaned of cut markup where it is found
 * in `source` (the text of its section), else exactly as stored.
 */
function shownQuote(
  quote: string,
  occurrence: number,
  source: string | null,
): string {
  const at = source === null ? null : locateQuote(source, quote, occurrence);
  return source === null || at === null
    ? quote
    : displayQuote(source, at.start, at.end);
}

export function ThreadCard({
  thread,
  heading,
  state,
  actions,
  source = null,
}: {
  thread: ThreadView;
  heading: string | null;
  state: AnchorState;
  actions: ReactNode;
  /** The text of the thread's section; without it the quote shows as stored. */
  source?: string | null;
}): ReactElement {
  const now = new Date();
  const quote = quoteOf(thread.anchor.quote);
  return (
    <article
      id={thread.id}
      aria-label={`Thread on ${heading ?? "the page"}`}
      className="flex flex-col gap-2 rounded border border-slate-200 p-3 text-sm dark:border-slate-800"
    >
      {quote !== null && (
        <blockquote className="border-l-2 border-amber-300 pl-2 text-slate-600 dark:border-amber-700 dark:text-slate-300">
          {shownQuote(quote, thread.anchor.occurrence, source)}
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

interface Listed {
  thread: ThreadView;
  state: AnchorState;
  heading: string | null;
  source: string | null;
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
  const { user, capabilities } = useAuth();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: reflectionKey(domain) });
  // Reading and commenting are one level; the anonymous viewer of a public
  // domain is the one reader who never comments (spec B5). A server that
  // serves read-only refuses every thread write, so it gets no controls.
  const mayComment =
    atLeast(right, "read") && user !== null && !capabilities.readOnly;
  const [captured, setCaptured] = useState<SelectionAnchor | null>(null);
  const [drafting, setDrafting] = useState<SelectionAnchor | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const hint = useId();
  const commentButton = useRef<HTMLButtonElement | null>(null);
  const threadsHeading = useRef<HTMLHeadingElement | null>(null);
  // Set when the form closes, so focus goes back to the button once it is
  // drawn again.
  const backToComment = useRef(false);

  useEffect(() => {
    if (drafting === null && backToComment.current) {
      backToComment.current = false;
      commentButton.current?.focus();
    }
  }, [drafting]);

  // What is selected on the page. A selection elsewhere (typing in a form
  // here) is not the page's and changes nothing; a collapse on the page
  // clears it.
  useEffect(() => {
    const read = () => {
      const root = articleRef.current;
      const selection = window.getSelection();
      if (root === null || selection === null || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        return;
      }
      setCaptured(
        range.collapsed ? null : selectionAnchor(root, range, sections),
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

  const list = (thread: ThreadView): Listed => ({
    thread,
    state: effectiveAnchor(thread, sections),
    heading: headingOf(thread, sections),
    source: sectionOf(thread.anchor.section, sections)?.text ?? null,
  });

  const open = useMemo(
    () =>
      doc.threads
        .filter((t) => t.status === "open")
        .map((thread) => ({
          thread,
          state: effectiveAnchor(thread, sections),
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
        const quote = quoteOf(thread.anchor.quote);
        if (state !== "found" || quote === null) {
          continue;
        }
        const section = sectionOf(thread.anchor.section, sections);
        // Compared by attribute rather than by selector, so a heading used
        // as a key (a section with no id yet) needs no escaping.
        const scope =
          Array.from(root.querySelectorAll(`[${SECTION_ATTR}]`)).find(
            (el) => el.getAttribute(SECTION_ATTR) === thread.anchor.section,
          ) ?? null;
        const at = section
          ? locateQuote(section.text, quote, thread.anchor.occurrence)
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
        ...(quoteOf(anchor.quote) !== null
          ? { quote: anchor.quote ?? "", occurrence: anchor.occurrence ?? 1 }
          : {}),
        text,
      }),
    onSuccess: () => {
      backToComment.current = true;
      setDrafting(null);
      setCaptured(null);
      window.getSelection()?.removeAllRanges();
      void refresh();
    },
  });

  // A thread a resolve or reopen moves is drawn elsewhere: focus waits on
  // the column's heading rather than on a control that is gone.
  const afterMove = () => {
    threadsHeading.current?.focus();
    return refresh();
  };

  // Open threads, then the resolved ones when asked for; a thread both
  // lists hold for a moment (between a step and the refetch) shows once.
  const openIds = new Set(open.map((o) => o.thread.id));
  const listed: Listed[] = [
    ...open.map((o) => list(o.thread)),
    ...(showResolved ? (resolved.data ?? []) : [])
      .filter((t) => t.status === "resolved" && !openIds.has(t.id))
      .map(list),
  ];
  const bySection = new Map<string, Listed[]>();
  for (const item of listed) {
    const key = item.state === "section_gone" ? "" : item.thread.anchor.section;
    bySection.set(key, [...(bySection.get(key) ?? []), item]);
  }
  // Two id-less sections with one heading share a key; it is listed once.
  const order = [...new Set([...sections.map((s) => s.id ?? s.heading), ""])];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 ref={threadsHeading} tabIndex={-1} className="text-section">
          Threads
        </h2>
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
      {showResolved && resolved.error && (
        <p role="alert" className={`text-sm ${ALERT}`}>
          {problemDetail(resolved.error)}
        </p>
      )}
      {mayComment && drafting === null && (
        <>
          <button
            ref={commentButton}
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
                comment.reset();
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
          source={sectionOf(drafting.section, sections)?.text ?? null}
          pending={comment.isPending}
          error={comment.error}
          onCancel={() => {
            comment.reset();
            backToComment.current = true;
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
            {items.map(({ thread, state, heading, source }) => (
              <div
                key={thread.id}
                onFocusCapture={() => {
                  setActive(thread.id);
                }}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setActive((now) => (now === thread.id ? null : now));
                  }
                }}
                onMouseEnter={() => {
                  setActive(thread.id);
                }}
                onMouseLeave={() => {
                  setActive((now) => (now === thread.id ? null : now));
                }}
              >
                <ThreadCard
                  thread={thread}
                  heading={heading}
                  state={state}
                  source={source}
                  actions={
                    !mayComment ? null : thread.status === "open" ? (
                      <OpenActions
                        domain={domain}
                        path={path}
                        thread={thread}
                        onAnswered={refresh}
                        onResolved={afterMove}
                      />
                    ) : (
                      <ReopenAction
                        domain={domain}
                        path={path}
                        thread={thread}
                        onDone={afterMove}
                      />
                    )
                  }
                />
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function CommentForm({
  anchor,
  source,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  anchor: SelectionAnchor;
  source: string | null;
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}): ReactElement {
  const [text, setText] = useState("");
  const field = useId();
  const box = useRef<HTMLTextAreaElement | null>(null);
  const quote = quoteOf(anchor.quote);
  useEffect(() => {
    box.current?.focus();
  }, []);
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
      {quote !== null ? (
        <blockquote className="border-l-2 border-amber-300 pl-2 dark:border-amber-700">
          {shownQuote(quote, anchor.occurrence ?? 1, source)}
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
        ref={box}
        id={field}
        value={text}
        rows={3}
        onChange={(event) => {
          setText(event.target.value);
        }}
        className="rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
      />
      {error && (
        <p role="alert" className={ALERT}>
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

/** One labelled field and its button, for a step that takes words. */
function StepForm({
  label,
  button,
  pending,
  error,
  onSend,
}: {
  label: string;
  button: string;
  pending: boolean;
  error: Error | null;
  /** Sends the words, with a way to clear the field once they landed. */
  onSend: (text: string, clear: () => void) => void;
}): ReactElement {
  const [value, setValue] = useState("");
  const id = useId();
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() !== "" && !pending) {
          onSend(value.trim(), () => {
            setValue("");
          });
        }
      }}
    >
      <label htmlFor={id} className="text-caption">
        {label}
      </label>
      <div className="flex items-end gap-2">
        <input
          id={id}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          className={`min-w-0 flex-1 ${FIELD}`}
        />
        <button type="submit" disabled={pending} className={BUTTON.secondary}>
          {button}
        </button>
      </div>
      {error && (
        <p role="alert" className={ALERT}>
          {problemDetail(error)}
        </p>
      )}
    </form>
  );
}

function OpenActions({
  domain,
  path,
  thread,
  onAnswered,
  onResolved,
}: {
  domain: string;
  path: string;
  thread: ThreadView;
  onAnswered: () => Promise<unknown>;
  onResolved: () => Promise<unknown>;
}): ReactElement {
  const answer = useMutation({
    mutationFn: (text: string) =>
      stepThread(domain, thread.id, "answer", { path, text }),
  });
  const resolve = useMutation({
    mutationFn: (outcome: string) =>
      stepThread(domain, thread.id, "resolve", { path, outcome }),
  });
  return (
    <div className="flex flex-col gap-2">
      <StepForm
        label="Your answer"
        button="Answer"
        pending={answer.isPending}
        error={answer.error}
        onSend={(text, clear) => {
          answer.mutate(text, {
            onSuccess: () => {
              clear();
              void onAnswered();
            },
          });
        }}
      />
      <StepForm
        label="Outcome"
        button="Resolve"
        pending={resolve.isPending}
        error={resolve.error}
        onSend={(text, clear) => {
          resolve.mutate(text, {
            onSuccess: () => {
              clear();
              void onResolved();
            },
          });
        }}
      />
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
        <p role="alert" className={ALERT}>
          {problemDetail(reopen.error)}
        </p>
      )}
    </>
  );
}
