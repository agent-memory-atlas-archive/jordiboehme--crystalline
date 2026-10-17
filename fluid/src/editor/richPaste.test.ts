import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reflectionAdapter } from "./adapter";
import { attachmentUploads } from "./attachments";
import { richPaste } from "./richPaste";
import { surfaceExtensions } from "./surface";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(doc: string, extra: Extension[] = []): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        EditorState.lineSeparator.of("\n"),
        history(),
        markdown(),
        richPaste(),
        ...extra,
      ],
    }),
    parent: document.body,
  });
  return view;
}

/** A paste event carrying the given clipboard flavours, the way a browser sends one. */
function paste(
  v: EditorView,
  data: { html?: string; plain?: string; files?: File[] },
): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const types = [
    ...(data.html === undefined ? [] : ["text/html"]),
    ...(data.plain === undefined ? [] : ["text/plain"]),
    ...(data.files?.length ? ["Files"] : []),
  ];
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) =>
        type === "text/html"
          ? (data.html ?? "")
          : type === "text/plain"
            ? (data.plain ?? "")
            : "",
      types,
      files: data.files ?? [],
    },
  });
  v.contentDOM.dispatchEvent(event);
  return event;
}

function keydown(v: EditorView, init: KeyboardEventInit): void {
  v.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
}

const RICH = "<h2>Steps</h2><ul><li><b>Build</b> it</li></ul>";
const RICH_PLAIN = "Steps\nBuild it";

