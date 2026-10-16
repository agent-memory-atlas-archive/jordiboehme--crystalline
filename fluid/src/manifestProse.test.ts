import { describe, expect, it } from "vitest";

import type { ManifestSections } from "./api/domain";
import { configKeys, sectionKey, splitManifest } from "./manifestProse";

const SOURCE = [
  "---",
  "type: manifest",
  "title: MANIFEST",
  "---",
  "",
  "# Platform Team",
  "",
  "What the platform team knows",
  "about production.",
  "",
  "A second paragraph.",
  "",
  "## Scope",
  "",
  "- Deploys",
  "",
  "### Deeper",
  "",
  "Still in Scope.",
  "",
  "## When to Use",
  "",
  "- Before a deploy",
  "",
  "## Notes for Agents",
  "",
  "```md",
  "## Tag Aliases",
  "- not a section",
  "```",
  "",
  "## Provisioning",
  "",
  "- skills: skills",
  "",
  "##   tag   ALIASES  ",
  "",
  "- k8s -> kubernetes",
].join("\n");

function sections(starters: string[]): ManifestSections {
  return {
    scope: [],
    whenToUse: [],
    routing: "when_to_use",
    missing: [],
    provisioning: null,
    tagAliases: null,
    policies: [],
    starters: starters.map((section) => ({
      section,
      meaning: "",
      example: "",
    })),
    starterDocument: "",
  };
}

describe("splitManifest", () => {
  const keys = configKeys(
    sections(["When to Use", "Scope", "Provisioning", "Tag Aliases"]),
  );
  const prose = splitManifest(SOURCE, keys);

  it("takes the H1 as the eyebrow and the first paragraph as the lead", () => {
    expect(prose.eyebrow).toBe("Platform Team");
    expect(prose.lead).toBe("What the platform team knows\nabout production.");
    expect(prose.intro).toBe("A second paragraph.");
  });

  it("keeps the prose sections in file order, deeper headings inside", () => {
    expect(prose.sections.map((s) => s.heading)).toEqual([
      "Scope",
      "When to Use",
      "Notes for Agents",
    ]);
    expect(prose.sections[0]?.body).toContain("### Deeper");
    expect(prose.sections[0]?.body).toContain("Still in Scope.");
  });

  it("never reads a heading inside a fence", () => {
    expect(prose.sections[2]?.body).toContain("## Tag Aliases");
  });

  it("cuts the configuration sections, matched the way the parser folds", () => {
    expect(prose.config.map((s) => s.key)).toEqual([
      "provisioning",
      "tag aliases",
    ]);
    expect(prose.config[1]?.body).toBe("- k8s -> kubernetes");
  });

  it("has no lead when the body opens with a list", () => {
    const split = splitManifest("# T\n\n- a\n- b\n", keys);
    expect(split.lead).toBeNull();
    expect(split.intro).toBe("- a\n- b");
  });
});

describe("configKeys", () => {
  it("treats every registered section but the two routing ones as configuration", () => {
    expect([
      ...configKeys(
        sections(["When to Use", "Scope", "Provisioning", "Future Thing"]),
      ),
    ]).toEqual(["provisioning", "future thing"]);
  });

  it("falls back to the two parsed sections for a daemon that sends no registry", () => {
    expect([...configKeys(sections([]))]).toEqual([
      "provisioning",
      "tag aliases",
    ]);
  });

  it("cuts nothing for a server that sent no sections", () => {
    expect(configKeys(null).size).toBe(0);
  });

  it("folds whitespace and case", () => {
    expect(sectionKey("  Tag \t Aliases ")).toBe("tag aliases");
  });
});
