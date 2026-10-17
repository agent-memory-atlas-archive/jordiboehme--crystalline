/**
 * "On this page": the outline of a long page, its `##` and `###` headings as
 * links, with the section being read marked. Nothing below three `##`
 * sections, where the page is short enough to see at once.
 */

import type { ReactElement } from "react";
import { useState } from "react";

import { useActiveHeading } from "../useActiveHeading";
import { FOCUS_RING, RAIL_LABEL } from "./primitives";

export interface OutlineHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

/** The fewest `##` sections that earn an outline. */
const MIN_SECTIONS = 3;

export function PageOutline({
  headings,
  onNavigate,
}: {
  headings: readonly OutlineHeading[];
  /** Called after a link scrolled, for a drawer that should shut. */
  onNavigate?: (() => void) | undefined;
}): ReactElement | null {
  const active = useActiveHeading(headings.map((h) => h.id));
  // A link just followed marks its section until the scroll moves on.
  const [picked, setPicked] = useState<{
    id: string;
    at: string | null;
  } | null>(null);
  if (headings.filter((h) => h.level === 2).length < MIN_SECTIONS) {
    return null;
  }
  const current = picked !== null && picked.at === active ? picked.id : active;
  return (
    <nav aria-labelledby="page-outline-label" className="print:hidden">
      <p id="page-outline-label" className={`mb-2 ${RAIL_LABEL}`}>
        On this page
      </p>
      <ol className="flex flex-col gap-0.5">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              aria-current={current === heading.id ? "location" : undefined}
              onClick={(event) => {
                const target = document.getElementById(heading.id);
                if (target) {
                  event.preventDefault();
                  target.scrollIntoView({ block: "start" });
                  setPicked({ id: heading.id, at: active });
                }
                onNavigate?.();
              }}
              className={`block rounded py-0.5 text-[13px] leading-snug text-muted hover:text-ink aria-[current=location]:font-semibold aria-[current=location]:text-ink ${
                heading.level === 3 ? "pl-4" : ""
              } ${FOCUS_RING}`}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
