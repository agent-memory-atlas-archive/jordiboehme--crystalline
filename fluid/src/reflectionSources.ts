/**
 * The words for a Reflection's sources from other domains. A source in a
 * domain the reader may not open reaches Fluid only as a count (the server
 * decides; Fluid never filters), and these say it.
 */

import type { SectionView, SourceView } from "./api/reflection";
import { plural } from "./format";

/** "1 source in a domain you cannot open", "3 sources in ...". */
export function hiddenSourcesText(count: number): string {
  return `${plural(count, "source", "sources")} in a domain you cannot open`;
}

/** "2 sources in ops cannot be checked here." */
export function unavailableSourcesText(count: number, domain: string): string {
  return `${plural(count, "source", "sources")} in ${domain} cannot be checked here.`;
}

/** The key a list of sources gives each row: one engram per domain. */
export function sourceKey(pageDomain: string, source: SourceView): string {
  return `${source.domain ?? pageDomain}/${source.permalink}`;
}

/**
 * How many distinct engrams a page's sections were built from, as the
 * reader is shown them: one engram per domain and permalink, so a source of
 * another domain never folds into a local one of the same permalink.
 */
export function distinctSources(
  sections: Pick<SectionView, "sources">[],
): number {
  return new Set(
    sections.flatMap((s) =>
      (s.sources ?? []).map((x) => `${x.domain ?? ""}/${x.permalink}`),
    ),
  ).size;
}
