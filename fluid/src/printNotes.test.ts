import { describe, expect, it } from "vitest";

import type { ThreadView } from "./api/reflection";
import {
  MARKER_CLASS,
  onlyMarkers,
  placeMarkers,
  printNotes,
} from "./printNotes";
import { PRINT_URL_MAX, printUrl } from "./printUrl";
import { cssString, engramFacts, lastWrite } from "./printSheet";
import { SKIP_ATTR } from "./reflectionQuotes";
import type { SectionText } from "./reflectionText";

const SECTIONS: SectionText[] = [
  { id: "_top", heading: "", text: "# Deploying\n\nRead this first." },
  {
    id: "a1",
    heading: "When",
    text: "## When\n\nDeploys run at night, after the batch.",
  },
  { id: "b2", heading: "After", text: "## After\n\nWrite one line." },
];

function thread(
  id: string,
  section: string,
  quote: string | null,
  extra: Partial<ThreadView> = {},
): ThreadView {
  return {
    id,
    path: "guides/deploying.md",
    anchor: { section, quote, occurrence: 1, state: "found" },
    status: "open",
    waitingOn: "people",
    openedAt: "2026-10-01T10:00:00Z",
    ageSecs: 60,
    entries: [
      {
        at: "2026-10-01T10:00:00Z",
        kind: "comment",
        author: { name: "ana", agent: false },
        text: `About ${id}`,
      },
    ],
    ...extra,
  };
}

describe("printNotes", () => {
  it("numbers the open threads in reading order and leaves resolved ones out", () => {
    const notes = printNotes(
      [
        thread("t-after", "b2", "one line"),
        thread("t-batch", "a1", "after the batch"),
        thread("t-done", "a1", "Deploys", { status: "resolved" }),
        thread("t-night", "a1", "at night"),
        thread("t-intro", "_top", "Read this"),
        thread("t-whole", "a1", null),
      ],
      SECTIONS,
    );
    expect(notes.map((note) => [note.n, note.thread.id])).toEqual([
      [1, "t-intro"],
      // A thread on the whole section comes before the quotes in it.
      [2, "t-whole"],
      [3, "t-night"],
      [4, "t-batch"],
      [5, "t-after"],
    ]);
    expect(notes[0]?.heading).toBeNull();
    expect(notes[2]?.heading).toBe("When");
    expect(notes[1]?.quote).toBeNull();
  });

  it("puts a thread whose words changed last in its section, and a gone section last of all", () => {
    const notes = printNotes(
      [
        thread("t-gone", "zz", "old words"),
        thread("t-changed", "a1", "no longer here"),
        thread("t-after", "b2", "one line"),
        thread("t-night", "a1", "at night"),
      ],
      SECTIONS,
    );
    expect(notes.map((note) => [note.thread.id, note.state])).toEqual([
      ["t-night", "found"],
      ["t-changed", "text_changed"],
      ["t-after", "found"],
      ["t-gone", "section_gone"],
    ]);
    // A quote that is not found shows as stored.
    expect(notes[1]?.quote).toBe("no longer here");
  });

  it("shows a quote cleaned of markup it cut", () => {
    const sections: SectionText[] = [
      {
        id: "a1",
        heading: "When",
        text: "## When\n\nDeploys run **at** night.",
      },
    ];
    const [note] = printNotes([thread("t-1", "a1", "at** night")], sections);
    expect(note?.quote).toBe("at night");
  });
});

