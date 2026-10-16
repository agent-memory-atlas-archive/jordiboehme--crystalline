/**
 * A Reflection page on paper: its open threads as numbered notes at the end,
 * and a small number at the end of each thread's quote in the text.
 *
 * The numbers follow the page: sections in their order, and inside a section
 * the quotes by where they start. A thread on a whole section comes before
 * the quotes in it; a thread whose words changed, or whose section is gone,
 * comes last, with a note and no number in the text. Resolved threads are
 * not printed.
 *
 * The numbers in the text exist only while the page prints. They are put in
 * on `beforeprint` and taken out on `afterprint`, at the end of the block
 * that holds the end of each painted quote. On screen the page holds none
 * of them, and they never cut the text, so nothing they add can move a
 * quote's anchor or a reader's selection.
 */

import type { AnchorState, ThreadView } from "./api/reflection";
import { SKIP_ATTR, displayQuote } from "./reflectionQuotes";
import type { SectionText } from "./reflectionText";
import { TOP_SECTION, locateQuote } from "./reflectionText";

/** One printed note. */
export interface PrintNote {
  /** Its number, from 1. */
  n: number;
  thread: ThreadView;
  /** Where the thread stands on the text as it is now. */
  state: AnchorState;
  /** The heading it sits under, or null for the intro or a gone section. */
  heading: string | null;
  /** The quote as a reader sees it, or null for a thread on a section. */
  quote: string | null;
}

/** The class the printed numbers in the text wear. */
export const MARKER_CLASS = "print-marker";

/**
 * The open threads of a page as numbered notes, in reading order.
 */
export function printNotes(
  threads: readonly ThreadView[],
  sections: readonly SectionText[],
): PrintNote[] {
  const keyed = threads
    .filter((thread) => thread.status === "open")
    .map((thread) => {
      const at = sections.findIndex(
        (s) => (s.id ?? s.heading) === thread.anchor.section,
      );
      const section = sections[at];
      const stored = thread.anchor.quote === "" ? null : thread.anchor.quote;
      let state: AnchorState = "found";
      let place = -1;
      let quote = stored;
      if (section === undefined) {
        state = "section_gone";
      } else if (stored !== null) {
        const found = locateQuote(
          section.text,
          stored,
          thread.anchor.occurrence,
        );
        if (found === null) {
          state = "text_changed";
          place = Number.MAX_SAFE_INTEGER;
        } else {
          place = found.start;
          quote = displayQuote(section.text, found.start, found.end);
        }
      }
      return {
        thread,
        state,
        quote,
        heading:
          section === undefined || section.id === TOP_SECTION
            ? null
            : section.heading,
        order: [at < 0 ? Number.MAX_SAFE_INTEGER : at, place] as const,
      };
    });
  keyed.sort(
    (a, b) =>
      a.order[0] - b.order[0] ||
      a.order[1] - b.order[1] ||
      a.thread.openedAt.localeCompare(b.thread.openedAt),
  );
  return keyed.map(({ thread, state, quote, heading }, index) => ({
    n: index + 1,
    thread,
    state,
    heading,
    quote,
  }));
}

/** The blocks a printed number is set at the end of. */
export const MARKER_BLOCKS =
  "p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre";

/**
 * Put a small number at the end of the block (paragraph, list item,
 * heading, table cell, quote) that holds the end of each range, and return
 * what takes them out again. Several numbers in one block follow each other
 * in order.
 *
 * Nothing in the text is touched: no text node is cut, and each number is
 * an element appended after everything the block holds. So every live range
 * on the page (a reader's selection, a painted quote) keeps its boundaries
 * while the numbers are in and after they are out, and React, which never
 * reads past the children it put there, does not see them.
 */
export function placeMarkers(
  marks: readonly { range: Range; n: number }[],
): () => void {
  const placed: HTMLElement[] = [];
  for (const { range, n } of [...marks].sort((a, b) => a.n - b.n)) {
    const end = range.endContainer;
    const host =
      end.nodeType === Node.TEXT_NODE ? end.parentElement : (end as Element);
    const block = host?.closest(MARKER_BLOCKS);
    if (block == null || !block.isConnected) {
      continue;
    }
    const marker = document.createElement("sup");
    marker.className = MARKER_CLASS;
    marker.setAttribute(SKIP_ATTR, "");
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = String(n);
    block.append(marker);
    placed.push(marker);
  }
  return () => {
    for (const marker of placed) {
      marker.remove();
    }
  };
}

/** Whether a DOM change only put printed numbers in or took them out. */
export function onlyMarkers(records: readonly MutationRecord[]): boolean {
  const marker = (node: Node) =>
    node instanceof Element && node.classList.contains(MARKER_CLASS);
  return records.every(
    (record) =>
      record.type === "childList" &&
      [...record.addedNodes, ...record.removedNodes].every(marker),
  );
}
