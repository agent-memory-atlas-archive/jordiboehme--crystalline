/**
 * One source of a Reflection section, as the page's source list and the
 * review screen draw it: the engram's title linked into its own domain, a
 * quiet domain marker when that is not the page's domain, and the state chip.
 */

import type { ReactElement } from "react";
import { Link } from "react-router";

import type { SourceView } from "../api/reflection";
import { engramRoute } from "../paths";
import { sourceChip } from "./ReflectionThreads";

const LINK =
  "text-link underline decoration-(--link-line) decoration-1 underline-offset-[3px] hover:no-underline";

export function SourceRow({
  pageDomain,
  source,
  className,
}: {
  /** The domain of the page the source belongs to. */
  pageDomain: string;
  source: SourceView;
  className: string;
}): ReactElement {
  const domain = source.domain ?? pageDomain;
  return (
    <li className={className}>
      <Link to={engramRoute(domain, source.permalink)} className={LINK}>
        {source.title}
      </Link>
      {domain !== pageDomain && (
        <span className="text-[12.5px] text-muted">
          <span className="sr-only">{" in domain "}</span>
          {domain}
        </span>
      )}
      {sourceChip(source.state)}
    </li>
  );
}
