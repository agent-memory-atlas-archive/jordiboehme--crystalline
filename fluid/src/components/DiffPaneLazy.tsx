/**
 * The diff pane behind a lazy import.
 *
 * A module of its own because the pane's own module default-exports the
 * component the import resolves to, and the seam every screen mounts is a
 * named one.
 */

import type { ReactElement } from "react";
import { lazyPart } from "./lazyPart";

const Pane = lazyPart(() => import("./DiffPane"));

/** The diff pane behind a lazy import: the merge package never rides the entry bundle. */
export function DiffPane(props: {
  domain: string;
  path: string;
  headingId: string;
}): ReactElement {
  return (
    <Pane
      {...props}
      fallback={
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Reading both sides
        </p>
      }
    />
  );
}
