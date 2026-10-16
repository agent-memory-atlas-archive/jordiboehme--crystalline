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
 * on `beforeprint` and taken out on `afterprint`, at the ends of the ranges
 * the quotes are painted with. On screen the page holds none of them, so
 * nothing they add can move a quote's anchor.
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

/** What one placed number took apart, to put it back. */
interface Placed {
  marker: HTMLElement;
  /** The text node cut in two, its first half, and the words it held. */
  split: { text: Text; rest: Text; whole: string } | null;
}

/**
 * Put a small number at the end of each range, and return what takes them
 * out again. A text node the end falls inside is cut in two for it; the cut
 * is mended on the way out, so the node React holds keeps its words.
 */
export function placeMarkers(
  marks: readonly { range: Range; n: number }[],
): () => void {
  const placed: Placed[] = [];
  for (const { range, n } of marks) {
    const node = range.endContainer;
    const offset = range.endOffset;
    if (!node.isConnected) {
      continue;
    }
    const marker = document.createElement("sup");
    marker.className = MARKER_CLASS;
    marker.setAttribute(SKIP_ATTR, "");
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = String(n);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (offset >= text.length) {
        text.after(marker);
        placed.push({ marker, split: null });
      } else if (offset <= 0) {
        text.before(marker);
        placed.push({ marker, split: null });
      } else {
        const whole = text.data;
        const rest = text.splitText(offset);
        text.after(marker);
        placed.push({ marker, split: { text, rest, whole } });
      }
    } else {
      node.insertBefore(marker, node.childNodes[offset] ?? null);
      placed.push({ marker, split: null });
    }
  }
  return () => {
    for (const { marker, split } of placed.reverse()) {
      marker.remove();
      if (split === null) {
        continue;
      }
      const { text, rest, whole } = split;
      // Mended only when nothing rewrote the words meanwhile; a node React
      // gave new words to keeps them, and the stale half goes.
      if (text.data + rest.data === whole) {
        text.appendData(rest.data);
      }
      rest.remove();
    }
  };
}
