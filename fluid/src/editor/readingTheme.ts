/**
 * The editors' text at the reading size: the same 16px and line height the
 * reading page sets prose in, with no inset of its own, so the text, the
 * images and the toolbar line up on one left edge in the reading column.
 *
 * Separate from `editorTheme` because the MANIFEST editor shares that one
 * and keeps its own face. `Prec.high` for the reason `RAW_MONO` gives: two
 * themes setting one property are decided by mount order, and this one is
 * added after the base set.
 */

import type { Extension } from "@codemirror/state";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const readingTheme: Extension = Prec.high(
  EditorView.theme({
    "&": { fontSize: "1rem" },
    ".cm-scroller": { lineHeight: "1.72" },
    ".cm-content": { padding: "1rem 0 3rem" },
    ".cm-line": { padding: "0" },
    // Pictures stand on the text's own left edge, as on the reading page.
    ".cm-image-preview": { padding: "0.5rem 0" },
    // A frontmatter block shown as text (the Reflection editor) reads as the
    // page's settings: small, mono and plain, even where the markdown parser
    // takes a `key:` line over the closing fence for a heading.
    ".cm-line.cm-frontmatter": {
      fontFamily: "var(--font-mono, ui-monospace, monospace)",
      fontSize: "0.8125rem",
    },
    ".cm-line.cm-frontmatter *": {
      fontSize: "inherit",
      fontWeight: "inherit",
    },
  }),
);
