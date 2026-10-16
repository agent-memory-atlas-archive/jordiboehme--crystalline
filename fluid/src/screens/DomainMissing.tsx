/**
 * What a domain's screens show for an address with no domain behind it, or a
 * domain whose engrams this caller cannot read: the front page and the
 * settings screen answer it the same way.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";

import {
  REFLECTION_DOMAINS_KEY,
  fetchReflectionDomains,
} from "../api/reflectionDomains";
import { Skeleton } from "../components/Skeleton";
import { CHROME_LINK } from "../components/primitives";
import { reflectionRoute } from "../paths";

/**
 * A domain whose engrams this caller cannot read. For a person with
 * knowledge `none` that is every domain it works on: the engram tree answers
 * 404 exactly as for a stranger, and the Reflection listing is what tells the
 * two apart. A listed domain goes to its Reflection; anything else is the
 * wrong address it always was, and nothing here says more than that.
 */
export function MissingOrReflection({ domain }: { domain: string }) {
  const listing = useQuery({
    queryKey: REFLECTION_DOMAINS_KEY,
    queryFn: fetchReflectionDomains,
  });
  if (listing.isPending) {
    return <Skeleton label="Loading the domain" rows={3} />;
  }
  // A pending, homeless or hosted_elsewhere Reflection still goes to its
  // home, which shows the notice. One that lives elsewhere stays here: this
  // instance has neither its engrams nor its Reflection, and Home's
  // Reflection listing is where the home link is shown. A row whose engrams
  // the caller reads never redirects: for that caller the 404 is a missing
  // folder or domain, not a door to the Reflection.
  if (
    listing.data?.some(
      (row) =>
        row.domain === domain &&
        !row.engramsVisible &&
        row.state !== "elsewhere",
    )
  ) {
    return <Navigate to={reflectionRoute(domain)} replace />;
  }
  return <DomainNotFound domain={domain} />;
}

/** The wrong-address screen, which is not the same thing as an empty domain. */
function DomainNotFound({ domain }: { domain: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-display">Domain not found</h1>
      <p className="text-sm">
        No domain named {`"${domain}"`} is registered on this instance.
      </p>
      <Link to="/" className={`text-sm ${CHROME_LINK}`}>
        See the domains that are
      </Link>
    </div>
  );
}
