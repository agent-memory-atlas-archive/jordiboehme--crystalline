import {
  defaultKeymap,
  cursorCharLeft,
  cursorCharRight,
  deleteCharBackward,
  deleteCharForward,
  deleteLine,
  history,
  insertNewlineAndIndent,
  redo,
  selectLine,
  undo,
} from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { normalizePastedEndings } from "../collab/pastedEndings";
import { hiddenIdLines, isIdLineAt, joinSections } from "./hiddenIdLines";
import { insertBlock } from "./toolbar";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(doc: string, extra: Extension[] = []): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.lineSeparator.of("\n"),
        ...extra,
        hiddenIdLines(),
      ],
    }),
    parent: document.body,
  });
  return view;
}

describe("hiddenIdLines", () => {
  it("never shows a section id line, before or after an edit", () => {
    const v = mount(
      "## Night deploys\n<!-- r:7f3a9c2e -->\n\nDeploys run at night.\n",
    );
    expect(v.contentDOM.textContent).not.toContain("r:7f3a9c2e");
    expect(v.contentDOM.textContent).toContain("Deploys run at night.");
    v.dispatch({
      changes: {
        from: v.state.doc.length,
        insert: "\n## Next\n<!-- r:0b1c2d3e -->\n",
      },
    });
    expect(v.contentDOM.textContent).not.toContain("r:0b1c2d3e");
    // The id is still in the text: the room saves it verbatim.
    expect(v.state.doc.toString()).toContain("<!-- r:0b1c2d3e -->");
  });

  it("leaves an ordinary comment visible", () => {
    const v = mount("A <!-- note --> here\n");
    expect(v.contentDOM.textContent).toContain("<!-- note -->");
  });
});

