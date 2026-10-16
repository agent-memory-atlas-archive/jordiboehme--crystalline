/**
 * Name flags on the other people's carets: each remote caret carries its
 * owner's name in their own color, always, rather than only while the pointer
 * hovers it (the binding's default). The flag is the binding's own element,
 * restyled; the color comes from the caret it sits on.
 *
 * `Prec.high`, because the binding's base theme sets the same properties and
 * the view mounts style modules in reverse order: at default precedence this
 * would lose to the rule it overrides.
 */

import type { Extension } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const cursorFlags: Extension = Prec.high(
  EditorView.theme({
    ".cm-ySelectionCaret > .cm-ySelectionInfo": {
      opacity: "1",
      top: "-1.45em",
      left: "-1px",
      padding: "1px 5px",
      borderRadius: "3px 3px 3px 0",
      fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
      fontSize: "11px",
      fontWeight: "600",
      lineHeight: "1.3",
      // Near-black reads on every color of the presence palette.
      color: "#0b0d13",
      pointerEvents: "none",
    },
    ".cm-ySelectionCaret > .cm-ySelectionCaretDot": {
      display: "none",
    },
  }),
);
