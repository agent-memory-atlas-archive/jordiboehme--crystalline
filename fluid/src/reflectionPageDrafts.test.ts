import { beforeEach, describe, expect, it } from "vitest";

import {
  reflectionOfferKey,
  reflectionRoomKey,
} from "./collab/reflectionDraftKeys";
import { addOffer, readDraft, readOffers, writeDraft } from "./editor/drafts";
import { movePageDrafts } from "./reflectionPageDrafts";

const at = (hour: string, content: string) => ({
  content,
  baseChecksum: "",
  savedAt: `2026-10-16T${hour}:00:00Z`,
});

describe("a moved page's drafts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("go with the page to a path that holds none", () => {
    writeDraft("ann", "eng", reflectionRoomKey("a.md"), at("08", "copy\n"));
    addOffer("ann", "eng", reflectionOfferKey("a.md"), at("07", "offer\n"));
    movePageDrafts("ann", "eng", "a.md", "b.md");
    expect(readDraft("ann", "eng", reflectionRoomKey("b.md"))?.content).toBe(
      "copy\n",
    );
    expect(readOffers("ann", "eng", reflectionOfferKey("b.md"))).toEqual([
      at("07", "offer\n"),
    ]);
    expect(readDraft("ann", "eng", reflectionRoomKey("a.md"))).toBeNull();
    expect(readOffers("ann", "eng", reflectionOfferKey("a.md"))).toEqual([]);
  });

  it("join the drafts already at the new path instead of staying at the dead one", () => {
    writeDraft("ann", "eng", reflectionRoomKey("a.md"), at("09", "old copy\n"));
    addOffer("ann", "eng", reflectionOfferKey("a.md"), at("06", "oldest\n"));
    addOffer("ann", "eng", reflectionOfferKey("a.md"), at("08", "old offer\n"));
    writeDraft("ann", "ops", reflectionRoomKey("b.md"), at("10", "new copy\n"));
    addOffer("ann", "ops", reflectionOfferKey("b.md"), at("07", "new offer\n"));
    movePageDrafts("ann", "eng", "a.md", "b.md", "ops");
    // The new path's own copy stays; everything else is offered there, the
    // newest three by time.
    expect(readDraft("ann", "ops", reflectionRoomKey("b.md"))?.content).toBe(
      "new copy\n",
    );
    expect(readOffers("ann", "ops", reflectionOfferKey("b.md"))).toEqual([
      at("09", "old copy\n"),
      at("08", "old offer\n"),
      at("07", "new offer\n"),
    ]);
    expect(readDraft("ann", "eng", reflectionRoomKey("a.md"))).toBeNull();
    expect(readOffers("ann", "eng", reflectionOfferKey("a.md"))).toEqual([]);
  });
});
