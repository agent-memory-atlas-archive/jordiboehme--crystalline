/**
 * The two controls on a reading page's breadcrumb row (spec 3.1, 5.1, 5.2):
 * Edit as a secondary button and one "More actions" menu behind an ellipsis.
 * Shared by the engram page and the Reflection page so both read the same.
 *
 * Menu rows are plain Radix items; a destructive row is styled red and the
 * rows that remove or move something sit under a rule, after the safe ones.
 */

import type { LucideIcon } from "lucide-react";
import { MoreHorizontal, Pencil } from "lucide-react";
import type { ReactElement, ReactNode, Ref } from "react";
import { DropdownMenu } from "radix-ui";
import { Link } from "react-router";

import { ITEM_CLASSES, MENU_CLASSES } from "./menu";
import { FOCUS_RING, IconButton } from "./primitives";

/** The red face of a destructive row. */
export const DESTRUCTIVE_ITEM = `${ITEM_CLASSES} text-red-700 dark:text-red-300`;

/** A secondary button, 32px tall with a leading pencil: spec 3.1. */
export function EditLink({
  to,
  label = "Edit",
  disabledReasonId,
  onPointerEnter,
  onFocus,
}: {
  to: string;
  /** The visible name; "Edit MANIFEST" on a domain's front page. */
  label?: string;
  /**
   * The id of the sentence saying why the link will not act right now. Set,
   * the link stays reachable and announced (`aria-disabled`) but goes nowhere.
   */
  disabledReasonId?: string | undefined;
  onPointerEnter?: () => void;
  onFocus?: () => void;
}): ReactElement {
  const disabled = disabledReasonId !== undefined;
  return (
    <Link
      to={to}
      aria-disabled={disabled || undefined}
      aria-describedby={disabledReasonId}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
        }
      }}
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-sm font-medium whitespace-nowrap text-ink hover:bg-slate-100 aria-disabled:cursor-default aria-disabled:opacity-50 dark:border-slate-700 dark:bg-transparent dark:hover:bg-slate-800 ${FOCUS_RING}`}
    >
      <Pencil aria-hidden="true" size={14} strokeWidth={1.75} />
      {label}
    </Link>
  );
}

/** The ellipsis menu. Its rows are the children. */
export function MoreActions({
  children,
  triggerRef,
  onCloseAutoFocus,
}: {
  children: ReactNode;
  triggerRef?: Ref<HTMLButtonElement>;
  /** Called as the menu closes; preventDefault keeps focus where it is. */
  onCloseAutoFocus?: (event: Event) => void;
}): ReactElement {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton
          ref={triggerRef}
          label="More actions"
          icon={MoreHorizontal}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className={MENU_CLASSES}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One row: an icon and its name. */
export function ActionItem({
  label,
  icon: Icon,
  destructive = false,
  onSelect,
}: {
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <DropdownMenu.Item
      className={destructive ? DESTRUCTIVE_ITEM : ITEM_CLASSES}
      onSelect={onSelect}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
      {label}
    </DropdownMenu.Item>
  );
}

export function ActionSeparator(): ReactElement {
  return (
    <DropdownMenu.Separator className="my-1 h-px bg-slate-200 dark:bg-slate-700" />
  );
}
