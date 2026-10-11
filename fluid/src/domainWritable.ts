/**
 * Whether this session may change one domain, and whether the domain wears
 * the lock.
 *
 * Two facts with two sources, kept apart on purpose (spec review point 6).
 * The lock is the domain's own `read_only` policy row, read off the MANIFEST
 * query the domain page and the policies card already share: only that row
 * draws the chip and its "its owner switches read_only off" line. Whether
 * this caller may write is the listing row's `read_only` (a viewer, an
 * account whose write list leaves the domain out, or the lock), folded with
 * the instance gate `capabilities.canWrite`. Every control that writes into
 * a domain asks `canWrite` here, never `capabilities.canWrite` alone.
 */
import { useQuery } from "@tanstack/react-query";

import { fetchManifest, manifestKey } from "./api/domain";
import type { ManifestView, PolicyView } from "./api/domain";
import { DOMAINS_QUERY_KEY, fetchDomains } from "./api/domains";
import { useAuth } from "./auth/AuthContext";

/** Whether these policy rows hold `read_only` on. */
export function policiesLocked(policies: PolicyView[] | undefined): boolean {
  return (
    policies?.some(
      (row) => row.key === "read_only" && row.effective === "on",
    ) === true
  );
}

/** Whether this MANIFEST's `read_only` row is on. */
export function domainLockedIn(manifest: ManifestView | undefined): boolean {
  return policiesLocked(manifest?.sections?.policies);
}

export function useDomainWritable(domain: string): {
  canWrite: boolean;
  domainLocked: boolean;
} {
  const { capabilities } = useAuth();
  const listing = useQuery({
    queryKey: DOMAINS_QUERY_KEY,
    queryFn: fetchDomains,
  });
  const manifest = useQuery({
    queryKey: manifestKey(domain),
    queryFn: () => fetchManifest(domain),
    enabled: domain !== "",
  });
  const domainLocked = domainLockedIn(manifest.data);
  const writeBlocked =
    listing.data?.domains.find((entry) => entry.name === domain)
      ?.writeBlocked === true;
  return {
    canWrite: capabilities.canWrite && !writeBlocked && !domainLocked,
    domainLocked,
  };
}
