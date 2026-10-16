/**
 * The threads of one reflection, beside the page: comments anchored on a
 * passage, like familiar document comments.
 *
 * A comment is opened on what is selected on the page at the moment the
 * Comment button is pressed. Without a selection the column shows a hint in
 * the button's place; the button keeps the page's selection (its mousedown
 * is not allowed to take focus), and the anchor is computed from that
 * selection by `selectionAnchor`: a source quote with its occurrence, or the
 * section alone when the passage cannot be placed exactly.
 *
 * A thread's quote is painted on the page while it is still there, judged
 * against the text on screen rather than trusted from the answer: the page
 * and its threads arrive together, but the page is what a reader sees. Once
 * the passage is gone, the thread says so and shows the old quote as text.
 * A quote found on the page is shown without the markers whose partner it
 * cut off (`displayQuote`); one that is not found is shown as stored. What
 * is stored and sent is always the source text as it is.
 *
 * The thread a reader picked (by focus, a click in the column, or a tap on
 * its quote in the text) gets an accent wash, and its quote is painted a
 * second time on the page. From `xl` up the threads are a column beside the
 * page; below it they are a sheet behind a pill at the foot of the screen,
 * and a tap on a quote opens the sheet at its thread.
 *
 * Every call to the threads routes is made here, built from the domain and
 * the path alone, so another thread target can reuse the column later.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, MessageSquarePlus, MessagesSquare, X } from "lucide-react";
import type { ReactElement, ReactNode, RefObject } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Dialog } from "radix-ui";
import { useLocation } from "react-router";

import { problemDetail } from "../api/client";
import type {
  AnchorState,
  ReflectionDoc,
  SourceState,
  ThreadView,
} from "../api/reflection";
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
import { plural, relativeTime } from "../format";
import { useSaid } from "./useSaid";
import type { SelectionAnchor } from "../reflectionQuotes";
import {
  SECTION_ATTR,
  SKIP_ATTR,
  displayQuote,
  domRange,
  paintQuotes,
  selectionAnchor,
} from "../reflectionQuotes";
import type { SectionText } from "../reflectionText";
import { TOP_SECTION, locateQuote } from "../reflectionText";
import {
  BUTTON,
  Chip,
  FIELD,
  FOCUS_RING,
  IconButton,
  RAIL_LABEL,
} from "./primitives";

const ALERT = "text-red-800 dark:text-red-200";

/** The quiet tier (spec 3.1): accent text, no box, for actions in a list. */
const QUIET = `rounded text-[13px] font-medium text-link hover:underline disabled:opacity-50 ${FOCUS_RING}`;

/** Tailwind's `xl`: where a 340px column fits beside the reading text. */
const COLUMN_QUERY = "(min-width: 80rem)";

function columnNow(): boolean {
  // Nothing to ask (jsdom, an old embedded view): the desktop frame, as the
  // stylesheet's own default.
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia(COLUMN_QUERY).matches
  );
}

function subscribeColumn(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia(COLUMN_QUERY);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

/** Whether the threads fit as a column beside the page. */
function useColumn(): boolean {
  return useSyncExternalStore(subscribeColumn, columnNow);
}

/**
 * Half-typed words and open forms, kept by the column rather than by the
 * forms: the sheet unmounts what it shows when it closes, and closing it must
 * not throw away an answer in progress.
 */
const Kept = createContext<{
  store: Map<string, unknown>;
  page: string;
} | null>(null);

/** A piece of state that outlives its component, under `key` on this page. */
function useKept<T>(key: string, initial: T): [T, (next: T) => void] {
  const kept = useContext(Kept);
  const at = `${kept?.page ?? ""}\n${key}`;
  const [value, setValue] = useState<T>(() =>
    kept?.store.has(at) ? (kept.store.get(at) as T) : initial,
  );
  const set = (next: T) => {
    if (next === initial) {
      kept?.store.delete(at);
    } else {
      kept?.store.set(at, next);
    }
    setValue(next);
  };
  return [value, set];
}

/** Forget what `useKept` holds under `key` on this page. */
function useForget(): (key: string) => void {
  const kept = useContext(Kept);
  return (key) => {
    kept?.store.delete(`${kept.page}\n${key}`);
  };
}

/**
 * The text nodes of `range` outside notes the page drew (`data-anchor-skip`):
 * a quote that runs over a heading paints the heading's words, not the
 * sources control or the title note beside them.
 */
function paintable(range: Range): Range[] {
  const root = range.commonAncestorContainer;
  const host =
    root.nodeType === Node.TEXT_NODE ? root.parentElement : (root as Element);
  if (host === null || host.querySelector(`[${SKIP_ATTR}]`) === null) {
    return [range];
  }
  const parts: Range[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (
      !range.intersectsNode(node) ||
      node.parentElement?.closest(`[${SKIP_ATTR}]`)
    ) {
      continue;
    }
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) {
      part.setStart(node, range.startOffset);
    }
    if (node === range.endContainer) {
      part.setEnd(node, range.endOffset);
    }
    if (!part.collapsed) {
      parts.push(part);
    }
  }
  return parts;
}

