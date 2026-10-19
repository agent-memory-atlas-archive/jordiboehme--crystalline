/**
 * The insert registry: every entry inserts exactly its snippet in one
 * transaction and lands the caret on the word worth replacing.
 *
 * The menus that show these entries are tested beside them
 * (`InsertMenu.test.tsx`, `slashMenu.test.ts`); here each action runs on a
 * plain view, with no React and no popup in sight.
 */

import { undo, history } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test } from "vitest";

import { hiddenIdLines } from "./hiddenIdLines";
import { INSERT_ACTIONS } from "./inserts";
import type { InsertAction } from "./inserts";
import { MERMAID_STARTER_GROUPS, mermaidFence } from "./mermaidStarters";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function open(
  doc: string,
  anchor: number,
  head = anchor,
  extensions: Extension[] = [],
): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [EditorState.lineSeparator.of("\n"), ...extensions],
    }),
    parent: document.body,
  });
  return view;
}

function action(id: string): InsertAction {
  const found = INSERT_ACTIONS.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no insert action ${id}`);
  }
  return found;
}

function selected(v: EditorView): string {
  const { from, to } = v.state.selection.main;
  return v.state.sliceDoc(from, to);
}

/** What each entry writes into an empty buffer, and what it selects. */
const EXPECTED: { id: string; doc: string; select: string }[] = [
  { id: "callout-note", doc: "> [!NOTE]\n> Text\n", select: "Text" },
  { id: "callout-tip", doc: "> [!TIP]\n> Text\n", select: "Text" },
  {
    id: "callout-important",
    doc: "> [!IMPORTANT]\n> Text\n",
    select: "Text",
  },
  { id: "callout-warning", doc: "> [!WARNING]\n> Text\n", select: "Text" },
  { id: "callout-caution", doc: "> [!CAUTION]\n> Text\n", select: "Text" },
  { id: "expand", doc: "> [!DETAILS]- Title\n> Text\n", select: "Title" },
  { id: "status", doc: ":status[Status]{grey}", select: "Status" },
  {
    id: "table",
    doc: "| Column | Column |\n| --- | --- |\n|  |  |\n",
    select: "Column",
  },
  ...MERMAID_STARTER_GROUPS.flatMap((group) =>
    group.starters.map((starter) => {
      const { lines, select } = mermaidFence(starter);
      const line = lines[select?.line ?? 0] ?? "";
      return {
        id: `diagram-${starter.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        doc: `${lines.join("\n")}\n`,
        select: select === null ? "" : line.slice(select.from, select.to),
      };
    }),
  ),
  { id: "code", doc: "```\n\n```\n", select: "" },
  { id: "math-inline", doc: "$`x`$", select: "x" },
  { id: "math-block", doc: "$$\nx\n$$\n", select: "x" },
  { id: "footnote", doc: "[^1]\n\n[^1]: Note", select: "Note" },
  { id: "task", doc: "- [ ] ", select: "" },
];

