/**
 * The two ways of looking at a domain, Engrams and Reflection, and the one
 * notice that stands in for them when the Reflection lives on another
 * instance.
 *
 * Eager and small: it sits in the top bar, so it must cost the entry almost
 * nothing. It draws itself from `GET /domains/{d}/reflection`,
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
import { ExternalLink } from "lucide-react";
import { Link, useLocation } from "react-router";

import type { ReflectionStatus } from "../api/reflectionDomains";
import {
  fetchReflectionStatus,
  reflectionStatusKey,
} from "../api/reflectionDomains";
import { isWebAddress } from "../format";
import { domainRoute, reflectionRoute } from "../paths";
import { FOCUS_RING } from "./primitives";

const LINK =
  "text-link underline decoration-(--link-line) decoration-1 underline-offset-[3px] hover:no-underline";

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

/**
 * The mode switch in the top bar: "Engrams | Reflection" as a segmented
 * control, the selected half a raised pill, `aria-current` and bold weight so
 * the pill is never the only cue (spec 4.1, 4.2, 6).
 *
 * `aria-current` is "page" only on the link whose address is on screen (the
 * domain page, the Reflection home) and "true" on the mode an engram page, an
 * editor or a Reflection page belongs to: the reader is in that mode, not on
 * that page.
 *
 * A Reflection that lives on another instance keeps the switch, with its
 * Reflection half a link out to that instance. Only a web address becomes
 * that link: the value is MANIFEST text, and without a safe one there is
 * nowhere to go, so no switch is drawn.
 */
export function ReflectionModeSwitch({
  domain,
  current,
  fill = false,
}: {
  domain: string;
  current: "engrams" | "reflection";
  /** Fill the row it stands in, for the phone row under the bar. */
  fill?: boolean;
}): ReactElement | null {
  const status = useReflectionStatus(domain);
  const { pathname } = useLocation();
  const s = status.data;
  if (
    s === undefined ||
    s.state === "off" ||
    s.right === "none" ||
    !s.engramsVisible
  ) {
    return null;
  }
  const away =
    s.state === "elsewhere"
      ? s.homeUrl !== null && isWebAddress(s.homeUrl)
        ? s.homeUrl
        : null
      : undefined;
  if (away === null) {
    return null;
  }
  const half = `inline-flex items-center justify-center gap-1.5 rounded-[7px] px-3 text-[13.5px] ${
    fill ? "h-8 flex-1" : "h-7"
  } ${FOCUS_RING}`;
  const mode = (name: "engrams" | "reflection", label: string, to: string) => (
    <Link
      to={to}
      aria-current={
        current === name ? (pathname === to ? "page" : "true") : undefined
      }
      className={`${half} ${
        current === name
          ? "bg-seg-on font-semibold text-ink shadow-[0_1px_2px_rgb(15_23_42/0.08),0_0_0_1px_rgb(15_23_42/0.04)]"
          : "font-medium text-muted hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="Domain view"
      className={`${fill ? "flex" : "inline-flex"} shrink-0 gap-0.5 rounded-[9px] bg-seg p-[3px]`}
    >
      {mode("engrams", "Engrams", domainRoute(domain))}
      {away === undefined ? (
        mode("reflection", "Reflection", reflectionRoute(domain))
      ) : (
        <a
          href={away}
          aria-label="Reflection (opens on another server)"
          className={`${half} font-medium text-muted hover:text-ink`}
        >
          Reflection
          <ExternalLink aria-hidden="true" size={12} strokeWidth={1.75} />
        </a>
      )}
    </nav>
  );
}