/** A caret position under a point, in the browsers that answer it. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof doc.caretPositionFromPoint === "function") {
    const at = doc.caretPositionFromPoint(x, y);
    return at === null ? null : { node: at.offsetNode, offset: at.offset };
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    const at = doc.caretRangeFromPoint(x, y);
    return at === null
      ? null
      : { node: at.startContainer, offset: at.startOffset };
  }
  return null;
}

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

/** Colours a person's initial is drawn on; white text reads on each. */
const AVATAR_COLORS = [
  "#6c5eb5",
  "#0f766e",
  "#b45309",
  "#be185d",
  "#1d4ed8",
  "#4d7c0f",
] as const;

/** The same colour for the same name, on every page. */
function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/** A round initial; the name beside it is what a screen reader hears. */
function Avatar({
  name,
  agent,
}: {
  name: string;
  agent: boolean;
}): ReactElement {
  const initial = (Array.from(name.trim())[0] ?? "?").toUpperCase();
  return agent ? (
    <span
      aria-hidden
      data-avatar=""
      className="mt-px inline-grid size-[22px] place-items-center rounded-full border border-hair-strong bg-sunken text-[11px] font-semibold text-muted"
    >
      {initial}
    </span>
  ) : (
    <span
      aria-hidden
      data-avatar=""
      style={{ backgroundColor: avatarColor(name) }}
      className="mt-px inline-grid size-[22px] place-items-center rounded-full text-[11px] font-semibold text-white"
    >
      {initial}
    </span>
  );
}

