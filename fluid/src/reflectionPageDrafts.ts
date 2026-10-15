/**
 * What happens to a page's browser-held drafts when the page is deleted or
 * moved. The editor keeps two per page (`reflection:<path>` for the live
 * copy, `reflection-offer:<path>` for text set aside); both are keyed by the
 * path, so a move would otherwise strand them and a delete would offer a
 * dead page's text back to a page created later on the same path.
 */

import {
  reflectionOfferKey,
  reflectionRoomKey,
} from "./collab/reflectionDraftKeys";
import { clearDraft, readDraft, writeDraft } from "./editor/drafts";

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
 * Carry both drafts to the new path of a moved page. Unsaved text is never
 * dropped: a draft already sitting at the new path stays as it is and the old
 * one stays where it was.
 */
export function movePageDrafts(
  account: string,
  domain: string,
  from: string,
  to: string,
): void {
  for (const keyOf of KEYS) {
    const draft = readDraft(account, domain, keyOf(from));
    if (draft === null || readDraft(account, domain, keyOf(to)) !== null) {
      continue;
    }
    writeDraft(account, domain, keyOf(to), draft);
    clearDraft(account, domain, keyOf(from));
  }
}
