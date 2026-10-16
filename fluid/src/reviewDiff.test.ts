import { describe, expect, it } from "vitest";

import { collapseDiff, parseDiff } from "./reviewDiff";

describe("parseDiff", () => {
  it("drops file headers, hunk headers, the no-newline note and id lines", () => {
    const lines = parseDiff(
      "--- original\n+++ modified\n@@ -1,2 +1,2 @@\n-<!-- r:7f3a9c2e -->\n keep\n-old\n+new\n\\ No newline at end of file\n",
    );
    expect(lines).toEqual([
      { kind: "ctx", text: "keep" },
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
    ]);
  });

  it("keeps a removed line that starts with dashes once a hunk has begun", () => {
    const lines = parseDiff("@@ -1 +1 @@\n--- rule\n+++ rule\n");
    expect(lines.map((l) => l.kind)).toEqual(["del", "add"]);
  });

  it("puts a gap between two hunks", () => {
    const lines = parseDiff("@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d\n");
    expect(lines.map((l) => l.kind)).toEqual([
      "del",
      "add",
      "gap",
      "del",
      "add",
    ]);
  });
});

describe("collapseDiff", () => {
  it("keeps two lines around a change and reports what it hid", () => {
    const raw = ["@@ -1 +1 @@"];
    for (let i = 0; i < 10; i += 1) {
      raw.push(` c${String(i)}`);
    }
    raw.push("+added");
    for (let i = 10; i < 20; i += 1) {
      raw.push(` c${String(i)}`);
    }
    const out = collapseDiff(parseDiff(raw.join("\n")));
    expect(out.hidden).toBe(true);
    expect(out.lines.map((l) => l.text)).toEqual([
      "c8",
      "c9",
      "added",
      "c10",
      "c11",
    ]);
  });
});
