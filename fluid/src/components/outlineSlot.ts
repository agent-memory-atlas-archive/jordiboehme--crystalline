/**
 * Where a page hands its outline to the frame.
 *
 * On a phone the outline does not sit in the page's own rail but at the top
 * of the sidebar drawer, which the frame draws. The page fills this slot, the
 * drawer reads it.
 */

import type { RefObject } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import type { OutlineHeading } from "./PageOutline";

export interface OutlineSlot {
  headings: readonly OutlineHeading[];
  set: (headings: readonly OutlineHeading[]) => void;
}

export const OutlineSlotContext = createContext<OutlineSlot | null>(null);

/** Fill the frame's slot while `headings` is non-null; empty it on the way out. */
export function useOutlineSlot(headings: readonly OutlineHeading[] | null) {
  const slot = useContext(OutlineSlotContext);
  const set = slot?.set;
  useEffect(() => {
    if (!set || headings === null) {
      return;
    }
    set(headings);
    return () => {
      set([]);
    };
  }, [set, headings]);
}

/**
 * The `##` and `###` headings that carry an id inside a rendered body, kept
 * current while the body renders lazily or changes. The footnotes label has
 * no id, so it is not in the list.
 */
export function useBodyHeadings(
  root: RefObject<HTMLElement | null>,
  source: string,
): OutlineHeading[] {
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);
  const last = useRef("");
  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    const collect = () => {
      const found: OutlineHeading[] = [];
      for (const h of element.querySelectorAll("h2[id], h3[id]")) {
        found.push({
          id: h.id,
          text: (h.textContent ?? "").trim(),
          level: h.tagName === "H2" ? 2 : 3,
        });
      }
      const signature = JSON.stringify(found);
      if (signature !== last.current) {
        last.current = signature;
        setHeadings(found);
      }
    };
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(element, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, [root, source]);
  return headings;
}