describe("hiddenIdLines keeps an id with its heading", () => {
  const PAGE = "## One\n<!-- r:aaaa1111 -->\nFirst.\n";
  const SPACED = "## One\n<!-- r:aaaa1111 -->\n\nFirst.\n";

  function at(doc: string, pos: number): EditorView {
    const v = mount(doc);
    v.dispatch({ selection: EditorSelection.cursor(pos) });
    return v;
  }

  it("puts a new line typed at a heading's end below its id", () => {
    const v = at(PAGE, "## One".length);
    insertNewlineAndIndent(v);
    v.dispatch(v.state.replaceSelection("Intro."));
    expect(v.state.doc.toString()).toBe(
      "## One\n<!-- r:aaaa1111 -->\nIntro.\nFirst.\n",
    );
  });

  it("does not merge the line below an id line into it", () => {
    const v = at(PAGE, PAGE.indexOf("First."));
    deleteCharBackward(v);
    expect(v.state.doc.toString()).toBe(PAGE);
  });

  it("lets a blank line below an id go, but never the id line itself", () => {
    const v = at(SPACED, SPACED.indexOf("First."));
    deleteCharBackward(v);
    expect(v.state.doc.toString()).toBe(PAGE);
    deleteCharBackward(v);
    expect(v.state.doc.toString()).toBe(PAGE);
  });

  it("does not pull the id line onto its heading", () => {
    const v = at(PAGE, "## One".length);
    deleteCharForward(v);
    expect(v.state.doc.toString()).toBe(PAGE);
  });

  it("lets an id go together with its whole heading", () => {
    const v = mount(`Intro.\n${PAGE}`);
    v.dispatch({
      changes: {
        from: "Intro.\n".length,
        to: "Intro.\n".length + "## One\n<!-- r:aaaa1111 -->\n".length,
      },
      userEvent: "delete.selection",
    });
    expect(v.state.doc.toString()).toBe("Intro.\nFirst.\n");
  });

  it("leaves the ids out of copied text", () => {
    const v = mount(PAGE);
    let text = PAGE;
    for (const filter of v.state.facet(EditorView.clipboardOutputFilter)) {
      text = filter(text, v.state);
    }
    expect(text).toBe("## One\nFirst.\n");
  });

  it("lands a block inserted from a heading line below its id line", () => {
    const v = at(SPACED, "## One".length);
    expect(insertBlock(v, ["![a](assets/a.png)", "[b](assets/b.pdf)"])).toBe(
      true,
    );
    expect(v.state.doc.toString()).toBe(
      "## One\n<!-- r:aaaa1111 -->\n\n![a](assets/a.png)\n[b](assets/b.pdf)\n\n\nFirst.\n",
    );
    // The caret where the block put it, at the end of its first line, only
    // moved down with the block.
    const first = v.state.doc.toString().indexOf("![a]");
    expect(v.state.selection.main.head).toBe(
      first + "![a](assets/a.png)".length,
    );
  });

  it.each([
    // A caret put on the id line's start goes to the heading's end, and a
    // block from there lands below the id.
    [
      "start",
      "## One\n".length,
      "## One\n<!-- r:aaaa1111 -->\n\n![a](assets/a.png)\n\n\nFirst.\n",
    ],
    // One put on its end goes to the blank line below, and a block from an
    // empty line takes that line.
    [
      "end",
      "## One\n<!-- r:aaaa1111 -->".length,
      "## One\n<!-- r:aaaa1111 -->\n![a](assets/a.png)\n\nFirst.\n",
    ],
  ])(
    "lands a block below the id from a caret at the id line's %s",
    (_, pos, after) => {
      const v = at(SPACED, pos);
      insertBlock(v, ["![a](assets/a.png)"]);
      expect(v.state.doc.toString()).toBe(after);
    },
  );

  it("keeps a selection the block asked for when it moves below the id", () => {
    const v = at(SPACED, "## One".length);
    insertBlock(v, ["```", "code", "```"], { line: 1, from: 0, to: 4 });
    const text = v.state.doc.toString();
    expect(
      text.startsWith("## One\n<!-- r:aaaa1111 -->\n\n```\ncode\n```\n"),
    ).toBe(true);
    const { from, to } = v.state.selection.main;
    expect(text.slice(from, to)).toBe("code");
  });

  describe("a selection from inside a heading into the body", () => {
    const from = "## O".length;
    const to = PAGE.indexOf("First.") + "Fi".length;

    function selected(doc = PAGE, end = to): EditorView {
      const v = mount(doc);
      v.dispatch({ selection: EditorSelection.range(from, end) });
      return v;
    }

    it("keeps the heading's id when it is deleted", () => {
      const v = selected();
      deleteCharBackward(v);
      expect(v.state.doc.toString()).toBe("## Orst.\n<!-- r:aaaa1111 -->\n");
      expect(v.state.selection.main.head).toBe(from);
    });

    it("keeps the heading's id when it is cut", () => {
      const v = selected();
      v.dispatch({
        changes: { from, to },
        userEvent: "delete.cut",
      });
      expect(v.state.doc.toString()).toBe("## Orst.\n<!-- r:aaaa1111 -->\n");
    });

    it("keeps the heading's id when typing replaces it", () => {
      const v = selected();
      v.dispatch(v.state.replaceSelection("X"), { userEvent: "input.type" });
      expect(v.state.doc.toString()).toBe("## OXrst.\n<!-- r:aaaa1111 -->\n");
      expect(v.state.selection.main.head).toBe(from + 1);
    });

    it("puts the id below the heading line a pasted text leaves", () => {
      const v = selected();
      v.dispatch(v.state.replaceSelection("A\nB"), {
        userEvent: "input.paste",
      });
      expect(v.state.doc.toString()).toBe(
        "## OA\n<!-- r:aaaa1111 -->\nBrst.\n",
      );
      expect(v.state.selection.main.head).toBe(
        "## OA\n<!-- r:aaaa1111 -->\nB".length,
      );
    });

    it("keeps the id of a heading selected from its end", () => {
      const v = mount(PAGE);
      v.dispatch({ selection: EditorSelection.range("## One".length, to) });
      deleteCharBackward(v);
      expect(v.state.doc.toString()).toBe("## Onerst.\n<!-- r:aaaa1111 -->\n");
    });

    it("keeps one id, the first heading's, when the selection ends in a later heading", () => {
      const two = `${PAGE}## Two\n<!-- r:bbbb2222 -->\nSecond.\n`;
      const v = selected(two, two.indexOf("## Two") + "## T".length);
      deleteCharBackward(v);
      expect(v.state.doc.toString()).toBe(
        "## Owo\n<!-- r:aaaa1111 -->\nSecond.\n",
      );
    });

    it("lets the ids of headings inside the selection go with them", () => {
      const two = `${PAGE}## Two\n<!-- r:bbbb2222 -->\nSecond.\n`;
      const v = selected(two, two.indexOf("Second.") + "Se".length);
      deleteCharBackward(v);
      expect(v.state.doc.toString()).toBe("## Ocond.\n<!-- r:aaaa1111 -->\n");
    });
  });

  describe("the line break after a heading, id and all", () => {
    const TWO = `${PAGE}## Two\n<!-- r:bbbb2222 -->\nSecond.\n`;

    it("takes the id with a whole heading typed over", () => {
      const v = mount(PAGE);
      v.dispatch({ selection: EditorSelection.cursor(3) });
      selectLine(v);
      v.dispatch(v.state.replaceSelection("X"), { userEvent: "input.type" });
      expect(v.state.doc.toString()).toBe("XFirst.\n");
    });

    it("keeps the id of a heading retyped as a new heading line", () => {
      const v = mount(PAGE);
      v.dispatch({ selection: EditorSelection.cursor(3) });
      selectLine(v);
      v.dispatch(v.state.replaceSelection("## New name"), {
        userEvent: "input.type",
      });
      expect(v.state.doc.toString()).toBe(
        "## New name\n<!-- r:aaaa1111 -->\nFirst.\n",
      );
      expect(v.state.selection.main.head).toBe("## New name".length);
    });

    it("keeps the id while a new heading is typed key by key", () => {
      const v = mount(PAGE);
      v.dispatch({ selection: EditorSelection.cursor(3) });
      selectLine(v);
      for (const key of "## Renamed") {
        v.dispatch(v.state.replaceSelection(key), { userEvent: "input.type" });
      }
      expect(v.state.doc.toString()).toBe(
        "## Renamed\n<!-- r:aaaa1111 -->\nFirst.\n",
      );
    });

    it("keeps the id below a pasted heading that replaces the heading and part of the body", () => {
      const v = mount(PAGE);
      v.dispatch({
        selection: EditorSelection.range(0, PAGE.indexOf("First.") + 2),
      });
      v.dispatch(v.state.replaceSelection("## New\nIntro "), {
        userEvent: "input.paste",
      });
      expect(v.state.doc.toString()).toBe(
        "## New\n<!-- r:aaaa1111 -->\nIntro rst.\n",
      );
    });

    it("takes the id with a deleted heading line", () => {
      const v = mount(PAGE);
      v.dispatch({ selection: EditorSelection.cursor(3) });
      deleteLine(v);
      expect(v.state.doc.toString()).toBe("First.\n");
    });

    it("never merges the id into the heading when the selection ends at the next line", () => {
      const v = mount(PAGE);
      v.dispatch({ selection: EditorSelection.range(4, "## One\n".length) });
      deleteCharBackward(v);
      expect(v.state.doc.toString()).toBe("## OFirst.\n<!-- r:aaaa1111 -->\n");
    });

    it("lets a later heading's id go when the selection ends at it", () => {
      const v = mount(TWO);
      v.dispatch({
        selection: EditorSelection.range(4, TWO.indexOf("<!-- r:bbbb")),
      });
      deleteCharBackward(v);
      expect(v.state.doc.toString()).toBe("## OSecond.\n<!-- r:aaaa1111 -->\n");
    });

    it("leaves one id when two selections end on one line", () => {
      const v = mount(TWO, [EditorState.allowMultipleSelections.of(true)]);
      const b = TWO.indexOf("## Two");
      v.dispatch({
        selection: EditorSelection.create([
          EditorSelection.range(4, b + 3),
          EditorSelection.range(b + 4, TWO.indexOf("Second.") + 2),
        ]),
      });
      deleteCharBackward(v);
      expect(v.state.doc.toString()).toBe("## OTcond.\n<!-- r:aaaa1111 -->\n");
    });

    it("keeps each id when two selections run from two headings", () => {
      const v = mount(TWO, [EditorState.allowMultipleSelections.of(true)]);
      const b = TWO.indexOf("## Two");
      v.dispatch({
        selection: EditorSelection.create([
          EditorSelection.range(4, TWO.indexOf("First.") + 2),
          EditorSelection.range(b + 4, TWO.indexOf("Second.") + 2),
        ]),
      });
      v.dispatch(v.state.replaceSelection("X"), { userEvent: "input.type" });
      expect(v.state.doc.toString()).toBe(
        "## OXrst.\n<!-- r:aaaa1111 -->\n## TXcond.\n<!-- r:bbbb2222 -->\n",
      );
    });

    it.each([["A\r\nB"], ["A\rB"]])(
      "puts the id below the heading when a paste carries %j",
      (text) => {
        const v = mount(PAGE, [normalizePastedEndings]);
        v.dispatch({
          selection: EditorSelection.range(4, PAGE.indexOf("First.") + 2),
        });
        v.dispatch(v.state.replaceSelection(text), {
          userEvent: "input.paste",
        });
        expect(v.state.doc.toString()).toBe(
          "## OA\n<!-- r:aaaa1111 -->\nBrst.\n",
        );
      },
    );

    it.each([["input.paste"], ["input.drop"]])(
      "strips an id a %s brings, however it was made",
      (userEvent) => {
        const v = mount(PAGE);
        v.dispatch({
          selection: EditorSelection.range(4, PAGE.indexOf("First.") + 2),
        });
        v.dispatch(v.state.replaceSelection("A\n<!-- r:cccc3333 -->\nB"), {
          userEvent,
        });
        expect(v.state.doc.toString()).toBe(
          "## OA\n<!-- r:aaaa1111 -->\nBrst.\n",
        );
      },
    );

    it("never gives a pasted heading the id of the heading it lands in", () => {
      const v = mount(PAGE);
      v.dispatch({
        selection: EditorSelection.range(4, PAGE.indexOf("First.") + 2),
      });
      v.dispatch(v.state.replaceSelection("A\n## Z\n<!-- r:aaaa1111 -->\nB"), {
        userEvent: "input.paste",
      });
      expect(v.state.doc.toString()).toBe(
        "## OA\n<!-- r:aaaa1111 -->\n## Z\nBrst.\n",
      );
      expect(v.state.selection.main.head).toBe(
        "## OA\n<!-- r:aaaa1111 -->\n## Z\nB".length,
      );
    });

    it("strips an id from a paste with CRLF endings", () => {
      const v = mount(PAGE, [normalizePastedEndings]);
      v.dispatch({ selection: EditorSelection.cursor(PAGE.length) });
      v.dispatch(v.state.replaceSelection("x\r\n<!-- r:cccc3333 -->\r\ny"), {
        userEvent: "input.paste",
      });
      expect(v.state.doc.toString()).toBe(`${PAGE}x\ny`);
    });

    it("strips ids out of pasted text", () => {
      const v = mount(PAGE);
      v.dispatch({
        selection: EditorSelection.range(4, PAGE.indexOf("First.") + 2),
      });
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", {
        value: {
          getData: (type: string) =>
            type === "text/plain" ? "A\n## Z\n<!-- r:aaaa1111 -->\nB" : "",
          types: ["text/plain"],
          files: [],
        },
      });
      v.contentDOM.dispatchEvent(paste);
      expect(v.state.doc.toString()).toBe(
        "## OA\n<!-- r:aaaa1111 -->\n## Z\nBrst.\n",
      );
    });

    it("takes both back with one undo and puts both back with one redo", () => {
      const v = mount(PAGE, [history()]);
      v.dispatch({
        selection: EditorSelection.range(4, PAGE.indexOf("First.") + 2),
      });
      deleteCharBackward(v);
      const after = v.state.doc.toString();
      undo(v);
      expect(v.state.doc.toString()).toBe(PAGE);
      redo(v);
      expect(v.state.doc.toString()).toBe(after);
    });
  });

  describe("moving lines", () => {
    const TWO = `${PAGE}## Two\n<!-- r:bbbb2222 -->\nSecond.\n`;

    function press(v: EditorView, key: "ArrowUp" | "ArrowDown") {
      v.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key, altKey: true, bubbles: true }),
      );
    }

    it("moves a heading down with its id, past a line", () => {
      const v = mount(PAGE, [keymap.of(defaultKeymap)]);
      v.dispatch({ selection: EditorSelection.cursor(3) });
      press(v, "ArrowDown");
      expect(v.state.doc.toString()).toBe(
        "First.\n## One\n<!-- r:aaaa1111 -->\n",
      );
      expect(v.state.selection.main.head).toBe("First.\n## ".length);
    });

    it("moves a line up past a heading and its id together", () => {
      const v = mount(PAGE, [keymap.of(defaultKeymap)]);
      v.dispatch({ selection: EditorSelection.cursor(PAGE.indexOf("First.")) });
      press(v, "ArrowUp");
      expect(v.state.doc.toString()).toBe(
        "First.\n## One\n<!-- r:aaaa1111 -->\n",
      );
    });

    it("moves a heading up past another heading, both with their ids", () => {
      const v = mount(TWO, [keymap.of(defaultKeymap)]);
      v.dispatch({ selection: EditorSelection.cursor(TWO.indexOf("## Two")) });
      press(v, "ArrowUp");
      press(v, "ArrowUp");
      expect(v.state.doc.toString()).toBe(
        "## Two\n<!-- r:bbbb2222 -->\n## One\n<!-- r:aaaa1111 -->\nFirst.\nSecond.\n",
      );
    });

    it("leaves a heading at the end of the page where it is on Alt-Down", () => {
      const end = "Intro.\n## One\n<!-- r:aaaa1111 -->";
      const v = mount(end, [keymap.of(defaultKeymap)]);
      v.dispatch({ selection: EditorSelection.cursor(end.indexOf("One")) });
      press(v, "ArrowDown");
      expect(v.state.doc.toString()).toBe(end);
    });

    it("leaves a heading on the first line where it is on Alt-Up", () => {
      const v = mount(PAGE, [keymap.of(defaultKeymap)]);
      v.dispatch({ selection: EditorSelection.cursor(2) });
      press(v, "ArrowUp");
      expect(v.state.doc.toString()).toBe(PAGE);
    });

    it("does nothing when the moves of several carets would overlap", () => {
      const three = "a\n## One\n<!-- r:aaaa1111 -->\nb\n";
      const v = mount(three, [
        keymap.of(defaultKeymap),
        EditorState.allowMultipleSelections.of(true),
      ]);
      v.dispatch({
        selection: EditorSelection.create([
          EditorSelection.cursor(0),
          EditorSelection.cursor(three.indexOf("One")),
        ]),
      });
      press(v, "ArrowDown");
      expect(v.state.doc.toString()).toBe(three);
    });

    it("leaves a move with no id in reach to the default command", () => {
      const v = mount("a\nb\n", [keymap.of(defaultKeymap)]);
      v.dispatch({ selection: EditorSelection.cursor(0) });
      press(v, "ArrowDown");
      expect(v.state.doc.toString()).toBe("b\na\n");
    });
  });

  it("never rewrites an edit that is not this person's typing", () => {
    const v = mount(PAGE);
    v.dispatch({ changes: { from: "## One".length, insert: "\nRemote." } });
    expect(v.state.doc.toString()).toBe(
      "## One\nRemote.\n<!-- r:aaaa1111 -->\nFirst.\n",
    );
  });
});

