import { beforeEach, describe, expect, it } from "vitest";

import {
  addOffer,
  clearDraft,
  draftKey,
  moveDraft,
  OFFER_LIMIT,
  readDraft,
  readOffers,
  removeOffers,
  writeDraft,
} from "./drafts";

describe("draft snapshots", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keys per user and per engram", () => {
    expect(draftKey("ada", "eng", "notes/alpha")).toBe(
      "fluid.draft.ada.eng/notes/alpha",
    );
    expect(draftKey("bob", "eng", "notes/alpha")).not.toBe(
      draftKey("ada", "eng", "notes/alpha"),
    );
  });

  it("round-trips, clears, and answers null for the never-written", () => {
    expect(readDraft("ada", "eng", "alpha")).toBeNull();
    const draft = {
      content: "text",
      baseChecksum: "abc",
      savedAt: "2026-08-09T10:00:00Z",
    };
    writeDraft("ada", "eng", "alpha", draft);
    expect(readDraft("ada", "eng", "alpha")).toEqual(draft);
    clearDraft("ada", "eng", "alpha");
    expect(readDraft("ada", "eng", "alpha")).toBeNull();
  });

  it("treats an unreadable stored value as no draft", () => {
    localStorage.setItem(draftKey("ada", "eng", "alpha"), "{not json");
    expect(readDraft("ada", "eng", "alpha")).toBeNull();
  });

  describe("the offer history", () => {
    const at = (n: number) => ({
      content: `text ${String(n)}`,
      baseChecksum: "",
      savedAt: `2026-10-16T0${String(n)}:00:00Z`,
    });

    it("keeps the last few, newest first, each text once", () => {
      for (const n of [1, 2, 3, 4]) {
        addOffer("ada", "eng", "offer", at(n));
      }
      expect(readOffers("ada", "eng", "offer")).toEqual([at(4), at(3), at(2)]);
      expect(OFFER_LIMIT).toBe(3);
      // The same text again takes its old place rather than standing twice.
      addOffer("ada", "eng", "offer", { ...at(2), savedAt: at(9).savedAt });
      expect(
        readOffers("ada", "eng", "offer").map((offer) => offer.savedAt),
      ).toEqual([at(9).savedAt, at(4).savedAt, at(3).savedAt]);
      // A reader of one draft still finds the newest text.
      expect(readDraft("ada", "eng", "offer")?.content).toBe("text 2");
    });

    it("reads newest first by when each was saved, whatever order two tabs added them in", () => {
      addOffer("ada", "eng", "offer", at(3));
      // Another tab, slower to write, adds an older text after it.
      addOffer("ada", "eng", "offer", at(1));
      addOffer("ada", "eng", "offer", { ...at(2), savedAt: "" });
      expect(readOffers("ada", "eng", "offer")).toEqual([
        at(3),
        at(1),
        { ...at(2), savedAt: "" },
      ]);
    });

    it("reads a slot written as one draft as a history of one", () => {
      writeDraft("ada", "eng", "offer", at(1));
      expect(readOffers("ada", "eng", "offer")).toEqual([at(1)]);
    });

    it("drops only the offers named, and clears the slot when none is left", () => {
      addOffer("ada", "eng", "offer", at(1));
      addOffer("ada", "eng", "offer", at(2));
      removeOffers("ada", "eng", "offer", [at(2)]);
      expect(readOffers("ada", "eng", "offer")).toEqual([at(1)]);
      removeOffers("ada", "eng", "offer", [at(1)]);
      expect(localStorage.getItem(draftKey("ada", "eng", "offer"))).toBeNull();
    });

    it("moves a whole history with its page", () => {
      addOffer("ada", "eng", "offer", at(1));
      addOffer("ada", "eng", "offer", at(2));
      moveDraft(
        "ada",
        { domain: "eng", slot: "offer" },
        { domain: "ops", slot: "offer" },
      );
      expect(readOffers("ada", "eng", "offer")).toEqual([]);
      expect(readOffers("ada", "ops", "offer")).toEqual([at(2), at(1)]);
    });
  });
});
