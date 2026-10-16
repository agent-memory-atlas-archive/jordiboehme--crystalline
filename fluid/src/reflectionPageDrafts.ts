/**
 * What happens to a page's browser-held drafts when the page is deleted or
 * moved. The editor keeps two per page (`reflection:<path>` for the live
 * copy, `reflection-offer:<path>` for text set aside); both are keyed by the
 * path, so a move would otherwise strand them and a delete would offer a
 * dead page's text back to a page created later on the same path.
 *
 * The cleanup rule. A page's drafts live as long as the page does:
 *
 * - Deleted through this tab: both drafts go at once (`discardPageDrafts`).
 * - Moved through this tab, or followed with "Open it there": both drafts go
 *   with the page to its new path (`movePageDrafts`).
 * - Deleted or moved anywhere else (another tab, another person, the files
 *   on disk): this tab cannot hear of it, and a tab that still had the
 *   editor open may write its copy after the delete. So the server's answer
 *   decides. Opening the page and getting a 404 drops both drafts at its
 *   path; drafts at the old path of a page moved elsewhere go the same way,
 *   unless "Open it there" carried them first.
 *
 * Only a 404 that means "gone" counts, and the server also answers 404 for
 * a page this reader may not see. So the drafts go only when the 404 came
 * with the server's own problem body (not from a proxy or a static file
 * server) and the domain's Reflection, asked afresh, still answers this
 * reader with a right to read it. A refusal (401, 403), a failed
 * connection, a bare 404 or a Reflection that no longer answers them says
 * nothing about the page, and its drafts stay. That is also why the editor
 * of a page deleted or moved out of reach asks the person to copy their
 * text rather than promising a draft: the draft lasts only until the next
 * 404 on that path.
 */

import {
  reflectionOfferKey,
  reflectionRoomKey,
} from "./collab/reflectionDraftKeys";
import { clearDraft, moveDraft } from "./editor/drafts";

const KEYS = [reflectionRoomKey, reflectionOfferKey];

/** Drop both drafts of a deleted page. */
export function discardPageDrafts(
  account: string,
  domain: string,
  path: string,
): void {
  for (const keyOf of KEYS) {
    clearDraft(account, domain, keyOf(path));
  }
}

/**
 * Carry both drafts to the new path of a moved page, in `toDomain` when the
 * page left its domain (a rename of the domain). Unsaved text is never
 * dropped: a draft already sitting at the new path stays as it is and the old
 * one stays where it was.
 */
export function movePageDrafts(
  account: string,
  domain: string,
  from: string,
  to: string,
  toDomain: string = domain,
): void {
  for (const keyOf of KEYS) {
    moveDraft(
      account,
      { domain, slot: keyOf(from) },
      { domain: toDomain, slot: keyOf(to) },
    );
  }
}
