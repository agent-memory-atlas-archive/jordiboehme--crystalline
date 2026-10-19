/**
 * The two ways of looking at a domain, Reflection and Engrams, and the one
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
import { domainRoute, engramsRoute, reflectionRoute } from "../paths";
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
    // Outside a domain there is nothing to ask about.
    enabled: domain !== "",
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
 * Whether `/d/<domain>` opens on the Reflection for this answer: in effect
 * here and readable by the caller. The one rule the domain's address
 * (`DomainEntry` in routes.tsx) and the switch both read.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function opensOnReflection(
  s: Pick<ReflectionStatus, "state" | "right">,
): boolean {
  return s.state === "on" && s.right !== "none";
}

/** The four fields that decide the switch, on the status and the listing. */
type SwitchFacts = Pick<
  ReflectionStatus,
  "state" | "right" | "engramsVisible" | "homeUrl"
>;

/**
 * What the switch draws for these facts: false for no switch, null for both
 * halves on this instance, or the web address the Reflection half links out
 * to. The status and the eager Reflection listing carry the same fields, so
 * the phone row can ask the listing before the status has answered.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function switchHome(s: SwitchFacts): false | null | string {
  if (s.state === "off" || s.right === "none" || !s.engramsVisible) {
    return false;
  }
  if (s.state !== "elsewhere") {
    return null;
  }
  return s.homeUrl !== null && isWebAddress(s.homeUrl) ? s.homeUrl : false;
}

/**
 * The mode switch in the top bar: "Reflection | Engrams" as a segmented
 * control, the selected half a raised pill, `aria-current` and bold weight so
 * the pill is never the only cue (spec 4.1, 4.2, 6). Reflection comes first
 * since 0.28.1, when a domain started to open on it.
 *
 * `aria-current` is "page" only on the link whose address is on screen (the
 * engram view, the Reflection home) and "true" on the mode an engram page, an
 * editor or a Reflection page belongs to: the reader is in that mode, not on
 * that page.
 *
 * A Reflection that lives on another instance keeps the switch, with its
 * Reflection half a link out to that instance (current while one of this
 * instance's Reflection screens says so). Only a web address becomes that
 * link: the value is MANIFEST text, and without a safe one there is nowhere
 * to go, so no switch is drawn and the domain page says where it lives.
 */
export function ReflectionModeSwitch({
  domain,
  current,
  fill = false,
  listed,
}: {
  domain: string;
  current: "engrams" | "reflection";
  /** Fill the row it stands in, for the phone row under the bar. */
  fill?: boolean;
  /** The listing's facts, drawn from while the status has no answer. */
  listed?: SwitchFacts | undefined;
}): ReactElement | null {
  const status = useReflectionStatus(domain);
  const { pathname } = useLocation();
  const facts = status.data ?? listed;
  const away = facts === undefined ? false : switchHome(facts);
  if (away === false) {
    return null;
  }
  // The look lives in index.css (`.mode-half`), keyed on aria-current.
  const half = `mode-half ${fill ? "h-8 flex-1" : ""} ${FOCUS_RING}`;
  const reflection = reflectionRoute(domain);
  const engrams = engramsRoute(domain);
  // The domain's own address shows the engram view in place once its status
  // says it does not open on the Reflection (`DomainEntry`), so it is that
  // page too. Until then it is neither: no half is current before a forward.
  const opened = domainRoute(domain);
  const undecided =
    pathname === opened &&
    (status.data === undefined || opensOnReflection(status.data));
  const here = (name: "engrams" | "reflection", ...at: string[]) =>
    undecided || current !== name
      ? undefined
      : at.includes(pathname)
        ? "page"
        : "true";
  return (
    <nav
      aria-label="Domain view"
      className={`${fill ? "flex" : "ml-1.5 inline-flex"} shrink-0 gap-0.5 rounded-[9px] bg-seg p-[3px]`}
    >
      {away === null ? (
        <Link
          to={reflection}
          aria-current={here("reflection", reflection)}
          className={half}
        >
          Reflection
        </Link>
      ) : (
        <a
          href={away}
          aria-label="Reflection (opens on another instance)"
          aria-current={current === "reflection" ? "true" : undefined}
          className={half}
        >
          Reflection
          <ExternalLink aria-hidden="true" size={12} strokeWidth={1.75} />
        </a>
      )}
      <Link
        to={engrams}
        aria-current={here("engrams", engrams, opened)}
        className={half}
      >
        Engrams
      </Link>
    </nav>
  );
}
