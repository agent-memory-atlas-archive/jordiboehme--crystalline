/**
 * Which engrams link here, by title.
 *
 * One row per referencing engram: its title as a link to it, and the relation
 * it points with as small mono text on the right (`links_to` for a prose
 * wikilink). The rows come from the inbound endpoint, a page at a time, so an
 * engram a thousand engrams point at never loads them all: the first few rows
 * are drawn, "Show all N" opens the list the first page carries, and "Show
 * more" asks for the next page.
 *
 * Rows stay in the order the server answers them (by title), and a page that
 * arrives is appended below the rows already shown: a row never appears above
 * one the reader has already read. The relations are not grouped for the same
 * reason; their counts stand in a muted line above the rows instead.
 *
 * Past {@link FILTER_FROM} references a filter field appears. It asks the
 * server, which matches on title and path, and while it holds text every match
 * is listed rather than the first few.
 *
 * The first paint costs no request at all when nothing points here: the detail
 * payload already carries the exact whole-index `inboundCount`, so a zero is
 * answered from what the page has already read.
 *
 * An engram nothing points at says so. "Nothing links here yet" is a fact about
 * the knowledge base and an invitation to connect it; an empty block would read
 * as a panel that failed to load.
 */

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { problemDetail } from "../api/client";
import type { InboundRefHit } from "../api/inbound";
import { INBOUND_PAGE_SIZE, fetchInbound } from "../api/inbound";
import { RETIRED_CLASS, isRetired } from "../lifecycle";
import { engramRoute } from "../paths";
import { BUTTON, FOCUS_RING, RAIL_LABEL } from "./primitives";

/** How many rows show before "Show all N". */
export const LINKED_FROM_SHOWN = 5;

/** Above this many references the block offers a filter field. */
export const FILTER_FROM = 20;

/** How long the filter waits for the typing to pause. */
const FILTER_DELAY_MS = 250;

export interface LinkedFromProps {
  /** The engram being read. */
  domain: string;
  permalink: string;
  /**
   * How many references the detail payload counted, across the whole index.
   * Zero is answered without a request, and a count past {@link FILTER_FROM}
   * brings the filter field.
   */
  inboundCount: number;
}

/**
 * The rows in the server's order, an exact repeat (same relation, same
 * engram) dropped. Also how many were dropped, so a count can be honest.
 */
function distinct(hits: InboundRefHit[]): {
  rows: InboundRefHit[];
  dropped: number;
} {
  const seen = new Set<string>();
  const rows = hits.filter((hit) => {
    const key = `${hit.rel}\u0000${hit.domain}\u0000${hit.permalink}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  return { rows, dropped: hits.length - rows.length };
}

export function LinkedFrom({
  domain,
  permalink,
  inboundCount,
}: LinkedFromProps) {
  const [all, setAll] = useState(false);
  const [typed, setTyped] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter(typed.trim());
    }, FILTER_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);
  const filterable = inboundCount > FILTER_FROM;
  // A filter typed while the list was long is no filter once it is not.
  const filtering = filterable && filter !== "";

  const inbound = useInfiniteQuery({
    queryKey: ["inbound", domain, permalink, "titles", filtering ? filter : ""],
    queryFn: ({ pageParam }) =>
      fetchInbound(domain, permalink, {
        page: pageParam,
        limit: INBOUND_PAGE_SIZE,
        q: filtering ? filter : "",
      }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
    // The rows stay while a new filter is on its way, so the field does not
    // lose its list under the reader's fingers.
    placeholderData: keepPreviousData,
    // Nothing points here, and the detail payload already said so exactly.
    enabled: inboundCount > 0,
  });

  const pages = inbound.data?.pages ?? [];
  const total = pages[0]?.total ?? 0;
  const types = pages[0]?.types ?? [];
  const { rows, dropped } = distinct(pages.flatMap((page) => page.hits));
  const capped = !all && !filtering;
  const shown = capped ? rows.slice(0, LINKED_FROM_SHOWN) : rows;
  const exist = total - dropped;
  const more = capped
    ? rows.length > LINKED_FROM_SHOWN || inbound.hasNextPage
    : inbound.hasNextPage;

  return (
    <section aria-label="Linked from" className="text-sm">
      <h2 className={`mb-2 ${RAIL_LABEL}`}>Linked from</h2>
      {filterable && (
        <input
          type="search"
          aria-label="Filter linked engrams"
          placeholder="Filter by title"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
          className={`mb-2 h-8 w-full rounded-[7px] border border-hair bg-transparent px-2 text-sm placeholder:text-faint ${FOCUS_RING}`}
        />
      )}
      {types.length > 1 && (
        <p className="mb-1 font-mono text-caption text-faint">
          {types
            .map((entry) => `${entry.rel} ${String(entry.count)}`)
            .join(" · ")}
        </p>
      )}
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
        <p className="text-muted">
          {filtering ? "No match." : "Nothing links here yet."}
        </p>
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
                  className={`min-w-0 rounded text-link underline decoration-(--link-line) decoration-1 underline-offset-[3px] hover:no-underline ${FOCUS_RING} ${
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
          {more && (
            <button
              type="button"
              className={`${BUTTON.ghost} -ml-2 mt-1`}
              disabled={inbound.isFetchingNextPage}
              onClick={() => {
                if (capped && rows.length > LINKED_FROM_SHOWN) {
                  setAll(true);
                } else {
                  setAll(true);
                  void inbound.fetchNextPage();
                }
              }}
            >
              {capped && rows.length > LINKED_FROM_SHOWN
                ? `Show all ${String(exist)}`
                : "Show more"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
