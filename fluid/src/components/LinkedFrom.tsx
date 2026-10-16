/**
 * Which engrams link here, by title.
 *
 * One row per referencing engram: its title as a chrome link to it, and the
 * relation it points with as small mono text on the right (`links_to` for a
 * prose wikilink). The rows come from the inbound endpoint, a page at a time,
 * so an engram a thousand engrams point at never loads them all: the first
 * few rows are drawn, "Show all N" opens the list the first page carries, and
 * "Show more" asks for the next page.
 *
 * The first paint costs no request at all when nothing points here: the detail
 * payload already carries the exact whole-index `inboundCount`, so a zero is
 * answered from what the page has already read.
 *
 * Rows are grouped by relation, the most used relation first (the order the
 * endpoint reports them in), and sorted by title inside a group, so the same
 * relation reads as one run instead of being scattered.
 *
 * An engram nothing points at says so. "Nothing links here yet" is a fact about
 * the knowledge base and an invitation to connect it; an empty block would read
 * as a panel that failed to load.
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { problemDetail } from "../api/client";
import type { InboundRefHit } from "../api/inbound";
import { INBOUND_PAGE_SIZE, fetchInbound } from "../api/inbound";
import { RETIRED_CLASS, isRetired } from "../lifecycle";
import { engramRoute } from "../paths";
import { BUTTON, CHROME_LINK, FOCUS_RING, RAIL_LABEL } from "./primitives";

/** How many rows show before "Show all N". */
export const LINKED_FROM_SHOWN = 5;

export interface LinkedFromProps {
  /** The engram being read. */
  domain: string;
  permalink: string;
  /**
   * How many references the detail payload counted, across the whole index.
   * Zero is answered without a request.
   */
  inboundCount: number;
}

/** Group by relation (most used first), then by title, dropping exact repeats. */
function arranged(
  hits: InboundRefHit[],
  order: readonly string[],
): InboundRefHit[] {
  const rank = (rel: string) => {
    const at = order.indexOf(rel);
    return at === -1 ? order.length : at;
  };
  const seen = new Set<string>();
  const unique = hits.filter((hit) => {
    const key = `${hit.rel}\u0000${hit.domain}\u0000${hit.permalink}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return unique.sort(
    (a, b) =>
      rank(a.rel) - rank(b.rel) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  );
}

export function LinkedFrom({
  domain,
  permalink,
  inboundCount,
}: LinkedFromProps) {
  const [all, setAll] = useState(false);
  const inbound = useInfiniteQuery({
    queryKey: ["inbound", domain, permalink, "titles"],
    queryFn: ({ pageParam }) =>
      fetchInbound(domain, permalink, {
        page: pageParam,
        limit: INBOUND_PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
    // Nothing points here, and the detail payload already said so exactly.
    enabled: inboundCount > 0,
  });

  const pages = inbound.data?.pages ?? [];
  const total = pages[0]?.total ?? 0;
  const order = (pages[0]?.types ?? []).map((entry) => entry.rel);
  const rows = arranged(
    pages.flatMap((page) => page.hits),
    order,
  );
  const shown = all ? rows : rows.slice(0, LINKED_FROM_SHOWN);
  const hiddenCount = total - shown.length;

  return (
    <section aria-label="Linked from" className="text-sm">
      <h2 className={`mb-2 ${RAIL_LABEL}`}>Linked from</h2>
      {inboundCount > 0 && inbound.isPending ? (
        <p className="text-muted">Looking for what points here</p>
      ) : inbound.error ? (
        <p
          role="alert"
          className="rounded bg-red-50 px-2 py-1 text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {/*
            What the reader lost, then the server's own words for why: the
            detail is the only part of this that says anything specific, and
            every other error surface in this app prints it verbatim.
          */}
          What points here is unknown: {problemDetail(inbound.error)}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted">Nothing links here yet.</p>
      ) : (
        <>
          <ul className="flex flex-col">
            {shown.map((hit) => (
              <li
                key={`${hit.rel}:${hit.domain}/${hit.permalink}`}
                className="flex items-baseline justify-between gap-3 py-1"
              >
                <Link
                  to={engramRoute(hit.domain, hit.permalink)}
                  title={`${hit.domain} / ${hit.path || hit.permalink}`}
                  className={`min-w-0 rounded ${CHROME_LINK} ${FOCUS_RING} ${
                    isRetired(hit.status) ? RETIRED_CLASS : ""
                  }`}
                >
                  {hit.title}
                </Link>
                <span className="shrink-0 font-mono text-caption text-faint">
                  {hit.rel}
                </span>
              </li>
            ))}
          </ul>
          {!all && hiddenCount > 0 ? (
            <button
              type="button"
              className={`${BUTTON.ghost} -ml-2 mt-1`}
              onClick={() => {
                setAll(true);
              }}
            >
              Show all {total}
            </button>
          ) : (
            all &&
            inbound.hasNextPage && (
              <button
                type="button"
                className={`${BUTTON.ghost} -ml-2 mt-1`}
                disabled={inbound.isFetchingNextPage}
                onClick={() => {
                  void inbound.fetchNextPage();
                }}
              >
                Show more
              </button>
            )
          )}
        </>
      )}
    </section>
  );
}
