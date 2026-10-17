/**
 * "Attach a file": one picker for every surface that takes files, the engram
 * toolbar and the reflection editor's header alike.
 *
 * A module of its own rather than a part of the toolbar, so a screen that
 * wants only this button does not load the whole bar with it.
 */

import type { ChangeEvent, ReactElement } from "react";
import { useRef } from "react";

import { ATTACHMENT_ACCEPT } from "../api/files";
import { IconButton } from "../components/primitives";
import { AttachIcon } from "./attachIcon";

export function AttachButton({
  onAttach,
  disabled = false,
}: {
  /** What to do with the files a person picks. */
  onAttach: (files: File[]) => void;
  disabled?: boolean;
}): ReactElement {
  /*
   * The picker itself. A native file input is the only way to open the
   * dialog, and it is kept hidden rather than styled: the button beside it
   * belongs to the surface's own row, so the row reads as one kind of thing.
   */
  const picker = useRef<HTMLInputElement | null>(null);
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared before the callback runs, so picking the same file twice in a
    // row still fires a change the second time.
    event.target.value = "";
    if (files.length > 0) {
      onAttach(files);
    }
  };
  return (
    <>
      <IconButton
        label="Attach a file"
        icon={AttachIcon}
        disabled={disabled}
        onClick={() => {
          picker.current?.click();
        }}
      />
      <input
        ref={picker}
        type="file"
        multiple
        // The allowlist as the dialog's own filter, so a file the server
        // would refuse is hard to pick in the first place. It is a hint
        // rather than a gate - every picker offers a way past it - which is
        // why the upload checks the extension again.
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={picked}
      />
    </>
  );
}
