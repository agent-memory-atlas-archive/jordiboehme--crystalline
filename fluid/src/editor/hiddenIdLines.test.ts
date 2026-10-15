import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { hiddenIdLines } from "./hiddenIdLines";

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
