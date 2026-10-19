import { describe, expect, it } from "vitest";

import {
  distinctSources,
  hiddenSourcesText,
  unavailableSourcesText,
} from "./reflectionSources";

describe("the words for sources from other domains", () => {
  it("says a hidden count in plain words, one or many", () => {
    expect(hiddenSourcesText(1)).toBe("1 source in a domain you cannot open");
    expect(hiddenSourcesText(3)).toBe("3 sources in a domain you cannot open");
    expect(unavailableSourcesText(2, "ops")).toBe(
      "2 sources in ops cannot be checked here.",
    );
  });

  it("counts an engram of another domain apart from a local one of the same permalink", () => {
    const source = (permalink: string, domain: string | null) => ({
      permalink,
      title: permalink,
      state: "current" as const,
      domain,
    });
    expect(
      distinctSources([
        { sources: [source("team/x", null), source("team/x", "ops")] },
        { sources: [source("team/x", "ops")] },
        { sources: null },
      ]),
    ).toBe(2);
  });
});
