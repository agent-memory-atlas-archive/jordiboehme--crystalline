/**
 * The paste guard every live room's buffer carries: the shared text stays in
 * LF space whatever the clipboard holds. One spelling for the engram editor
 * and the reflection editor, so neither room can drift from the other.
 */

import type { Transaction } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import type { YSyncConfig } from "y-codemirror.next";
import { ySyncFacet } from "y-codemirror.next";
import type * as Y from "yjs";

/**
 * Whether this transaction is the co-editing binding putting the ROOM's text
 * into the buffer, which must be handed back exactly as it arrived.
 *
 * y-codemirror.next skips its write-back into `Y.Text` only while the
 * transaction still carries the annotation its sync plugin dispatched with,
 * and a transaction rebuilt by the filter below has lost it: the plugin would
 * re-apply a remote insert INTO the shared text and every participant would
 * end up with it twice, with the buffer and the document permanently apart.
 * Session text may legitimately hold a lone CR - the server admits a stray-CR
 * file and broadcasts such lines from a merge - so this is a live path, not a
 * theoretical one.
 *
 * The annotation type is not reachable: y-codemirror.next 0.3.5, the current
 * release, exports `ySyncFacet` and `YSyncConfig` but not `ySyncAnnotation`,
 * and its `exports` map admits no deep import. So the binding is recognized by
 * what it guarantees instead. It dispatches from the `Y.Text` observer, with
 * the shared text ALREADY carrying the change, so the document this
 * transaction produces IS the shared text. A local edit runs the other way -
 * Yjs is written after the transaction lands - so the two still differ here.
 * A state with no binding has no facet and no write-back to protect.
 */
function isRoomWriteBack(tr: Transaction): boolean {
  const sync = tr.startState.facet(ySyncFacet) as YSyncConfig | undefined;
  if (sync === undefined) {
    return false;
  }
  const shared = sync.ytext as Y.Text;
  return tr.newDoc.toString() === shared.toJSON();
}

/**
 * Keep the shared text in LF space whatever gets pasted into it.
 *
 * A session document is LF by construction - the server strips a CRLF file's
 * endings on the way in and puts them back on the way out - so a CR arriving
 * through the clipboard is not this author's line ending, it is a stray byte
 * that would land in every participant's file and in the saved document.
 */
export const normalizePastedEndings = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) {
    return tr;
  }
  let needsRewrite = false;
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.toString().includes("\r")) {
      needsRewrite = true;
    }
  });
  if (!needsRewrite) {
    return tr;
  }
  // Checked here rather than at the top: the comparison walks the shared
  // text, and only a frame carrying a CR can reach it at all. A sync
  // transaction with no CR in it is handed back untouched either way.
  if (isRoomWriteBack(tr)) {
    return tr;
  }
  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({
      from: fromA,
      to: toA,
      insert: inserted.toString().replace(/\r\n?/g, "\n"),
    });
  });
  // The selection is deliberately omitted rather than carried over: its
  // positions belong to the unrewritten, longer inserts and can point past
  // the end of the rewritten document, which CodeMirror refuses outright.
  // Given no selection of its own, it maps the existing one through these
  // changes instead, which is the correct place for the cursor anyway.
  //
  // Rebuilding drops the transaction's annotations, which is why the room's
  // own write-back is let through above: this path only ever rebuilds a local
  // edit, whose annotations nothing downstream depends on.
  return { changes };
});