describe("joining a section into the one above", () => {
  const DOC =
    "# P\n\n## A\n<!-- r:aaaa0001 -->\n\none\n\n## B\n<!-- r:bbbb0002 -->\n\ntwo\n";
  const B = DOC.indexOf("## B");
  const B_END = B + "## B".length;
  const B_ID_END = DOC.indexOf("-->", B_END) + "-->".length;
  const A_END = DOC.indexOf("## A") + "## A".length;
  const A_ID_END = DOC.indexOf("-->", A_END) + "-->".length;

  /** `## B` made `### B`, and its id line taken out with the break before it. */
  const demote = [
    { from: B, to: B + "## ".length, insert: "### " },
    { from: B_END, to: B_ID_END, insert: "" },
  ];

  it("tells an id line from any other line, only where the ids are hidden", () => {
    const v = mount(DOC);
    expect(isIdLineAt(v.state, 4)).toBe(true);
    expect(isIdLineAt(v.state, 3)).toBe(false);
    expect(isIdLineAt(v.state, 6)).toBe(false);
    // Out of the document is no id line either.
    expect(isIdLineAt(v.state, 0)).toBe(false);
    expect(isIdLineAt(v.state, 99)).toBe(false);
    const plain = EditorState.create({ doc: DOC });
    expect(isIdLineAt(plain, 4)).toBe(false);
  });

  it("lets the demoted heading's id go with the annotation", () => {
    const v = mount(DOC);
    v.dispatch({
      changes: demote,
      annotations: joinSections.of(true),
      userEvent: "input",
    });
    expect(v.state.doc.toString()).toBe(
      "# P\n\n## A\n<!-- r:aaaa0001 -->\n\none\n\n### B\n\ntwo\n",
    );
  });

  it("puts the id back when the same change comes without the annotation", () => {
    const v = mount(DOC);
    v.dispatch({ changes: demote, userEvent: "input" });
    expect(v.state.doc.toString()).toBe(
      "# P\n\n## A\n<!-- r:aaaa0001 -->\n\none\n\n### B\n<!-- r:bbbb0002 -->\n\ntwo\n",
    );
  });

  it("lets the id go when the change leaves no heading on the line", () => {
    // An id is kept only under a heading: one range that takes the mark off
    // and another that crosses the line break leave plain text.
    for (const mark of ["", "Note: "]) {
      const v = mount(DOC);
      v.dispatch({
        changes: [
          { from: B, to: B + "## ".length, insert: mark },
          { from: B_END, to: B_ID_END + 1, insert: "" },
        ],
        userEvent: "input",
      });
      expect(v.state.doc.toString()).toBe(
        `# P\n\n## A\n<!-- r:aaaa0001 -->\n\none\n\n${mark}B\ntwo\n`,
      );
      v.destroy();
    }
  });

  it("lets only the demoted heading's id go, never another one in the same change", () => {
    const v = mount(DOC);
    v.dispatch({
      changes: [{ from: A_END, to: A_ID_END, insert: "" }, ...demote],
      annotations: joinSections.of(true),
      userEvent: "input",
    });
    expect(v.state.doc.toString()).toBe(
      "# P\n\n## A\n<!-- r:aaaa0001 -->\n\none\n\n### B\n\ntwo\n",
    );
  });

  it("still refuses a single-character delete into the id line with the annotation", () => {
    const v = mount(DOC);
    v.dispatch({
      changes: { from: B_ID_END - 1, to: B_ID_END },
      annotations: joinSections.of(true),
      userEvent: "delete.backward",
    });
    expect(v.state.doc.toString()).toBe(DOC);
  });
});

