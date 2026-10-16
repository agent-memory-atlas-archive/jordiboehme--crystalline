/**
 * The room side of the kept text note's save marks: when a mark may be
 * taken, what a room from before marks gets instead, and a mark built
 * without `crypto.randomUUID`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { soloCollabSession } from "../test/harness";
import { newMark, roomSaveMarks } from "./saveMarks";
import type { CollabSession } from "./useCollabSession";

function room(over: Partial<CollabSession>): CollabSession {
  return { ...soloCollabSession(), mode: "collab", ...over };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("save marks in a room", () => {
  it("takes a mark only on a live room that answers marks", () => {
    const flush = vi.fn(() => true);
    expect(roomSaveMarks(room({ live: false, flush })).markSave()).toBeNull();
    expect(flush).not.toHaveBeenCalled();
    const marked = roomSaveMarks(
      room({ live: true, marksSupported: true, flush }),
    ).markSave();
    expect(marked?.auto).toBe(true);
    expect(flush).toHaveBeenCalledWith(marked?.mark);
  });

  it("keeps the offer when the marked flush is refused", () => {
    const flush = vi.fn(() => false);
    expect(
      roomSaveMarks(
        room({ live: true, marksSupported: true, flush }),
      ).markSave(),
    ).toBeNull();
  });

  it("counts receipts and never drops on its own in a room from before marks", () => {
    const flush = vi.fn(() => true);
    const marks = roomSaveMarks(
      room({ live: true, marksSupported: false, flush, receipts: 3 }),
    );
    expect(marks.markSave()).toEqual({ mark: 3, auto: false });
    expect(flush).toHaveBeenCalledWith();
    expect(marks.saveStatus(3)).toBe("waiting");
    expect(roomSaveMarks(room({ receipts: 4 })).saveStatus(3)).toBe("saved");
    expect(
      roomSaveMarks(room({ receipts: 3, closed: true })).saveStatus(3),
    ).toBe("lost");
  });

  it("reads a mark this tab no longer holds as lost", () => {
    expect(
      roomSaveMarks(room({ markStatus: () => "unknown" })).saveStatus("m1"),
    ).toBe("lost");
    expect(
      roomSaveMarks(room({ markStatus: () => "saved" })).saveStatus("m1"),
    ).toBe("saved");
  });

  it("builds a mark from random bytes when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(171),
    });
    expect(newMark()).toBe("ab".repeat(16));
  });

  it("uses randomUUID where the browser has it", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "uuid-1",
      getRandomValues: (bytes: Uint8Array) => bytes,
    });
    expect(newMark()).toBe("uuid-1");
  });
});
