/**
 * The parts of a printed page that the screen never shows and every reading
 * page shares: the title block at the top of the first page and the running
 * header and footer. The Related section of an engram and the Notes of a
 * Reflection page are modules of their own (`PrintRelated`, `PrintNotes`).
 *
 * Each block carries the `hidden` attribute and `data-print`: hidden on
 * screen and from assistive technology there, and shown by the print sheet
 * in `index.css`. The reading pages reach it through `PageActions`, beside
 * the Print view row, so it rides in the chunk they already share and none
 * of it reaches the eager bundle.
 *
 * The running header and footer are `@page` margin boxes. A margin box
 * cannot read the document, so the words go into a small style element
 * here. Chrome draws them (131 and later); Safari and Firefox do not draw
 * margin boxes, and there the title block carries the address and the print
 * date on its own.
 */

import type { ReactElement, RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import type { PrintFact } from "../printSheet";
import { cssString } from "../printSheet";

/** Today in the reader's words, `16 Oct 2026`. */
function today(): string {
  return new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Words with the day the page is printed in them. The day is read again as
 * printing starts and written straight into the element that shows it: a
 * re-render would land after the browser has laid out the printed page. So
 * a tab left open overnight prints today's date, not the day it was opened.
 */
function usePrintDate<T extends HTMLElement>(
  words: (date: string) => string,
): { ref: RefObject<T | null>; text: string } {
  const [date] = useState(today);
  const ref = useRef<T>(null);
  const latest = useRef(words);
  useEffect(() => {
    latest.current = words;
  });
  useEffect(() => {
    const refresh = () => {
      if (ref.current !== null) {
        ref.current.textContent = latest.current(today());
      }
    };
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("print")
        : null;
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        refresh();
      }
    };
    window.addEventListener("beforeprint", refresh);
    media?.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("beforeprint", refresh);
      media?.removeEventListener("change", onChange);
    };
  }, []);
  return { ref, text: words(date) };
}

/**
 * The running header and footer, in the browsers that draw `@page` margin
 * boxes: where the page comes from and its title at the top, the address,
 * the print date and the page number at the bottom. Their look is in
 * `index.css`.
 */
export function PrintPageStyle({
  source,
  title,
  address,
}: {
  /** Where the page comes from: the domain, and for a Reflection page "Reflection". */
  source: string;
  title: string;
  address: string;
}): ReactElement {
  // The first page opens with the title block, which says all of this once:
  // only its page number stays. Here rather than in `index.css`, where a
  // first-page rule loses to these later ones.
  const { ref, text } = usePrintDate<HTMLStyleElement>(
    (date) => `@media print {
@page {
  @top-left { content: ${cssString(source)}; }
  @top-right { content: ${cssString(title)}; }
  @bottom-left { content: ${cssString(address)}; }
  @bottom-right { content: ${cssString(`Printed ${date} \u00b7 `)} counter(page) " of " counter(pages); }
}
@page :first {
  @top-left { content: ""; }
  @top-right { content: ""; }
  @bottom-left { content: ""; }
  @bottom-right { content: counter(page) " of " counter(pages); }
}
}`,
  );
  return (
    <style ref={ref} data-print-page="">
      {text}
    </style>
  );
}

/**
 * The top of the first printed page: where the page comes from, its title,
 * its description, its facts, and its address with the print date.
 */
export function PrintTitleBlock({
  trail,
  title,
  lead = null,
  facts = [],
  address,
}: {
  /** Domain and folders, drawn small above the title. */
  trail: string[];
  /** Null when the page's own text opens with its title. */
  title: string | null;
  lead?: string | null;
  facts?: PrintFact[];
  address: string;
}): ReactElement {
  const { ref: printedRef, text: printed } = usePrintDate<HTMLSpanElement>(
    (date) => `Printed ${date}`,
  );
  return (
    <header
      hidden
      data-print=""
      className="print-title mb-1 border-b border-hair-strong pb-4"
    >
      <p className="text-caption font-medium tracking-[0.08em] text-muted uppercase">
        {trail.join(" / ")}
      </p>
      {title !== null && <p className="mt-1.5 text-display">{title}</p>}
      {lead !== null && (
        <p className="mt-2 text-lg leading-snug text-ink-3">{lead}</p>
      )}
      {facts.length > 0 && (
        <dl className="mt-3.5 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {facts.map((fact) => (
            <div key={fact.label} className="flex gap-1.5">
              <dt className="text-muted">{fact.label}</dt>
              <dd className="font-medium text-ink-2">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 flex flex-wrap justify-between gap-x-4 text-caption text-muted">
        <span className="font-mono">{address}</span>
        <span ref={printedRef}>{printed}</span>
      </p>
    </header>
  );
}
