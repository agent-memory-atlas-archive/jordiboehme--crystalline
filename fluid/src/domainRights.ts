/**
 * What a domain's front page and its settings screen both need to know about
 * the domain and the caller: the listing row, the members read, and the rules
 * the rename and write controls follow. One hook, so the two screens cannot
 * disagree about who may rename or why a control is shut.
 */

import { useQuery } from "@tanstack/react-query";

import { ApiProblem } from "./api/client";
import { DOMAINS_QUERY_KEY, fetchDomains } from "./api/domains";
import { fetchMembers, membersKey, sameAccount } from "./api/members";
import { useAuth } from "./auth/AuthContext";
import {
  READ_ONLY_REASON,
  RENAMING_REASON,
} from "./components/DestructiveAction";

export function useDomainRights(domain: string) {
  const { user, capabilities } = useAuth();
  const listing = useQuery({
    queryKey: DOMAINS_QUERY_KEY,
    queryFn: fetchDomains,
    // A rename in progress on THIS domain - this session's own, or another
    // live instance's sharing the same index - pauses it until it lands, and
    // the page has no other way to learn that it cleared: nothing here
    // pushes, so it polls. Keyed to this domain by name, not to "some domain
    // in the listing": a rename elsewhere is somebody else's page to poll.
    // Stopped rather than backed off once a fetch fails: a failing poll
    // every second would hammer a server that is already in trouble.
    refetchInterval: (query) => {
      if (query.state.status === "error") {
        return false;
      }
      const mine = query.state.data?.domains.find(
        (entry) => entry.name === domain,
      );
      return mine?.renaming === true ? 1000 : false;
    },
  });
  const summary = listing.data?.domains.find((entry) => entry.name === domain);
  // The members read the danger zone and the members card make, under the
  // same key, so one request serves all of them.
  const members = useQuery({
    queryKey: membersKey(domain),
    queryFn: () => fetchMembers(domain),
  });
  const owner = members.data?.owner ?? null;
  // An instance admin, or the owner of a private domain: the rule
  // `POST /rename` and unregistering enforce server side.
  const own =
    capabilities.canAdminister ||
    (user !== null && owner !== null && sameAccount(owner, user.name));
  const isRenaming = summary?.renaming === true;
  const renameDisabledReason = capabilities.readOnly
    ? READ_ONLY_REASON
    : isRenaming
      ? RENAMING_REASON
      : undefined;
  /**
   * Every other write control - New engram, Edit MANIFEST, Import archive -
   * shares this one reason: a rename pauses the domain, and a write pressed
   * then would sit on that wait with no idea why.
   */
  const writeDisabledReason = isRenaming ? RENAMING_REASON : undefined;
  return {
    summary,
    listing,
    members,
    own,
    isRenaming,
    renameDisabledReason,
    writeDisabledReason,
  };
}

/** Whether this failure is the server saying there is nothing at that address. */
export function isMissing(error: unknown): boolean {
  return error instanceof ApiProblem && error.status === 404;
}
