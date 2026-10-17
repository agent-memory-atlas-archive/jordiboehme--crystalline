/**
 * A task list box on a reading page: open, done, or not applicable.
 *
 * Open and done are a real checkbox, named by the item's words. Where the
 * page can save, a click is the edit: the page flips the three characters
 * in the file and saves it. Where it cannot, the box is disabled and says
 * why, on hover and to a screen reader. Not applicable (`[~]`) is no
 * checkbox at all: a struck box with a name, which nothing toggles.
 *
 * Each box stands in the bullet's column, so a task item's words start
 * where a plain item's words do.
 */

import { useId } from "react";

/** The column the bullet stood in, pulled back from the item's words. */
const COLUMN = "-ml-6 inline-block w-6 align-baseline select-none";

export function TaskBox({
  checked,
  label,
  onToggle,
  reason,
}: {
  checked: boolean;
  /** The item's own words, which name the box. */
  label: string;
  /** Flip the box. Absent, the box only shows its state. */
  onToggle?: (() => void) | undefined;
  /** Why the box does not tick here, shown with it. */
  reason?: string | undefined;
}) {
  const reasonId = useId();
  return (
    <span className={COLUMN} title={reason} data-anchor-skip="">
      <input
        type="checkbox"
        checked={checked}
        disabled={onToggle === undefined}
        aria-label={label}
        aria-describedby={reason === undefined ? undefined : reasonId}
        onChange={() => {
          onToggle?.();
        }}
        className={`size-3.5 align-[-0.15em] accent-accent-700 dark:accent-accent-400 ${
          onToggle === undefined ? "" : "cursor-pointer"
        }`}
      />
      {reason !== undefined && (
        <span id={reasonId} hidden>
          {reason}
        </span>
      )}
    </span>
  );
}

/** The not-applicable box: struck through once, and never a control. */
export function NotApplicableBox({ label }: { label: string }) {
  return (
    <span className={COLUMN} data-anchor-skip="">
      <span
        role="img"
        aria-label={`Not applicable: ${label}`}
        className="inline-block size-3.5 rounded-xs border border-faint bg-[linear-gradient(var(--muted),var(--muted))] bg-[length:100%_1px] bg-center bg-no-repeat align-[-0.15em]"
      />
    </span>
  );
}
