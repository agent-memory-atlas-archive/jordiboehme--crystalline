import { describe, expect, it } from "vitest";

import type { ThreadView } from "./api/reflection";
import { MARKER_CLASS, placeMarkers, printNotes } from "./printNotes";
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
  function paragraph(text: string): { root: HTMLElement; node: Text } {
    const root = document.createElement("p");
    const node = document.createTextNode(text);
    root.append(node);
    document.body.append(root);
    return { root, node };
  }

  it("sets a number at the end of each range and takes it out again", () => {
    const { root, node } = paragraph("Deploys run at night, after the batch.");
    const night = document.createRange();
    night.setStart(node, 12);
    night.setEnd(node, 20);
    const batch = document.createRange();
    batch.setStart(node, 22);
    batch.setEnd(node, 37);
    const undo = placeMarkers([
      { range: night, n: 1 },
      { range: batch, n: 2 },
    ]);
    const marks = [...root.querySelectorAll(`.${MARKER_CLASS}`)];
    expect(marks.map((mark) => mark.textContent)).toEqual(["1", "2"]);
    expect(marks[0]?.tagName).toBe("SUP");
    expect(marks[0]?.hasAttribute(SKIP_ATTR)).toBe(true);
    expect(root.textContent).toBe("Deploys run at night1, after the batch2.");

    undo();
    expect(root.querySelector(`.${MARKER_CLASS}`)).toBeNull();
    // One text node again, the same one, with its words.
    expect(root.childNodes).toHaveLength(1);
    expect(root.firstChild).toBe(node);
    expect(node.data).toBe("Deploys run at night, after the batch.");
    root.remove();
  });

  it("splits nothing for a range that ends at the end of its text", () => {
    const { root, node } = paragraph("Write one line.");
    const range = document.createRange();
    range.setStart(node, 6);
    range.setEnd(node, node.length);
    const undo = placeMarkers([{ range, n: 3 }]);
    expect(root.childNodes).toHaveLength(2);
    expect(root.textContent).toBe("Write one line.3");
    undo();
    expect(root.childNodes).toHaveLength(1);
    root.remove();
  });

  it("leaves new words in place when the text changed while printing", () => {
    const { root, node } = paragraph("Deploys run at night.");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 7);
    const undo = placeMarkers([{ range, n: 1 }]);
    // As React would: the node it holds gets the whole new text.
    node.data = "Deploys run in the day.";
    undo();
    expect(root.textContent).toBe("Deploys run in the day.");
    root.remove();
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

  it("lists an engram's facts in print order, leaving out what it lacks", () => {
    expect(
      engramFacts({
        status: "current",
        type: null,
        tags: ["deploy", "release"],
        recordedAt: "2026-09-12",
        content: "---\ntimestamp: 2026-10-14T21:10:00+00:00\n---\n",
      }).map((fact) => fact.label),
    ).toEqual(["Status", "Tags", "Updated", "Recorded"]);
  });
});
