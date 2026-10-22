/**
 * What the reflect and evolve loops did on a domain: when each last ran, what
 * it left for a person and whether the trigger webhook works.
 *
 * The server decides what a caller sees. A refusal or a missing domain only
 * means there is nothing to show, so {@link automationQuery} never retries and
 * the screens draw nothing when there is no answer. A run carries counts and
 * a short summary, never the items it left.
 */

import { queryOptions, useQuery } from "@tanstack/react-query";

import { api, encodeSegment } from "./client";
import type { AutomationResponse, LoopDelivery, LoopRun } from "./model";

export type {
  AutomationResponse,
  LoopDelivery,
  LoopRun,
  LoopState,
} from "./model";

/** The cache key of one domain's automation state. */
export function automationKey(domain: string) {
  return ["automation", domain] as const;
}

/** Both loops on `domain`, as this caller may see them. */
export async function fetchAutomation(
  domain: string,
): Promise<AutomationResponse> {
  return api<AutomationResponse>(
    `/domains/${encodeSegment(domain)}/automation`,
  );
}

/** The read, shared by the screens that show it. */
export function automationQuery(domain: string, enabled = true) {
  return queryOptions({
    queryKey: automationKey(domain),
    queryFn: () => fetchAutomation(domain),
    retry: false,
    enabled,
  });
}

/** The automation state of `domain`; `data` is undefined when there is none to show. */
export function useAutomation(domain: string, enabled = true) {
  return useQuery(automationQuery(domain, enabled));
}

/** How a run's outcome reads after the runner's name. */
const OUTCOME_WORDS: Record<string, string> = {
  done: "done",
  stopped_at_cap: "stopped at its cap",
  failed: "failed",
  nothing_due: "nothing was due",
  expired: "the runner stopped",
};

/**
 * One sentence for the last run: "Last reflected 2 hours ago by n8n: done."
 * `verb` is "reflected" or "maintained". `ago` is the relative time, already
 * worded by the caller's clock.
 */
export function lastRunSentence(
  verb: string,
  run: LoopRun,
  ago: string | null,
): string {
  const when = ago === null ? "" : ` ${ago}`;
  const outcome = OUTCOME_WORDS[run.outcome] ?? run.outcome;
  return `Last ${verb}${when} by ${run.runner}: ${outcome}.`;
}

/**
 * What the policies card says under a trigger row, or null when the loop's
 * webhook trigger is off (the server sends no delivery then). A recorded
 * error always shows, whether or not the instance counts as configured.
 */
export function deliverySentence(
  delivery: LoopDelivery | null | undefined,
  sentAgo: string | null,
): string | null {
  if (delivery === null || delivery === undefined) {
    return null;
  }
  if (delivery.last_error != null && delivery.last_error !== "") {
    return `Last delivery failed: ${delivery.last_error.replace(/\.+$/, "")}.`;
  }
  if (delivery.last_sent != null) {
    return sentAgo === null ? "Last sent." : `Last sent ${sentAgo}.`;
  }
  if (!delivery.configured) {
    return "No webhook URL is set on this instance.";
  }
  return "Nothing has been sent yet.";
}