describe("placeMarkers", () => {
  it("sets each number at the end of the block that holds its range's end, in order", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<p><span>Deploys run at night</span>, <em>after</em> the batch.</p><ul><li>Write one line.</li></ul>";
    document.body.append(root);
    const [first, second] = [...root.querySelectorAll("p, li")];
    const night = root.querySelector("span")?.firstChild as Text;
    const after = root.querySelector("em")?.firstChild as Text;
    const line = root.querySelector("li")?.firstChild as Text;
    const range = (node: Text, from: number, to: number) => {
      const made = document.createRange();
      made.setStart(node, from);
      made.setEnd(node, to);
      return made;
    };
    const ranges = [
      range(after, 0, 5),
      range(night, 12, 20),
      range(line, 0, 5),
    ];
    const selection = range(night, 3, 14);
    const before = [...ranges, selection].map((r) => [
      r.startContainer,
      r.startOffset,
      r.endContainer,
      r.endOffset,
      r.toString(),
    ]);
    const childCount = first?.childNodes.length;

    const undo = placeMarkers([
      { range: ranges[0] as Range, n: 2 },
      { range: ranges[1] as Range, n: 1 },
      { range: ranges[2] as Range, n: 3 },
    ]);
    expect(first?.textContent).toBe("Deploys run at night, after the batch.12");
    expect(second?.textContent).toBe("Write one line.3");
    const mark = first?.lastElementChild;
    expect(mark?.tagName).toBe("SUP");
    expect(mark?.className).toBe(MARKER_CLASS);
    expect(mark?.hasAttribute(SKIP_ATTR)).toBe(true);
    // No text node was cut.
    expect(night.data).toBe("Deploys run at night");

    undo();
    expect(root.querySelector(`.${MARKER_CLASS}`)).toBeNull();
    expect(first?.childNodes.length).toBe(childCount);
    // Every live range kept its boundaries and its words.
    expect(
      [...ranges, selection].map((r) => [
        r.startContainer,
        r.startOffset,
        r.endContainer,
        r.endOffset,
        r.toString(),
      ]),
    ).toEqual(before);
    root.remove();
  });

  it("tells a change of numbers alone from a change of the page", () => {
    const mark = document.createElement("sup");
    mark.className = MARKER_CLASS;
    const other = document.createElement("span");
    const record = (node: Node) =>
      ({
        type: "childList",
        addedNodes: [node],
        removedNodes: [],
      }) as unknown as MutationRecord;
    expect(onlyMarkers([record(mark)])).toBe(true);
    expect(onlyMarkers([record(mark), record(other)])).toBe(false);
  });
});

describe("printUrl", () => {
  it("prints a web address without its scheme, a mail address without mailto:", () => {
    expect(printUrl("https://example.com/a/", "the docs")).toBe(
      "example.com/a",
    );
    expect(printUrl("mailto:ops@example.com", "write to us")).toBe(
      "ops@example.com",
    );
  });

  it("prints nothing when the words are the address, or for other links", () => {
    expect(printUrl("https://example.com", "https://example.com/")).toBeNull();
    expect(printUrl("mailto:ops@example.com", "ops@example.com")).toBeNull();
    expect(printUrl("#heading", "see below")).toBeNull();
    expect(printUrl("../other", "the other page")).toBeNull();
  });

  it("cuts a long address with an ellipsis", () => {
    const long = `https://example.com/${"a".repeat(200)}`;
    const shown = printUrl(long, "a long one");
    expect(shown).toHaveLength(PRINT_URL_MAX);
    expect(shown?.endsWith("\u2026")).toBe(true);
  });
});

describe("the printed page's words", () => {
  it("escapes a CSS string", () => {
    expect(cssString('A "quoted" \\ title\nline')).toBe(
      '"A \\"quoted\\" \\\\ title line"',
    );
  });

  it("reads the last write from generated, then from the old timestamp", () => {
    expect(
      lastWrite(
        "---\ntitle: X\ngenerated:\n  by: agent:a\n  timestamp: 2026-10-14T21:10:00+00:00\n---\nbody",
      ),
    ).toBe("2026-10-14T21:10:00+00:00");
    expect(
      lastWrite("---\ntitle: X\ntimestamp: '2026-09-01T08:00:00Z'\n---\n"),
    ).toBe("2026-09-01T08:00:00Z");
    expect(lastWrite("---\ntitle: X\n---\nbody")).toBeNull();
    expect(lastWrite("no frontmatter")).toBeNull();
  });

  it("lists an engram's facts dates first, leaving out what it lacks", () => {
    const labels = (facts: { label: string }[]) =>
      facts.map((fact) => fact.label);
    expect(
      labels(
        engramFacts({
          status: "current",
          type: "decision",
          tags: ["deploy", "release"],
          recordedAt: "2026-09-12",
          content: "---\ntimestamp: 2026-10-14T21:10:00+00:00\n---\n",
        }),
      ),
    ).toEqual(["Recorded", "Updated", "Status", "Type", "Tags"]);
    expect(
      labels(
        engramFacts({
          status: "current",
          type: null,
          tags: ["deploy"],
          recordedAt: null,
          content: "---\ntimestamp: 2026-10-14T21:10:00+00:00\n---\n",
        }),
      ),
    ).toEqual(["Updated", "Status", "Tags"]);
  });
});
