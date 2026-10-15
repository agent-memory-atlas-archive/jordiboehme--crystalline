/**
 * A new page of a domain's Reflection: a folder, a title, and the path they
 * make, said before anything is written. The page is created with its title
 * as its heading and opens in the live editor.
 *
 * A create never overwrites: the request says it is one (`create: true`,
 * core Task 17), and a path somebody already holds is refused by the
 * server in its own words.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import type { ReactElement } from "react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";

import { problemDetail } from "../api/client";
import { reflectionKey, saveReflection } from "../api/reflection";
import { reflectionEditRoute } from "../paths";
import { pathPermalink } from "../permalink";
import { BUTTON, FIELD } from "./primitives";

// eslint-disable-next-line react-refresh/only-export-components
export function newPagePath(folder: string, title: string): string {
  const stem = pathPermalink(
    folder.trim() === "" ? title : `${folder.trim()}/${title}`,
  );
  const leaf = stem.split("/").pop() ?? "";
  return leaf === "" || pathPermalink(title) === "" ? "" : `${stem}.md`;
}

export function NewReflectionDialog({
  domain,
  folder,
  onClose,
}: {
  domain: string;
  folder: string;
  onClose: () => void;
}): ReactElement {
  const [where, setWhere] = useState(folder);
  const [title, setTitle] = useState("");
  const folderId = useId();
  const titleId = useId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const path = newPagePath(where, title);
  const create = useMutation({
    mutationFn: () =>
      saveReflection(domain, path, `# ${title.trim()}\n`, { create: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reflectionKey(domain) });
      onClose();
      void navigate(reflectionEditRoute(domain, path));
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
          <Dialog.Title className="text-lg font-semibold">
            New page
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {path === ""
              ? "Give the page a title."
              : `The page will be saved as ${path}.`}
          </Dialog.Description>
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (path !== "" && !create.isPending) {
                create.mutate();
              }
            }}
          >
            <label htmlFor={folderId} className="text-sm">
              Folder
            </label>
            <input
              id={folderId}
              value={where}
              onChange={(e) => {
                setWhere(e.target.value);
              }}
              className={FIELD}
            />
            <label htmlFor={titleId} className="text-sm">
              Title
            </label>
            <input
              id={titleId}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              className={FIELD}
            />
            {create.error && (
              <p
                role="alert"
                className="rounded bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
              >
                {problemDetail(create.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={BUTTON.ghost}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={path === "" || create.isPending}
                className={BUTTON.primary}
              >
                Create page
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
