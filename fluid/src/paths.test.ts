import { describe, expect, it } from "vitest";

import { isDomainManifestPath } from "./paths";

describe("isDomainManifestPath", () => {
  it("matches the root MANIFEST in any ASCII letter case", () => {
    expect(isDomainManifestPath("MANIFEST.md")).toBe(true);
    expect(isDomainManifestPath("manifest.MD")).toBe(true);
  });

  it("matches nothing else, as the server compares ASCII only", () => {
    expect(isDomainManifestPath("notes/manifest.md")).toBe(false);
    expect(isDomainManifestPath("manifest.md.bak")).toBe(false);
    expect(isDomainManifestPath("man\u0131fest.md")).toBe(false);
  });
});
