/**
 * The two ways of looking at a domain, Engrams and Reflection, and the one
 * notice that stands in for them when the Reflection lives on another
 * instance.
 *
 * Eager and small: it sits in the domain page's header, so it must cost the
 * entry almost nothing. It draws itself from `GET /domains/{d}/reflection`,
 * which never answers 409; a failed read draws nothing, because a switch
 * offering a mode that might not be there is worse than none. A reader who
 * cannot read engrams (a contributor) has one mode, and a switch with one
 * position is not a switch, so nothing is drawn for them either.
 *
 * The notice that stands where a Reflection screen would, while it cannot be
 * shown, lives in `ReflectionStateNotice.tsx` instead: only the lazy
 * Reflection screens draw it, so it stays out of the entry.
 */

import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Link } from "react-router";

import type { ReflectionStatus } from "../api/reflectionDomains";
import {
  fetchReflectionStatus,
  reflectionStatusKey,
} from "../api/reflectionDomains";
import { isWebAddress } from "../format";
import { domainRoute, reflectionRoute } from "../paths";
import { TOGGLE } from "./primitives";

const LINK =
  "text-sky-700 underline underline-offset-2 hover:no-underline dark:text-sky-400";

/** The one read every Reflection surface shares, under one key. */
// eslint-disable-next-line react-refresh/only-export-components
export function useReflectionStatus(
  domain: string,
): UseQueryResult<ReflectionStatus> {
  return useQuery({
    queryKey: reflectionStatusKey(domain),
    queryFn: () => fetchReflectionStatus(domain),
  });
}

/**
 * Where this domain's Reflection lives, as a link only when it is a web
 * address: the value is MANIFEST text, and a `javascript:` string must stay
 * text.
 */
export function HomeElsewhere({ url }: { url: string | null }): ReactElement {
  return (
    <p className="text-sm">
      {"This domain's Reflection lives at "}
      {url !== null && isWebAddress(url) ? (
        <a href={url} className={LINK}>
          {url}
        </a>
      ) : (
        (url ?? "another instance")
      )}
    </p>
  );
}

export function ReflectionModeSwitch({
  domain,
  current,
}: {
  domain: string;
  current: "engrams" | "reflection";
}): ReactElement | null {
  const status = useReflectionStatus(domain);
  const s = status.data;
  if (s === undefined || s.state === "off" || s.right === "none") {
    return null;
  }
  if (s.state === "elsewhere") {
    // On the Reflection home the state notice already says where it lives,
    // so the switch says it only on the domain page.
    return current === "engrams" ? <HomeElsewhere url={s.homeUrl} /> : null;
  }
  if (!s.engramsVisible) {
    return null;
  }
  const mode = (name: "engrams" | "reflection", label: string, to: string) => (
    <Link
      to={to}
      aria-current={current === name ? "page" : undefined}
      // Whole strings, never accent layered on a tier: the ledger's
      // cascade trap would leave the current mode looking unpressed.
      className={current === name ? TOGGLE.on : TOGGLE.off}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Domain view" className="flex gap-1">
      {mode("engrams", "Engrams", domainRoute(domain))}
      {mode("reflection", "Reflection", reflectionRoute(domain))}
    </nav>
  );
}
