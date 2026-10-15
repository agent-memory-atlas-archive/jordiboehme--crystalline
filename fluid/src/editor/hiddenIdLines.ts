/**
 * Section id lines, hidden in the editor.
 *
 * Every `##` of a reflection carries `<!-- r:<id> -->` on the line below it
 * (the core On-disk formats). The ids are bookkeeping: the live room saves the
 * text verbatim and the engine adds ids on the room's final save (R12), so
 * the lines stay in the document and are never shown. A block replacement
 * per id line, from a state field (block decorations cannot come from a
 * plugin), marked atomic so the caret steps over them.
 */

import type { EditorState, Extension } from "@codemirror/state";
import { RangeSetBuilder, StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView } from "@codemirror/view";

import { isIdLine } from "../reflectionText";

function build(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= state.doc.lines; n += 1) {
    const line = state.doc.line(n);
    if (isIdLine(line.text)) {
      builder.add(line.from, line.to, Decoration.replace({ block: true }));
    }
  }
  return builder.finish();
}

const field = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f)),
  ],
});

export function hiddenIdLines(): Extension {
  return field;
}
