/**
 * Which section of a long page the reader is in: the first listed heading
 * that sits in the top band of the window, or the last one that was, while
 * the reader is between two of them.
 */

import { useEffect, useState } from "react";

/** The band that counts: from the window's top down to a third of its height. */
const BAND = "0px 0px -66% 0px";

export function useActiveHeading(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("\n");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }
    const order = key === "" ? [] : key.split("\n");
    const inside = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) {
            inside.add(id);
          } else {
            inside.delete(id);
          }
        }
        const first = order.find((id) => inside.has(id));
        if (first !== undefined) {
          setActive(first);
        }
      },
      { rootMargin: BAND },
    );
    for (const id of order) {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    }
    return () => {
      observer.disconnect();
    };
  }, [key]);

  return active;
}
