/**
 * Rich paste: HTML on the clipboard (a wiki page, a docs editor, a word
 * processor, a web page) arrives as clean Markdown in this dialect.
 *
 * The converter (`htmlToMarkdown.ts`, with turndown) loads on the first rich
 * paste, so it never reaches the eager bundle. The event is cancelled at once
 * because the clipboard is gone once the handler returns, and the text lands
 * later in one `input.paste` transaction: every transaction filter a buffer
 * carries (a Reflection page's id guards, a room's line endings) sees it the
 * way it sees a plain paste, and the clipboard input filters run on it first,
 * as they do on the editor's own paste path.
 *
 * The editor's own paste keeps everything else: a clipboard with no HTML, a
 * plain paste (Mod-Shift-V), a paste into a code fence, a read-only buffer,
 * and a paste of files, which the uploads take whichever handler runs first.
 */

import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { transferFiles } from "./attachments";

type Converter = typeof import("./htmlToMarkdown");

let loading: Promise<Converter> | null = null;
/** The converter once it has loaded, so later pastes convert at once. */
let loaded: Converter | null = null;

function loadConverter(): Promise<Converter> {
  loading ??= import("./htmlToMarkdown").then(
    (module) => {
      loaded = module;
      return module;
    },
    (error: unknown) => {
      // A chunk that failed to load (a deploy in between) is tried again on
      // the next paste rather than remembered as failed.
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** What a rich paste puts in: the Markdown, or the plain text when that is better. */
function converted(converter: Converter, html: string, plain: string): string {
  if (converter.prefersPlainText(html)) {
    return plain;
  }
  const md = converter.htmlToMarkdown(html);
  return md.trim() === "" ? plain : md;
}

/**
 * How long after Mod-Shift-V the next paste counts as plain. The shortcut
 * only marks the paste the browser fires for it; a shortcut that brought no
 * paste must not make a later one plain.
 */
const PLAIN_PASTE_MS = 1000;
const plainUntil = new WeakMap<EditorView, number>();

function isPlainPasteKey(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    (event.code === "KeyV" || event.key.toLowerCase() === "v")
  );
}

/** Whether a caret or selection sits in a code block, which takes code as it is. */
function inCode(state: EditorState): boolean {
  const tree = syntaxTree(state);
  return state.selection.ranges.some((range) => {
    for (
      let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
        range.head,
        -1,
      );
      node !== null;
      node = node.parent
    ) {
      if (node.name === "FencedCode" || node.name === "CodeBlock") {
        return true;
      }
    }
    return false;
  });
}

/** Puts pasted text in the way the editor's own paste does, as one transaction. */
function insert(view: EditorView, text: string): void {
  // The buffer may have closed while the converter loaded.
  if (!view.dom.isConnected || view.state.readOnly) {
    return;
  }
  let input = text;
  for (const filter of view.state.facet(EditorView.clipboardInputFilter)) {
    input = filter(input, view.state);
  }
  if (input === "") {
    return;
  }
  view.dispatch(view.state.replaceSelection(Text.of(input.split(/\r\n?|\n/))), {
    userEvent: "input.paste",
    scrollIntoView: true,
  });
}

export function richPaste(): Extension {
  return EditorView.domEventHandlers({
    keydown(event, view) {
      if (isPlainPasteKey(event)) {
        plainUntil.set(view, Date.now() + PLAIN_PASTE_MS);
      } else {
        plainUntil.delete(view);
      }
      // Never taken: the browser must still fire its paste.
      return false;
    },
    paste(event, view) {
      const plainKey = (plainUntil.get(view) ?? 0) > Date.now();
      plainUntil.delete(view);
      const data = event.clipboardData;
      if (
        data === null ||
        plainKey ||
        view.state.readOnly ||
        transferFiles(data).length > 0
      ) {
        return false;
      }
      const html = data.getData("text/html");
      if (html.trim() === "" || inCode(view.state)) {
        return false;
      }
      const plain = data.getData("text/plain");
      event.preventDefault();
      if (loaded !== null) {
        insert(view, converted(loaded, html, plain));
        return true;
      }
      loadConverter().then(
        (converter) => insert(view, converted(converter, html, plain)),
        // No converter, no lost paste: the plain text goes in.
        () => insert(view, plain),
      );
      return true;
    },
  });
}
