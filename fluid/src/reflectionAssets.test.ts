/**
 * The Reflection's link rules, held to the core's: the corpus is the very
 * file `crates/core/tests/it/reflection_asset_corpus.rs` reads.
 */

import { describe, expect, test } from "vitest";

import corpusJson from "../../crates/core/tests/fixtures/reflection_asset_corpus.json?raw";

import {
  classifyReflectionTarget,
  engramAttachmentEmbeds,
  reflectionAssetRefs,
  reflectionTargetOf,
  relativeTo,
} from "./reflectionAssets";

interface Case {
  name: string;
  page: string;
  body: string;
  refs: string[];
  engram: string[];
}

describe("the shared corpus", () => {
  test("the reflection link rules agree with the shared corpus", () => {
    const cases = JSON.parse(corpusJson) as Case[];
    expect(cases.length).toBeGreaterThanOrEqual(16);
    for (const c of cases) {
      expect(reflectionAssetRefs(c.body, c.page), `${c.name} (refs)`).toEqual(
        c.refs,
      );
      expect(
        engramAttachmentEmbeds(c.body, c.page),
        `${c.name} (engram)`,
      ).toEqual(c.engram);
    }
  });
});

describe("classifyReflectionTarget", () => {
  test("one link, two places, two answers", () => {
    expect(classifyReflectionTarget("../assets/a.png", "a.md")).toEqual({
      kind: "engram",
    });
    expect(classifyReflectionTarget("../assets/a.png", "guides/a.md")).toEqual({
      kind: "reflection",
      path: "assets/a.png",
    });
    expect(classifyReflectionTarget("peer.md", "a.md")).toEqual({
      kind: "other",
    });
  });

  test("a target as written is decoded, un-dotted and cut at the fragment", () => {
    expect(
      reflectionTargetOf("./assets/gr%C3%B6%C3%9Fe.png#left", "a.md"),
    ).toEqual({ kind: "reflection", path: "assets/größe.png" });
    expect(reflectionTargetOf("", "a.md")).toEqual({ kind: "other" });
  });
});

describe("relativeTo", () => {
  test("relativeTo walks up from the page's folder", () => {
    expect(relativeTo("a.md", "assets/x.png")).toBe("assets/x.png");
    expect(relativeTo("guides/a.md", "assets/x.png")).toBe("../assets/x.png");
    expect(relativeTo("guides/deep/a.md", "assets/x.png")).toBe(
      "../../assets/x.png",
    );
    expect(relativeTo("guides/a.md", "guides/b.md")).toBe("b.md");
  });
});