describe("the insert registry", () => {
  test("names every element once, in the menu's order", () => {
    expect(INSERT_ACTIONS.map((entry) => entry.id)).toEqual(
      EXPECTED.map((entry) => entry.id),
    );
    expect(new Set(INSERT_ACTIONS.map((entry) => entry.id)).size).toBe(
      INSERT_ACTIONS.length,
    );
    expect(
      INSERT_ACTIONS.filter((entry) => entry.group === "Callout").map(
        (entry) => entry.label,
      ),
    ).toEqual(["Note", "Tip", "Important", "Warning", "Caution"]);
  });

  test.each(EXPECTED)(
    "$id inserts its snippet and selects its token",
    ({ id, doc, select }) => {
      let edits = 0;
      const v = open("", 0, 0, [
        EditorView.updateListener.of((update) => {
          if (update.docChanged) edits += 1;
        }),
      ]);
      expect(action(id).run(v)).toBe(true);
      expect(v.state.doc.toString()).toBe(doc);
      expect(selected(v)).toBe(select);
      expect(edits).toBe(1);
    },
  );

  test("a code block leaves the caret in the fence's language slot", () => {
    const v = open("", 0);
    action("code").run(v);
    expect(v.state.selection.main.head).toBe(3);
  });

  test("a status label takes the selected words as its text", () => {
    const v = open("ship it now", 5, 7);
    action("status").run(v);
    expect(v.state.doc.toString()).toBe("ship :status[it]{grey} now");
    expect(selected(v)).toBe("it");
  });

  test("a status label goes in at the caret, not on a line of its own", () => {
    const v = open("Build is ", 9);
    action("status").run(v);
    expect(v.state.doc.toString()).toBe("Build is :status[Status]{grey}");
  });

  test("a footnote takes the next free number and puts its note at the end", () => {
    const doc = "One[^1] and two[^3].\n\nMore text.\n\n[^1]: A\n[^3]: B\n";
    const v = open(doc, "One[^1] and two[^3].".length);
    action("footnote").run(v);
    expect(v.state.doc.toString()).toBe(
      "One[^1] and two[^3].[^4]\n\nMore text.\n\n[^1]: A\n[^3]: B\n\n[^4]: Note\n",
    );
    expect(selected(v)).toBe("Note");
  });

  test("a footnote and its note are one undo step", () => {
    const v = open("Text.\n", 5, 5, [history()]);
    action("footnote").run(v);
    undo(v);
    expect(v.state.doc.toString()).toBe("Text.\n");
  });

  test("a replaced range goes in the same transaction as the insert", () => {
    let edits = 0;
    const v = open("/war", 4, 4, [
      history(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) edits += 1;
      }),
    ]);
    action("callout-warning").run(v, { from: 0, to: 4 });
    expect(v.state.doc.toString()).toBe("> [!WARNING]\n> Text\n");
    expect(selected(v)).toBe("Text");
    expect(edits).toBe(1);
    undo(v);
    expect(v.state.doc.toString()).toBe("/war");
  });

  test.each([
    ["status", "Build :status[Status]{grey}", "Status"],
    ["math-inline", "Build $`x`$", "x"],
    ["task", "- [ ] Build ", ""],
  ])("%s replaces the range it is given", (id, doc, select) => {
    const v = open("Build /st", 9);
    action(id).run(v, { from: 6, to: 9 });
    expect(v.state.doc.toString()).toBe(doc);
    expect(selected(v)).toBe(select);
  });
});

describe("on a Reflection page", () => {
  const PAGE =
    "## One\n<!-- r:aaaa1111 -->\n\nFirst.\n\n## Two\n<!-- r:bbbb2222 -->\nSecond.\n";
  const HEADING_END = "## One".length;
  const ID_START = "## One\n".length;
  const ID_END = "## One\n<!-- r:aaaa1111 -->".length;

  function page(pos: number): EditorView {
    return open(PAGE, pos, pos, [hiddenIdLines()]);
  }

  /** The id lines still stand alone right below their headings. */
  function idsIntact(v: EditorView): void {
    const lines = v.state.doc.toString().split("\n");
    const one = lines.findIndex((line) => line.startsWith("## One"));
    const two = lines.indexOf("## Two");
    expect(lines[one + 1]).toBe("<!-- r:aaaa1111 -->");
    expect(lines[two + 1]).toBe("<!-- r:bbbb2222 -->");
  }

  test.each(INSERT_ACTIONS.map((entry) => entry.id))(
    "%s from a heading's end leaves the id line where it is",
    (id) => {
      const v = page(HEADING_END);
      action(id).run(v);
      idsIntact(v);
    },
  );

  test.each(
    INSERT_ACTIONS.flatMap((entry) => [
      [entry.id, ID_START],
      [entry.id, ID_END],
    ]),
  )("%s from a caret on the id line (at %i) leaves the id alone", (id, at) => {
    const v = page(at);
    action(id).run(v);
    idsIntact(v);
  });

  test("a footnote's note goes to the end of the caret's section", () => {
    const v = page(PAGE.indexOf("First.") + "First.".length);
    action("footnote").run(v);
    expect(v.state.doc.toString()).toBe(
      "## One\n<!-- r:aaaa1111 -->\n\nFirst.[^1]\n\n[^1]: Note\n\n## Two\n<!-- r:bbbb2222 -->\nSecond.\n",
    );
    expect(selected(v)).toBe("Note");
  });

  test("a footnote in the last section goes to the end of the page", () => {
    const v = page(PAGE.indexOf("Second.") + "Second.".length);
    action("footnote").run(v);
    expect(v.state.doc.toString()).toBe(
      "## One\n<!-- r:aaaa1111 -->\n\nFirst.\n\n## Two\n<!-- r:bbbb2222 -->\nSecond.[^1]\n\n[^1]: Note\n",
    );
  });
});
