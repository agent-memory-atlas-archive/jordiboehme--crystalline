import { describe, expect, it } from "vitest";
import { parseCalloutHead } from "./callouts";

describe("parseCalloutHead", () => {
  it("reads kind, fold and title", () => {
    expect(parseCalloutHead("[!NOTE]")).toEqual({
      kind: "note",
      fold: null,
      title: null,
    });
    expect(parseCalloutHead("[!warning]- Data loss")).toEqual({
      kind: "warning",
      fold: "closed",
      title: "Data loss",
    });
    expect(parseCalloutHead("[!Details]+ More")).toEqual({
      kind: "details",
      fold: "open",
      title: "More",
    });
  });
  it("refuses what is not a callout head", () => {
    for (const line of ["[!DANGER] Hot", "see [!NOTE]", "[!NOTE", "[NOTE]"]) {
      expect(parseCalloutHead(line)).toBeNull();
    }
  });
  it("reads the head the way the core lint does", () => {
    // Leading space is passed over, a title may follow the marker directly,
    // and a title of nothing but spaces is no title.
    expect(parseCalloutHead("  [!TIP]Short")).toEqual({
      kind: "tip",
      fold: null,
      title: "Short",
    });
    expect(parseCalloutHead("[!caution]   ")).toEqual({
      kind: "caution",
      fold: null,
      title: null,
    });
    expect(parseCalloutHead("[!]")).toBeNull();
    expect(parseCalloutHead("[!NO TE]")).toBeNull();
  });
});