describe("richPaste", () => {
  it("inserts the converted Markdown of an HTML paste in one transaction", async () => {
    const v = mount("Intro\n\n");
    const event = paste(v, { html: RICH, plain: RICH_PLAIN });
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(v.state.doc.toString()).toBe(
        "Intro\n\n## Steps\n\n- **Build** it",
      ),
    );
    undo(v);
    expect(v.state.doc.toString()).toBe("Intro\n\n");
  });

  it("converts at once once the converter has loaded", async () => {
    const v = mount("");
    paste(v, { html: RICH, plain: RICH_PLAIN });
    await vi.waitFor(() => expect(v.state.doc.length).toBeGreaterThan(0));
    v.dispatch({ changes: { from: 0, to: v.state.doc.length } });
    paste(v, { html: "<p><i>now</i></p>", plain: "now" });
    expect(v.state.doc.toString()).toBe("*now*");
  });

  it("leaves a paste with only plain text to the editor", () => {
    const v = mount("");
    paste(v, { plain: "a *b* c" });
    expect(v.state.doc.toString()).toBe("a *b* c");
  });

  it("pastes plain text after Mod-Shift-V", async () => {
    const v = mount("");
    keydown(v, { key: "V", code: "KeyV", shiftKey: true, ctrlKey: true });
    paste(v, { html: RICH, plain: RICH_PLAIN });
    expect(v.state.doc.toString()).toBe(RICH_PLAIN);
    // One shot: the next paste is rich again.
    v.dispatch({ changes: { from: 0, to: v.state.doc.length } });
    paste(v, { html: RICH, plain: RICH_PLAIN });
    await vi.waitFor(() =>
      expect(v.state.doc.toString()).toBe("## Steps\n\n- **Build** it"),
    );
  });

  it("forgets a Mod-Shift-V that brought no paste once another key is pressed", async () => {
    const v = mount("");
    keydown(v, { key: "V", code: "KeyV", shiftKey: true, metaKey: true });
    keydown(v, { key: "a", code: "KeyA" });
    paste(v, { html: RICH, plain: RICH_PLAIN });
    await vi.waitFor(() =>
      expect(v.state.doc.toString()).toBe("## Steps\n\n- **Build** it"),
    );
  });

  it("pastes plain text into a code fence", () => {
    const v = mount("```\n\n```\n");
    v.dispatch({ selection: { anchor: 4 } });
    paste(v, { html: RICH, plain: "let x = 1;" });
    expect(v.state.doc.toString()).toBe("```\nlet x = 1;\n```\n");
  });

  it("keeps a code editor's copy as its plain text, indentation and all", async () => {
    const v = mount("");
    const html =
      '<div style="white-space: pre;"><div><span style="color: #569cd6;">fn</span> main() {</div><div>    run();</div><div>}</div></div>';
    paste(v, { html, plain: "fn main() {\n    run();\n}" });
    await vi.waitFor(() =>
      expect(v.state.doc.toString()).toBe("fn main() {\n    run();\n}"),
    );
  });

  it("pastes the plain text when the HTML converts to nothing", async () => {
    const v = mount("");
    paste(v, { html: '<meta charset="utf-8">', plain: "just words" });
    await vi.waitFor(() => expect(v.state.doc.toString()).toBe("just words"));
  });

  it("leaves a read-only buffer alone", () => {
    const v = mount("x", [EditorState.readOnly.of(true)]);
    const event = paste(v, { html: RICH, plain: RICH_PLAIN });
    expect(event.defaultPrevented).toBe(true);
    expect(v.state.doc.toString()).toBe("x");
  });

  it("hands a paste that carries files to the uploads", () => {
    const onFiles = vi.fn();
    const v = mount("", [attachmentUploads(onFiles)]);
    const file = new File(["png"], "shot.png", { type: "image/png" });
    paste(v, { html: '<img src="x.png">', plain: "", files: [file] });
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(v.state.doc.toString()).toBe("");
  });

  it("leaves no section id in a Reflection buffer", async () => {
    const page = "## First\n<!-- r:0b1c2d3e -->\n\nBody.\n";
    const v = mount(page, reflectionAdapter().extensions);
    paste(v, {
      html: "<h2>Pasted</h2><p>&lt;!-- r:aaaa1111 --&gt;</p><p>Text</p>",
      plain: "Pasted\n<!-- r:aaaa1111 -->\nText",
    });
    await vi.waitFor(() =>
      expect(v.state.doc.toString()).toContain("## Pasted"),
    );
    expect(v.state.doc.toString()).not.toContain("r:aaaa1111");
    expect(v.state.doc.toString()).toContain("<!-- r:0b1c2d3e -->");
  });

  it("is part of the shared surface, beside the uploads, in a Reflection buffer", async () => {
    const onFiles = vi.fn();
    const page = "## First\n<!-- r:0b1c2d3e -->\n\nBody.\n";
    view = new EditorView({
      state: EditorState.create({
        doc: page,
        selection: EditorSelection.cursor(page.length),
        extensions: [
          EditorState.lineSeparator.of("\n"),
          ...surfaceExtensions({
            adapter: reflectionAdapter(),
            dark: false,
            history: true,
            screen: [],
            preview: new Compartment(),
            raw: false,
            images: [],
            uploads: attachmentUploads(onFiles),
            onTableContext: () => {},
            onImageContext: () => {},
            onElementContext: () => {},
          }),
        ],
      }),
      parent: document.body,
    });
    const v = view;
    const file = new File(["png"], "shot.png", { type: "image/png" });
    paste(v, { html: '<img src="x.png">', files: [file] });
    expect(onFiles).toHaveBeenCalledWith([file]);
    paste(v, {
      html: '<h2>Pasted</h2><p>&lt;!-- r:aaaa1111 --&gt;</p><div data-macro-name="tip"><p>Short.</p></div>',
      plain: "Pasted\n<!-- r:aaaa1111 -->\nShort.",
    });
    await vi.waitFor(() =>
      expect(v.state.doc.toString()).toBe(
        // The id paragraph goes with one of its line breaks.
        `${page}## Pasted\n\n\n> [!TIP]\n> Short.`,
      ),
    );
    // Mod-Shift-V through the whole keymap stack still reaches the paste.
    keydown(v, { key: "V", code: "KeyV", shiftKey: true, ctrlKey: true });
    paste(v, { html: "<p><b>bold</b></p>", plain: "bold" });
    expect(v.state.doc.toString()).toBe(
      `${page}## Pasted\n\n\n> [!TIP]\n> Short.bold`,
    );
  });
});
