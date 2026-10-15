/**
 * Move or rename one page. Its threads and its baseline move with it and
 * links to it in other pages follow (core Task 12); a page somebody is
 * editing is refused by the server until the room is closed, and that
 * sentence is shown as the server wrote it.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import type { ReactElement } from "react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";

import { problemDetail } from "../api/client";
import { moveReflection, reflectionKey } from "../api/reflection";
import { reflectionPageRoute } from "../paths";
import { BUTTON, FIELD } from "./primitives";

export function MoveReflectionDialog({
  domain,
  path,
  title,
  onClose,
}: {
  domain: string;
  path: string;
  title: string;
  onClose: () => void;
}): ReactElement {
  const [to, setTo] = useState(path);
  const [unlinked, setUnlinked] = useState<{ path: string; reason: string }[]>(
    [],
  );
  const field = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const move = useMutation({
    mutationFn: () => moveReflection(domain, path, to.trim()),
    onSuccess: (moved) => {
      void queryClient.invalidateQueries({ queryKey: reflectionKey(domain) });
      void navigate(reflectionPageRoute(domain, moved.to), { replace: true });
      // Pages the server could not relink stay listed until read; the page
      // behind the dialog has already followed the move.
      if (moved.linksFailed.length > 0) {
        setUnlinked(moved.linksFailed);
      } else {
        onClose();
      }
    },
  });
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <Dialog.Title className="text-lg font-semibold">{`Move ${title}`}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Its threads move with it, and links to it in other pages follow.
          </Dialog.Description>
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (to.trim() !== "" && to.trim() !== path && !move.isPending) {
                move.mutate();
              }
            }}
          >
            <label htmlFor={field} className="text-sm">
              New path
            </label>
            <input
              id={field}
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
              }}
              className={FIELD}
            />
            {move.error && (
              <p
                role="alert"
                className="rounded bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
              >
                {problemDetail(move.error)}
              </p>
            )}
            {unlinked.length > 0 && (
              <div role="status" className="text-sm">
                <p>These pages still link the old path:</p>
                <ul className="list-disc pl-5">
                  {unlinked.map((page) => (
                    <li key={page.path}>
                      <span className="font-mono">{page.path}</span>
                      {page.reason !== "" ? ` (${page.reason})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              {unlinked.length > 0 ? (
                <button
                  type="button"
                  onClick={onClose}
                  className={BUTTON.primary}
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    className={BUTTON.ghost}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={move.isPending}
                    className={BUTTON.primary}
                  >
                    Move page
                  </button>
                </>
              )}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
