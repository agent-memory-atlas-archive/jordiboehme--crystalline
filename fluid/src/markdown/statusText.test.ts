import { describe, expect, it } from "vitest";
import { labelPlainWords, statusLabelWords, statusPieces } from "./statusText";

describe("statusLabelWords", () => {
  it("keeps a label's words and drops its syntax", () => {
    expect(statusLabelWords("Login :status[In review]{blue}")).toBe(
      "Login In review",
    );
    expect(statusLabelWords(":status[Done] and :status[a [b] c]{red}")).toBe(
      "Done and a [b] c",
    );
  });
  it("leaves an unclosed label and ordinary colons as written", () => {
    expect(statusLabelWords("At 10:30 :status[open")).toBe(
      "At 10:30 :status[open",
    );
  });
});

describe("labelPlainWords", () => {
  it("reads a label's inline Markdown as plain words", () => {
    expect(labelPlainWords("**Done** in `v2` [see](https://x.test) \\*")).toBe(
      "Done in v2 see *",
    );
  });
});

describe("statusPieces", () => {
  it("cuts text into words and labels", () => {
    expect(statusPieces("a :status[B]{red} c :status[D] :status[")).toEqual([
      { text: "a " },
      { label: "B", braces: "red" },
      { text: " c " },
      { label: "D", braces: null },
      { text: " :status[" },
    ]);
  });
});
