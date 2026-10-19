import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import type { OutlineHeading } from "./components/PageOutline";

/** The fewest `##` sections that earn an outline. */
export const MIN_SECTIONS = 3;

/** Whether these headings are enough for an outline. */
export function worthAnOutline(headings: readonly OutlineHeading[]): boolean {
  return headings.filter((h) => h.level === 2).length >= MIN_SECTIONS;
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
