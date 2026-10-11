import { Lock } from "lucide-react";
import type { ReactElement } from "react";

import { Chip } from "./primitives";

/** The line beside the lock, the A7 sentence's second half. */
export const DOMAIN_LOCK_LINE =
  "its owner switches read_only off in the domain policies";

/**
 * The lock a read-only domain wears, on its own page and on every engram
 * page in it, and only there: a domain this caller merely cannot write (a
 * viewer, a write list) wears nothing, its write controls are just absent.
 * The word is the content; the glyph is decoration for a reader who scans
 * for it.
 */
export function DomainLockChip(): ReactElement {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Chip>
        <Lock
          aria-hidden="true"
          size={12}
          strokeWidth={1.75}
          className="mr-1"
        />
        read-only
      </Chip>
      <span className="text-caption text-slate-500 dark:text-slate-400">
        {DOMAIN_LOCK_LINE}
      </span>
    </span>
  );
}
