/**
 * One kept text, read only: what a room held when it could not save, or a
 * comment a refused write kept. The editors' notice and the domain settings
 * both open it, so a person reads it the same way wherever they find it.
 *
 * A dialog rather than a second pane beside the editor: the diff pane reads
 * a draft against its base by domain and path, and a kept text has neither
 * a base nor a place in the tree. Plain text in the reading face is enough
 * to see what it says before choosing what to do with it.
 */

import { useQuery } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import type { ReactElement } from "react";

import { problemDetail } from "../api/client";
import type { KeptTextEntry } from "../api/kept";
import { fetchKeptText, keptFrom, keptTextKey } from "../api/kept";
import { formatInstant } from "../format";
import { Loading } from "./Loading";
import { BUTTON } from "./primitives";

export function KeptTextDialog({
  domain,
  entry,
  onClose,
}: {
  domain: string;
  entry: KeptTextEntry;
  onClose: () => void;
}): ReactElement {
  const text = useQuery({
    queryKey: keptTextKey(domain, entry.id),
    queryFn: () => fetchKeptText(domain, entry.id),
    retry: false,
  });
  const comment = entry.kind === "comment";
  const from = keptFrom(entry);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <Dialog.Title className="text-lg font-semibold">
            {comment ? "Kept comment" : "Kept text"}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-ink-3">
            <span className="font-mono">{entry.path}</span>
            {", "}
            {formatInstant(entry.kept_at)}
            {from !== null && `. ${from}`}
          </Dialog.Description>
          {text.isPending ? (
            <Loading compact label="Loading the kept text" />
          ) : text.error !== null ? (
            <p
              role="alert"
              className="rounded bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
            >
              {problemDetail(text.error)}
            </p>
          ) : (
            <pre
              aria-label={comment ? "The kept comment" : "The kept text"}
              className="min-h-0 flex-1 overflow-auto rounded border border-hair bg-sunken p-3 font-mono text-sm break-words whitespace-pre-wrap text-ink"
            >
              {text.data.text}
            </pre>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className={BUTTON.secondary}
            >
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
