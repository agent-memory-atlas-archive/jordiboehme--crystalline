import { describe, expect, test } from "vitest";

// The shared corpus, as text, out of the very file the core's own test reads:
// `crates/core/tests/fixtures/conventional-comments.json`. `?raw` for the
// same reason as the asset corpus (see imageFormat.test.ts).
import corpusJson from "../../../crates/core/tests/fixtures/conventional-comments.json?raw";

import {
  LABELS,
  composeComment,
  formatHead,
  isBlocking,
  matchHead,
  parseConventional,
  parseHead,
  toggleDecoration,
} from "./conventionalComment";

interface Case {
  name: string;
  line: string;
  label: string | null;
  decorations?: string[];
  subject?: string;
  blocking?: boolean;
}

describe("parseConventional", () => {
  test("agrees with the shared corpus", () => {
    const cases = JSON.parse(corpusJson) as Case[];
    expect(cases.length).toBeGreaterThanOrEqual(30);
    for (const c of cases) {
      const parsed = parseConventional(c.line);
      if (c.label === null) {
        expect(parsed, c.name).toBeNull();
        continue;
      }
      expect(parsed, c.name).not.toBeNull();
      expect(parsed?.label, c.name).toBe(c.label);
      expect(parsed?.decorations, c.name).toEqual(c.decorations ?? []);
      expect(parsed?.subject, c.name).toBe(c.subject ?? "");
      expect(parsed && isBlocking(parsed), c.name).toBe(c.blocking ?? false);
    }
  });

  test("keeps the discussion after the first line", () => {
    expect(
      parseConventional("issue (blocking): moved\nSee the runbook.\nThanks.")
        ?.discussion,
    ).toBe("See the runbook.\nThanks.");
    expect(parseConventional("issue: moved")?.discussion).toBe("");
  });

  test("lists the nine labels of the standard", () => {
    expect(LABELS).toEqual([
      "praise",
      "nitpick",
      "suggestion",
      "issue",
      "todo",
      "question",
      "thought",
      "chore",
      "note",
    ]);
  });
});

describe("matchHead", () => {
  test("matches a whole head at the very start, before any subject", () => {
    expect(matchHead("issue (blocking): ")).toEqual({
      head: { label: "issue", decorations: ["blocking"] },
      end: 18,
    });
    expect(matchHead("note: x")?.end).toBe(6);
  });

  test("a head still being typed, or not at the start, is no head", () => {
    for (const text of [
      "issue (blocking):",
      "issue (blocking",
      "issue",
      " issue: ",
      "an issue: ",
      "bug: ",
      "issue (): ",
    ]) {
      expect(matchHead(text), text).toBeNull();
    }
  });
});

describe("composing", () => {
  test("a chip and its words read back as the same comment", () => {
    const head = { label: "question" as const, decorations: ["non-blocking"] };
    const text = composeComment(head, "  is this true?\nAfter the move.  ");
    expect(text).toBe(
      "question (non-blocking): is this true?\nAfter the move.",
    );
    expect(parseConventional(text)).toEqual({
      ...head,
      subject: "is this true?",
      discussion: "After the move.",
    });
  });

  test("no chip is the words alone", () => {
    expect(composeComment(null, " plain words ")).toBe("plain words");
  });

  test("a head is written and read back as the chip keeps it", () => {
    const head = {
      label: "issue" as const,
      decorations: ["security", "blocking"],
    };
    expect(formatHead(head)).toBe("issue (security, blocking)");
    expect(parseHead(formatHead(head))).toEqual(head);
    expect(formatHead({ label: "note", decorations: [] })).toBe("note");
    expect(parseHead("")).toBeNull();
    expect(parseHead("bug")).toBeNull();
  });
});

describe("toggleDecoration", () => {
  test("blocking and non-blocking exclude each other", () => {
    expect(toggleDecoration(["non-blocking"], "blocking")).toEqual([
      "blocking",
    ]);
    expect(toggleDecoration(["blocking", "if-minor"], "non-blocking")).toEqual([
      "if-minor",
      "non-blocking",
    ]);
  });

  test("if-minor goes with either, and a second press takes one off", () => {
    expect(toggleDecoration(["blocking"], "if-minor")).toEqual([
      "blocking",
      "if-minor",
    ]);
    expect(toggleDecoration(["blocking", "if-minor"], "if-minor")).toEqual([
      "blocking",
    ]);
  });

  test("a decoration written by hand stays", () => {
    expect(toggleDecoration(["security"], "blocking")).toEqual([
      "security",
      "blocking",
    ]);
  });
});