describe("a caret on an id line", () => {
  const DOC = "## A\n<!-- r:aaaa0001 -->\n\none\n";
  const ID_FROM = "## A\n".length;
  const ID_TO = DOC.indexOf("-->") + "-->".length;

  /** A buffer that opened with its caret at `pos`, which no filter saw. */
  function opened(pos: number): EditorView {
    view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        selection: EditorSelection.cursor(pos),
        extensions: [EditorState.lineSeparator.of("\n"), hiddenIdLines()],
      }),
      parent: document.body,
    });
    return view;
  }

  it("steps over the id line with the arrow keys, both ways", () => {
    const v = mount(DOC);
    v.dispatch({ selection: EditorSelection.cursor("## A".length) });
    cursorCharRight(v);
    expect(v.state.selection.main.head).toBe(ID_TO + 1);
    cursorCharLeft(v);
    expect(v.state.selection.main.head).toBe("## A".length);
  });

  it("is put beside the id line when it is placed on it", () => {
    const v = mount(DOC);
    v.dispatch({ selection: EditorSelection.cursor(ID_FROM) });
    expect(v.state.selection.main.head).toBe("## A".length);
    v.dispatch({ selection: EditorSelection.cursor(ID_TO) });
    expect(v.state.selection.main.head).toBe(ID_TO + 1);
  });

  it("puts a character typed at the id line's start at the heading's end", () => {
    const v = opened(ID_FROM);
    v.dispatch(v.state.replaceSelection("x"), { userEvent: "input.type" });
    expect(v.state.doc.toString()).toBe("## Ax\n<!-- r:aaaa0001 -->\n\none\n");
    expect(v.state.selection.main.head).toBe("## Ax".length);
  });

  it("puts a character typed at the id line's end on the line below", () => {
    const v = opened(ID_TO);
    v.dispatch(v.state.replaceSelection("x"), { userEvent: "input.type" });
    expect(v.state.doc.toString()).toBe("## A\n<!-- r:aaaa0001 -->\nx\none\n");
    expect(v.state.selection.main.head).toBe(ID_TO + 2);
  });

  it("puts a paste at either end beside the id line", () => {
    const one = opened(ID_FROM);
    one.dispatch(one.state.replaceSelection("p\nq"), {
      userEvent: "input.paste",
    });
    expect(one.state.doc.toString()).toBe(
      "## A\n<!-- r:aaaa0001 -->\np\nq\none\n",
    );
    one.destroy();
    const two = opened(ID_TO);
    two.dispatch(two.state.replaceSelection("p"), { userEvent: "input.paste" });
    expect(two.state.doc.toString()).toBe(
      "## A\n<!-- r:aaaa0001 -->\np\none\n",
    );
  });

  it("puts text typed on an id line that ends the page after a new line", () => {
    view = new EditorView({
      state: EditorState.create({
        doc: "## A\n<!-- r:aaaa0001 -->",
        selection: EditorSelection.cursor("## A\n<!-- r:aaaa0001 -->".length),
        extensions: [EditorState.lineSeparator.of("\n"), hiddenIdLines()],
      }),
      parent: document.body,
    });
    view.dispatch(view.state.replaceSelection("x"), {
      userEvent: "input.type",
    });
    expect(view.state.doc.toString()).toBe("## A\n<!-- r:aaaa0001 -->\nx");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });
});
