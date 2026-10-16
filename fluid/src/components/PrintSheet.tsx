/**
 * The parts of a printed page that the screen never shows: the title block
 * at the top of the first page, the running header and footer, the Related
 * section of an engram and the Notes of a Reflection page.
 *
 * Each block carries the `hidden` attribute and `data-print`: hidden on
 * screen and from assistive technology there, and shown by the print sheet
 * in `index.css`. Only the reading screens import this module, so none of it
 * reaches the eager bundle.
 *
 * The running header and footer are `@page` margin boxes. A margin box
 * cannot read the document, so the words go into a small style element
 * here. Chrome draws them (131 and later); Safari and Firefox do not draw
 * margin boxes, and there the title block carries the address and the print
 * date on its own.
 */

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import type { AttachmentRow } from "../api/files";
import { inboundTitlesQuery } from "../api/inboundTitles";
import { assetRefsIn, engramAssetHome } from "../editor/imageFormat";
import { formatBytes, formatDayLong, plural } from "../format";
import type { PrintNote } from "../printNotes";
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
 * The day the page is printed, read again as printing starts: a tab left
 * open overnight prints today's date, not the day it was opened.
 */
function usePrintDate(): string {
  const [date, setDate] = useState(today);
  useEffect(() => {
    const refresh = () => {
      flushSync(() => {
        setDate(today());
      });
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
  return date;
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
  const date = usePrintDate();
  // The first page opens with the title block, which says all of this once:
  // only its page number stays. Here rather than in `index.css`, where a
  // first-page rule loses to these later ones.
  const css = `@media print {
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
}`;
  return <style data-print-page="">{css}</style>;
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
  const date = usePrintDate();
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
        <span>{`Printed ${date}`}</span>
      </p>
    </header>
  );
}

/** A printed list's small heading. */
const LIST_LABEL =
  "mb-1.5 text-caption font-semibold tracking-[0.08em] text-muted uppercase";

/**
 * The end of a printed engram: what links here, by title and relation, and
 * the files its text references, by name and size. The first page of links
 * prints; a longer list says how many more there are. Nothing prints when
 * there is neither.
 */
export function PrintRelated({
  domain,
  permalink,
  inboundCount,
  body,
}: {
  domain: string;
  permalink: string;
  inboundCount: number;
  body: string;
}): ReactElement | null {
  // The Linked from block's own query: on the reading column the rows are
  // already in the cache, and at full width this asks for them itself.
  const inbound = useInfiniteQuery(
    inboundTitlesQuery(domain, permalink, "", inboundCount > 0),
  );
  const home = useMemo(() => engramAssetHome(domain), [domain]);
  const referenced = useMemo(
    () => assetRefsIn(body, home.resolve),
    [body, home],
  );
  const listing = useQuery({
    queryKey: home.key,
    queryFn: () => home.list(),
    enabled: referenced.length > 0,
  });
  const first = inbound.data?.pages[0];
  const seen = new Set<string>();
  const links = (first?.hits ?? []).filter((hit) => {
    const key = `${hit.rel}\u0000${hit.domain}\u0000${hit.permalink}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const more = Math.max(0, (first?.total ?? 0) - (first?.hits.length ?? 0));
  const held = new Map<string, AttachmentRow>(
    (listing.data ?? []).map((row) => [row.path, row]),
  );
  if (links.length === 0 && referenced.length === 0) {
    return null;
  }
  const both = links.length > 0 && referenced.length > 0;
  return (
    <section
      hidden
      data-print=""
      aria-label="Related"
      className="print-related mt-10 border-t border-hair-strong pt-3"
    >
      <h2 className="mb-3 text-prose-h3">Related</h2>
      <div className={both ? "grid grid-cols-2 gap-8" : ""}>
        {links.length > 0 && (
          <div>
            <h3 className={LIST_LABEL}>Linked from</h3>
            <ul className="text-sm">
              {links.map((hit) => (
                <li
                  key={`${hit.rel}:${hit.domain}/${hit.permalink}`}
                  className="flex items-baseline justify-between gap-3 border-b border-hair py-1"
                >
                  <span className="min-w-0">
                    {hit.title}
                    {hit.domain !== domain && (
                      <span className="text-muted">{` (${hit.domain})`}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-caption text-muted">
                    {hit.rel}
                  </span>
                </li>
              ))}
            </ul>
            {more > 0 && (
              <p className="mt-1 text-caption text-muted">
                {`And ${plural(more, "more engram", "more engrams")}.`}
              </p>
            )}
          </div>
        )}
        {referenced.length > 0 && (
          <div>
            <h3 className={LIST_LABEL}>Attachments</h3>
            <ul className="text-sm">
              {referenced.map((path) => {
                const row = held.get(path);
                return (
                  <li
                    key={path}
                    className="flex items-baseline justify-between gap-3 border-b border-hair py-1"
                  >
                    <span className="min-w-0 break-all">
                      {path.slice(path.lastIndexOf("/") + 1)}
                    </span>
                    <span className="shrink-0 text-caption text-muted">
                      {row !== undefined
                        ? formatBytes(row.size)
                        : listing.isSuccess
                          ? "missing"
                          : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** What a thread entry says, as the thread card words it. */
function entryText(entry: PrintNote["thread"]["entries"][number]): string {
  if (entry.kind === "resolve") {
    return `Resolved: ${entry.text}`;
  }
  if (entry.kind === "reopen") {
    return entry.text === "" ? "Reopened" : `Reopened: ${entry.text}`;
  }
  return entry.text;
}

/** Where a note sits, in a few words. */
function placeOf(note: PrintNote): string | null {
  if (note.state === "section_gone") {
    return "Its section is gone.";
  }
  if (note.state === "text_changed") {
    return note.heading === null
      ? "The text changed."
      : `${note.heading}. The text changed.`;
  }
  if (note.quote === null) {
    return note.heading === null
      ? "On the whole intro."
      : `On the whole section ${note.heading}.`;
  }
  return note.heading;
}

/**
 * The open threads of a Reflection page, as numbered notes at its end. The
 * same numbers stand at the end of each quote in the printed text.
 */
export function PrintNotes({
  notes,
}: {
  notes: readonly PrintNote[];
}): ReactElement | null {
  if (notes.length === 0) {
    return null;
  }
  return (
    <section
      hidden
      data-print=""
      aria-label="Notes"
      className="print-notes mt-10 border-t border-hair-strong pt-3"
    >
      <h2 className="text-prose-h3">Notes</h2>
      <p className="mb-3 text-caption text-muted">
        The open threads on this page. The numbers match the marks in the text.
      </p>
      <ol className="flex flex-col gap-4">
        {notes.map((note) => {
          const place = placeOf(note);
          return (
            <li
              key={note.thread.id}
              className="print-note grid grid-cols-[1.75rem_minmax(0,1fr)] text-sm"
            >
              <span className="font-semibold text-ink tabular-nums">
                {note.n}
              </span>
              <div className="flex flex-col gap-1.5">
                {note.quote !== null && (
                  <blockquote className="border-l-2 border-(--mark-rule) pl-2.5 text-ink-3 italic">
                    {note.quote}
                  </blockquote>
                )}
                {place !== null && (
                  <p className="text-caption text-muted">{place}</p>
                )}
                {note.thread.entries.map((entry, index) => (
                  <div key={`${entry.at}-${String(index)}`}>
                    <p className="text-caption">
                      <span className="font-semibold text-ink">
                        {entry.author.name}
                        {entry.author.agent ? " (agent)" : ""}
                      </span>
                      <span className="text-muted">{` · ${formatDayLong(entry.at)}`}</span>
                    </p>
                    <p className="whitespace-pre-wrap text-ink-2">
                      {entryText(entry)}
                    </p>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
