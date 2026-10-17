/**
 * The Linked from block's query, apart from `inbound.ts` so the eager bundle
 * that reads that module does not carry it.
 */

import { infiniteQueryOptions } from "@tanstack/react-query";

import type { InboundRefPage } from "./inbound";
import { INBOUND_PAGE_SIZE, fetchInbound } from "./inbound";

/**
 * The referencing engrams by title, a page at a time, under an optional
 * filter. One description for the two readers of it, the Linked from block
 * and the printed Related section, so the two share one cache entry.
 */
export function inboundTitlesQuery(
  domain: string,
  permalink: string,
  filter: string,
  enabled: boolean,
) {
  return infiniteQueryOptions({
    queryKey: ["inbound", domain, permalink, "titles", filter],
    queryFn: ({ pageParam }) =>
      fetchInbound(domain, permalink, {
        page: pageParam,
        limit: INBOUND_PAGE_SIZE,
        q: filter,
      }),
    initialPageParam: 1,
    getNextPageParam: (last: InboundRefPage) =>
      last.page * last.limit < last.total ? last.page + 1 : undefined,
    enabled,
  });
}
