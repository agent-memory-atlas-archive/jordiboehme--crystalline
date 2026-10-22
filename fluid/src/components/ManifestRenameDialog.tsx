/**
 * The question a MANIFEST save asks when its text changes `domain_name`.
 *
 * Nothing has been written when this opens. Undoing puts the old name back in
 * the buffer, keeping saves the text as typed and keeps the old name as an
 * alias, renaming saves the text under the old name and then renames the
 * domain properly, which respells the links that named it. Escape and the
 * scrim only close the question: the text stays as typed and nothing is saved.
 *
 * The same Radix dialog the editor's other two questions use, drawn the same
 * way. The safe answer takes the keyboard: undoing changes nothing on disk.
 */

import { Dialog } from "radix-ui";
import type { ReactElement } from "react";

import { BUTTON } from "./primitives";

export interface ManifestRenameDialogProps {
  /** The name the MANIFEST was loaded with. */
  from: string;
  /** The name the text says now. */
  to: string;
  onUndo: () => void;
  onKeep: () => void;
  onRename: () => void;
  /** Close the question and change nothing. */
  onDismiss: () => void;
}

export function ManifestRenameDialog({
  from,
  to,
  onUndo,
  onKeep,
  onRename,
  onDismiss,
}: ManifestRenameDialogProps): ReactElement {
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) {
          onDismiss();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <Dialog.Title className="text-lg font-semibold">
            You changed the domain name
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            The MANIFEST now says {to} instead of {from}.
          </Dialog.Description>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              autoFocus
              onClick={onUndo}
              className={BUTTON.secondary}
            >
              Undo the name change
            </button>
            <button type="button" onClick={onKeep} className={BUTTON.secondary}>
              Save without renaming
            </button>
            <button type="button" onClick={onRename} className={BUTTON.primary}>
              Rename the domain
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