export function ThreadCard({
  thread,
  heading,
  state,
  actions,
  source = null,
  picked = false,
  boxed = false,
}: {
  thread: ThreadView;
  heading: string | null;
  state: AnchorState;
  actions: ReactNode;
  /** The text of the thread's section; without it the quote shows as stored. */
  source?: string | null;
  /** The thread the reader picked: its quote rule turns accent. */
  picked?: boolean;
  /**
   * A card of its own in a list that has no hairlines (the review screen),
   * which already groups by who is waiting, so no waiting line either.
   */
  boxed?: boolean;
}): ReactElement {
  const now = new Date();
  const quote = quoteOf(thread.anchor.quote);
  const waiting =
    !boxed && thread.status === "open" ? (
      <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted">
        <Clock aria-hidden size={14} />
        {thread.waitingOn === "agent"
          ? "Waiting for the agent"
          : "Waiting for people"}
      </span>
    ) : null;
  return (
    <article
      id={thread.id}
      // Focusable by script only: a tap on its quote in the text, or the
      // sheet opening at it, puts the keyboard here.
      tabIndex={-1}
      aria-label={`Thread on ${heading ?? "the page"}`}
      className={`flex flex-col gap-3 text-sm outline-none ${
        boxed ? "rounded border border-slate-200 p-3 dark:border-slate-800" : ""
      }`}
    >
      {quote !== null && (
        <blockquote
          className={`border-l-2 py-px pl-2.5 text-[13px] leading-normal text-ink-3 ${
            picked ? "border-accent-400" : "border-(--mark-rule)"
          }`}
        >
          {shownQuote(quote, thread.anchor.occurrence, source)}
        </blockquote>
      )}
      {state === "text_changed" && (
        <p className="-mt-1 text-[12.5px] text-muted">The text changed.</p>
      )}
      <ol className="flex flex-col gap-2.5">
        {thread.entries.map((entry, index) => (
          <li
            key={`${entry.at}-${String(index)}`}
            className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5"
          >
            <Avatar name={entry.author.name} agent={entry.author.agent} />
            <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="font-semibold text-ink">
                {entry.author.name}
                {entry.author.agent && (
                  <span className="font-normal text-muted"> (agent)</span>
                )}
              </span>
              <span className="text-xs text-muted">
                {relativeTime(entry.at, now) ?? ""}
              </span>
            </p>
            <p className="col-start-2 text-[13.5px] leading-[1.55] whitespace-pre-wrap text-ink-2">
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
      {(actions !== null || waiting !== null) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-8">
          {actions}
          {waiting}
        </div>
      )}
    </article>
  );
}

/** A source's state as a chip; a current source needs none. */
// eslint-disable-next-line react-refresh/only-export-components
export function sourceChip(state: SourceState): ReactElement | null {
  switch (state) {
    case "current":
      return null;
    case "changed":
      return <Chip variant="caution">changed</Chip>;
    case "retired":
      return <Chip variant="retired">retired</Chip>;
    case "missing":
      return <Chip variant="danger">missing</Chip>;
  }
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
  const { hash } = useLocation();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: reflectionKey(domain) });
  // Reading and commenting are one level; the anonymous viewer of a public
  // domain is the one reader who never comments (spec B5). A server that
  // serves read-only refuses every thread write, so it gets no controls.
  const mayComment =
    atLeast(right, "read") && user !== null && !capabilities.readOnly;
  const column = useColumn();
  const [captured, setCaptured] = useState<SelectionAnchor | null>(null);
  const [drafting, setDrafting] = useState<SelectionAnchor | null>(null);
  // The thread under the pointer, and the one the reader picked. The pointer
  // wins for the second paint on the page; only the pick gets the wash.
  const [hovered, setHovered] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [store] = useState(() => new Map<string, unknown>());
  const kept = useMemo(
    () => ({ store, page: `${domain}/${path}` }),
    [store, domain, path],
  );
  const commentKey = `${kept.page}\n${COMMENT_KEY}`;
  const [said, say] = useSaid(4000);
  // Whether a selection was captured a moment ago, so the Comment button is
  // announced once per selection, not at every change of it.
  const hadCapture = useRef(false);
  // The thread a comment just opened, focused once the page lists it.
  const focusNew = useRef<string | null>(null);
  const commentButton = useRef<HTMLButtonElement | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const threadsHeading = useRef<HTMLHeadingElement | null>(null);
  // Set when the form closes, so focus goes back to the button once it is
  // drawn again (or to the heading when the selection went with the send).
  const backToComment = useRef(false);
  // The painted quotes by thread, for a tap on one in the text.
  const painted = useRef(new Map<string, Range>());
  // The thread the sheet opens at, once, when a tap or a link asked for it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  // A link to a thread (`#t-<hex>`) picks it; on a narrow screen it also
  // opens the sheet at it, as the column that would hold it is not there.
  const [seenHash, setSeenHash] = useState<string | null>(null);
  if (hash !== seenHash) {
    setSeenHash(hash);
    const id = decodeURIComponent(hash.slice(1));
    if (doc.threads.some((t) => t.id === id)) {
      setPicked(id);
      if (!column) {
        setOpenAt(id);
        setSheetOpen(true);
      }
    }
  }
  // Crossing the breakpoint shuts the sheet, as the sidebar drawer does: the
  // column that takes over shows the same threads.
  const [seenColumn, setSeenColumn] = useState(column);
  if (column !== seenColumn) {
    setSeenColumn(column);
    setSheetOpen(false);
  }

  useEffect(() => {
    if (drafting === null && backToComment.current) {
      backToComment.current = false;
      (commentButton.current ?? threadsHeading.current)?.focus();
    }
  }, [drafting]);

  // What is selected on the page. A collapse on the page clears it, and so
  // does text selected elsewhere; a caret or a field outside the page
  // changes nothing.
  useEffect(() => {
    const read = () => {
      const root = articleRef.current;
      const selection = window.getSelection();
      if (root === null || selection === null || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        // Text selected elsewhere (a thread card) replaces the page's
        // passage; a caret or typing in a field leaves it alone.
        const typing =
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement;
        if (!range.collapsed && !typing) {
          hadCapture.current = false;
          setCaptured(null);
        }
        return;
      }
      const next = range.collapsed
        ? null
        : selectionAnchor(root, range, sections);
      if (next !== null && !hadCapture.current) {
        say("Comment on the selection");
      }
      hadCapture.current = next !== null;
      setCaptured(next);
    };
    document.addEventListener("selectionchange", read);
    return () => {
      document.removeEventListener("selectionchange", read);
    };
  }, [articleRef, sections, say]);

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

  const shown = hovered ?? picked;

  // Words kept for a thread that is no longer open (resolved, or gone) have
  // nowhere to go back to.
  useEffect(() => {
    const live = new Set(open.map((o) => o.thread.id));
    const prefix = `${kept.page}\n`;
    for (const key of [...kept.store.keys()]) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const id = key.slice(prefix.length).split(":")[0] ?? "";
      if (id.startsWith("t-") && !live.has(id)) {
        kept.store.delete(key);
      }
    }
  }, [open, kept]);

  // A comment just sent: its thread takes the keyboard once it is listed,
  // read out by its name.
  useEffect(() => {
    const id = focusNew.current;
    if (id === null || !doc.threads.some((t) => t.id === id)) {
      return;
    }
    focusNew.current = null;
    document.getElementById(id)?.focus();
  }, [doc.threads]);

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
      painted.current.clear();
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
          const parts = paintable(range);
          all.push(...parts);
          painted.current.set(thread.id, range);
          if (thread.id === shown) {
            current.push(...parts);
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
  }, [articleRef, open, sections, shown]);

  // A tap on a painted quote picks its thread; below `xl` it opens the
  // sheet at it. A tap anywhere else in the text lets the pick go. A drag
  // that selected text is a selection, not a tap.
  useEffect(() => {
    const root = articleRef.current;
    if (root === null) {
      return;
    }
    const onClick = (event: MouseEvent) => {
      // A control on the page (the sources count, a link symbol) or a note
      // it drew is no tap on the text.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`[${SKIP_ATTR}], button`)) {
        return;
      }
      const selection = window.getSelection();
      if (selection !== null && !selection.isCollapsed) {
        return;
      }
      const at = caretAt(event.clientX, event.clientY);
      const hit =
        at === null
          ? undefined
          : Array.from(painted.current).find(([, range]) => {
              try {
                return range.isPointInRange(at.node, at.offset);
              } catch {
                return false;
              }
            });
      if (hit === undefined) {
        setPicked(null);
        return;
      }
      setPicked(hit[0]);
      if (!column) {
        setOpenAt(hit[0]);
        setSheetOpen(true);
      }
    };
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("click", onClick);
    };
  }, [articleRef, column]);

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
    onSuccess: (thread) => {
      kept.store.delete(commentKey);
      focusNew.current = thread?.id ?? null;
      say("Comment posted.");
      hadCapture.current = false;
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

  const heading = (
    <h2
      ref={threadsHeading}
      tabIndex={-1}
      className="text-[15px] font-semibold text-ink outline-none"
    >
      Threads
    </h2>
  );

  const body = (
    <>
      <div className="flex items-center gap-2.5">
        {column ? heading : <Dialog.Title asChild>{heading}</Dialog.Title>}
        {open.length > 0 && (
          <span className="text-xs text-muted">{`${String(open.length)} open`}</span>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={showResolved}
          aria-label="Show resolved threads"
          onClick={() => {
            setShowResolved(!showResolved);
          }}
          className={`ml-auto inline-flex items-center gap-2 rounded text-[12.5px] text-muted hover:text-ink-3 ${FOCUS_RING}`}
        >
          <span
            aria-hidden
            className={`relative h-[15px] w-[26px] shrink-0 rounded-full transition-colors motion-reduce:transition-none ${
              showResolved
                ? "bg-accent-600 dark:bg-accent-400"
                : "bg-slate-500 dark:bg-faint"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-[11px] rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
                showResolved ? "translate-x-[11px]" : ""
              }`}
            />
          </span>
          Show resolved
        </button>
        {!column && (
          <IconButton
            label="Close the threads"
            icon={X}
            onClick={() => {
              setSheetOpen(false);
            }}
          />
        )}
      </div>
      {mayComment &&
        drafting === null &&
        (captured === null ? (
          <p className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-hair-strong px-3 py-2.5 text-[13px] text-muted">
            <MessageSquarePlus aria-hidden size={16} className="shrink-0" />
            Select text in the page to comment on it.
          </p>
        ) : (
          <button
            ref={commentButton}
            type="button"
            // Keep the page's selection: a press that took focus would
            // collapse it before the click is handled.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              comment.reset();
              setDrafting(captured);
            }}
            className={`flex items-center gap-2.5 rounded-[10px] border border-accent-300 bg-accent-50 px-3 py-2.5 text-left text-[13px] font-medium text-accent-800 hover:bg-accent-100 dark:border-accent-700 dark:bg-accent-400/10 dark:text-accent-200 dark:hover:bg-accent-400/20 ${FOCUS_RING}`}
          >
            <MessageSquarePlus aria-hidden size={16} className="shrink-0" />
            Comment
          </button>
        ))}
      {showResolved && resolved.error && (
        <p role="alert" className={`text-sm ${ALERT}`}>
          {problemDetail(resolved.error)}
        </p>
      )}
      {drafting !== null && (
        <CommentForm
          anchor={drafting}
          source={sectionOf(drafting.section, sections)?.text ?? null}
          pending={comment.isPending}
          error={comment.error}
          onCancel={() => {
            kept.store.delete(commentKey);
            comment.reset();
            backToComment.current = true;
            setDrafting(null);
          }}
          onSubmit={(text) => {
            comment.mutate({ anchor: drafting, text });
          }}
        />
      )}
      <div className="flex flex-col">
        {order.map((key) => {
          const items = bySection.get(key);
          if (!items) {
            return null;
          }
          return (
            <div key={key || "gone"} className="flex flex-col">
              {key === "" && (
                <h3 className={`border-t border-hair pt-4 ${RAIL_LABEL}`}>
                  Not on the page any more
                </h3>
              )}
              {items.map(({ thread, state, heading: on, source }) => (
                <div
                  key={thread.id}
                  data-picked={picked === thread.id ? "" : undefined}
                  className={
                    picked === thread.id
                      ? // Muted text turns ink-3 on the wash, to keep 4.5:1.
                        "-mx-3 rounded-[10px] bg-accent-50 px-3 py-4 dark:bg-accent-400/16 [&_.text-muted]:text-ink-3"
                      : "border-t border-hair py-4"
                  }
                  onFocusCapture={() => {
                    setPicked(thread.id);
                  }}
                  onMouseEnter={() => {
                    setHovered(thread.id);
                  }}
                  onMouseLeave={() => {
                    setHovered((now) => (now === thread.id ? null : now));
                  }}
                >
                  <ThreadCard
                    thread={thread}
                    heading={on}
                    state={state}
                    source={source}
                    picked={picked === thread.id}
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
      </div>
    </>
  );

  // Outside the sheet, so it speaks whether the sheet is open or not.
  const status = (
    <p role="status" className="sr-only">
      {said ?? ""}
    </p>
  );

  if (column) {
    return (
      <Kept.Provider value={kept}>
        <aside aria-label="Threads" className="flex flex-col gap-3">
          {status}
          {body}
        </aside>
      </Kept.Provider>
    );
  }

  const pill =
    open.length === 0 ? "Threads" : plural(open.length, "thread", "threads");
  return (
    <Kept.Provider value={kept}>
      {status}
      <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        {/*
          A plain button rather than radix's trigger, whose code would land in
          the eager bundle beside the dialog the shell already uses; the
          sheet hands focus back to it by hand.
        */}
        <button
          ref={pillRef}
          type="button"
          aria-label={`Show ${open.length === 0 ? "threads" : pill}`}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          // Keep a selection on the page: the Comment button is in the
          // sheet, and it comments on what was selected.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            setSheetOpen(true);
          }}
          className={`fixed bottom-5 left-1/2 z-30 inline-flex h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 text-[15px] font-medium text-canvas shadow-pop print:hidden ${FOCUS_RING}`}
        >
          <MessagesSquare aria-hidden size={18} />
          {pill}
        </button>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 print:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            aria-modal="true"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // Back to the pill; when the column took over (the window grew
              // past the breakpoint) to the column's heading.
              (pillRef.current ?? threadsHeading.current)?.focus();
            }}
            // At the thread a tap or a link asked for, else at the heading:
            // the first control (the switch) is not where a reader starts.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              setOpenAt(null);
              const target =
                openAt === null ? null : document.getElementById(openAt);
              (target ?? threadsHeading.current)?.focus();
              target?.scrollIntoView?.({ block: "nearest" });
            }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-2xl bg-raised shadow-pop outline-none print:hidden"
          >
            <div
              aria-hidden
              className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-hair-strong"
            />
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              {body}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Kept.Provider>
  );
}

/** Where the comment in progress is kept while the sheet is shut. */
const COMMENT_KEY = "comment";

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
  const [text, setText] = useKept(COMMENT_KEY, "");
  const field = useId();
  const box = useRef<HTMLTextAreaElement | null>(null);
  const quote = quoteOf(anchor.quote);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <form
      aria-label="New comment"
      className="flex flex-col gap-2 rounded-[10px] border border-hair p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() !== "" && !pending) {
          onSubmit(text.trim());
        }
      }}
    >
      {quote !== null ? (
        <blockquote className="border-l-2 border-(--mark-rule) py-px pl-2.5 text-[13px] text-ink-3">
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
        className="rounded border border-hair-strong bg-raised px-2 py-1"
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

/**
 * One labelled field, its send button and Cancel, for a step that takes
 * words. The field takes focus when the form opens.
 */
function StepForm({
  keep,
  label,
  button,
  pending,
  error,
  onSend,
  onCancel,
}: {
  /** Where the words in progress are kept while the sheet is shut. */
  keep: string;
  label: string;
  button: string;
  pending: boolean;
  error: Error | null;
  /** Sends the words; the caller closes the form once they landed. */
  onSend: (text: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [value, setValue] = useKept(keep, "");
  const id = useId();
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  return (
    <form
      className="flex w-full flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() !== "" && !pending) {
          onSend(value.trim());
        }
      }}
    >
      <label htmlFor={id} className="text-caption">
        {label}
      </label>
      <input
        ref={field}
        id={id}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        className={`min-w-0 ${FIELD}`}
      />
      {error && (
        <p role="alert" className={ALERT}>
          {problemDetail(error)}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON.secondary}>
          {button}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON.ghost}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type Step = "answer" | "resolve";

/**
 * The write actions of an open thread: a quiet row of two buttons, each
 * opening its own form on demand. One form is open at a time, and closing it
 * (Cancel or a send that landed) returns focus to the button that opened it.
 */
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
  const [form, setForm] = useKept<Step | null>(`${thread.id}:form`, null);
  const forget = useForget();
  const answerButton = useRef<HTMLButtonElement | null>(null);
  const resolveButton = useRef<HTMLButtonElement | null>(null);
  // Set when a form closes, so focus goes back once its button is drawn again.
  const backTo = useRef<Step | null>(null);
  useEffect(() => {
    if (form === null && backTo.current !== null) {
      const button = backTo.current === "answer" ? answerButton : resolveButton;
      backTo.current = null;
      button.current?.focus();
    }
  }, [form]);
  const close = (step: Step) => {
    forget(`${thread.id}:${step}`);
    backTo.current = step;
    setForm(null);
  };
  // The kept words go when the step lands, at the mutation rather than in
  // the call's own callback: a sheet shut in between unmounts this row, and
  // only the mutation's callbacks still run then.
  const answer = useMutation({
    mutationFn: (text: string) =>
      stepThread(domain, thread.id, "answer", { path, text }),
    onSuccess: () => {
      forget(`${thread.id}:answer`);
      forget(`${thread.id}:form`);
      void onAnswered();
    },
  });
  const resolve = useMutation({
    mutationFn: (outcome: string) =>
      stepThread(domain, thread.id, "resolve", { path, outcome }),
    onSuccess: () => {
      forget(`${thread.id}:resolve`);
      forget(`${thread.id}:form`);
      void onResolved();
    },
  });
  const openForm = (step: Step) => {
    answer.reset();
    resolve.reset();
    setForm(step);
  };
  if (form === "answer") {
    return (
      <StepForm
        keep={`${thread.id}:answer`}
        label="Your answer"
        button="Answer"
        pending={answer.isPending}
        error={answer.error}
        onSend={(text) => {
          answer.mutate(text, {
            onSuccess: () => {
              close("answer");
            },
          });
        }}
        onCancel={() => {
          close("answer");
        }}
      />
    );
  }
  if (form === "resolve") {
    return (
      <StepForm
        keep={`${thread.id}:resolve`}
        label="Outcome"
        button="Resolve"
        pending={resolve.isPending}
        error={resolve.error}
        onSend={(text) => {
          resolve.mutate(text, {
            onSuccess: () => {
              // The thread moves out of this list, so focus goes to the
              // column's heading (set by `onResolved`), not back here.
              setForm(null);
            },
          });
        }}
        onCancel={() => {
          close("resolve");
        }}
      />
    );
  }
  return (
    <div className="flex gap-4">
      <button
        ref={answerButton}
        type="button"
        onClick={() => {
          openForm("answer");
        }}
        className={QUIET}
      >
        Answer
      </button>
      <button
        ref={resolveButton}
        type="button"
        onClick={() => {
          openForm("resolve");
        }}
        className={QUIET}
      >
        Resolve
      </button>
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
        className={QUIET}
      >
        Reopen
      </button>
      {reopen.error && (
        <p role="alert" className={`w-full ${ALERT}`}>
          {problemDetail(reopen.error)}
        </p>
      )}
    </>
  );
}
