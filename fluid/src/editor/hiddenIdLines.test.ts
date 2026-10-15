import {
  deleteCharBackward,
  deleteCharForward,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { hiddenIdLines } from "./hiddenIdLines";
import { insertBlock } from "./toolbar";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(doc: string): EditorView {
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [hiddenIdLines()] }),
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
    ["start", "## One\n".length],
    ["end", "## One\n<!-- r:aaaa1111 -->".length],
  ])(
    "lands a block below the id from a caret at the id line's %s",
    (_, pos) => {
      const v = at(SPACED, pos);
      insertBlock(v, ["![a](assets/a.png)"]);
      expect(v.state.doc.toString()).toBe(
        "## One\n<!-- r:aaaa1111 -->\n\n![a](assets/a.png)\n\n\nFirst.\n",
      );
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

  it("never rewrites an edit that is not this person's typing", () => {
    const v = mount(PAGE);
    v.dispatch({ changes: { from: "## One".length, insert: "\nRemote." } });
    expect(v.state.doc.toString()).toBe(
      "## One\nRemote.\n<!-- r:aaaa1111 -->\nFirst.\n",
    );
  });
});
