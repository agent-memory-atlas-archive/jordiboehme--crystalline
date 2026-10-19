/**
 * One source of a Reflection section, as the page's source list and the
 * review screen draw it: the engram's title linked into its own domain, a
 * quiet domain marker when that is not the page's domain, and the state chip.
 * A source whose domain cannot be checked here is not linked: there is no
 * engram here to open.
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
  // The server names another domain by the local name it is reached by.
  const domain = source.domain ?? pageDomain;
  const foreign = domain !== pageDomain;
  // Inside the link, so two sources of one title in two domains have two
  // names; the visible marker beside it is for the eye only.
  const name = (
    <>
      {source.title}
      {foreign && (
        <>
          {" "}
          <span className="sr-only">{`in domain ${domain}`}</span>
        </>
      )}
    </>
  );
  return (
    <li className={className}>
      {source.state === "unavailable" ? (
        <span>{name}</span>
      ) : (
        <Link to={engramRoute(domain, source.permalink)} className={LINK}>
          {name}
        </Link>
      )}
      {foreign && (
        <span aria-hidden className="text-[12.5px] text-muted">
          {domain}
        </span>
      )}
      {sourceChip(source.state)}
    </li>
  );
}
