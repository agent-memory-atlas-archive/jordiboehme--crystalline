/**
 * The format bar's one Insert menu: callouts, diagrams, blocks and inline
 * elements, as words, read from the same registry as the `/` menu
 * (`inserts.ts`).
 *
 * Two entries of the registry are not listed here because the bar already
 * has them as controls of their own, one place per control: the table (the
 * size picker beside this menu) and the task list (its own button).
 *
 * Callout and Diagram are submenus. The diagram submenu keeps the three
 * starter groups with their headings, each heading named as its group's
 * label, and scrolls when the window is shorter than its nineteen rows.
 */

import type { EditorView } from "@codemirror/view";
import { ChevronRight, Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactElement } from "react";
import { useId } from "react";

import { FOCUS_RING } from "../components/primitives";
import type { InsertAction } from "./inserts";
import { INSERT_ACTIONS } from "./inserts";

/** The registry entries the bar shows as controls of their own. */
const OWN_CONTROLS = new Set(["table", "task"]);

const LISTED = INSERT_ACTIONS.filter((action) => !OWN_CONTROLS.has(action.id));

/** The menu face of the overhaul: 12px radius, raised, soft shadow. */
const SURFACE =
  "z-50 min-w-52 max-w-[calc(100vw-1rem)] rounded-xl border border-hair bg-raised p-1.5 text-[13.5px] shadow-pop";

/** The diagram submenu: the same face, with a ceiling it scrolls under. */
const TALL_SURFACE = `${SURFACE} max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto`;

/** One row: 34px, 44 on a phone. */
const ROW =
  "flex h-11 cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 text-ink-2 outline-none select-none data-[highlighted]:bg-sunken data-[state=open]:bg-sunken md:h-[34px]";

/** A section label: small caps, muted. */
const LABEL =
  "px-2.5 pt-2 pb-1 text-[11.5px] font-semibold tracking-[0.04em] text-muted uppercase";

const SEPARATOR = "mx-1 my-1.5 h-px bg-hair";

/** The toolbar button: the word and a plus, the bar's own quiet face. */
const TRIGGER = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-2 text-[13px] text-slate-600 hover:bg-slate-100 disabled:opacity-50 data-[state=open]:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 dark:data-[state=open]:bg-slate-800 ${FOCUS_RING}`;

function of(group: InsertAction["group"]): InsertAction[] {
  return LISTED.filter((action) => action.group === group);
}

export function InsertMenu({
  view,
}: {
  /** The buffer the entries edit; null turns the button off. */
  view: EditorView | null;
}): ReactElement {
  const stem = useId();
  const run = (action: InsertAction) => () => {
    if (view) {
      action.run(view);
    }
  };
  const item = (action: InsertAction) => (
    <DropdownMenu.Item key={action.id} className={ROW} onSelect={run(action)}>
      {action.label}
    </DropdownMenu.Item>
  );
  /** A labelled section, its label named as the group's accessible name. */
  const section = (label: string, actions: InsertAction[], key: string) => (
    <DropdownMenu.Group key={key} aria-labelledby={`${stem}-${key}`}>
      <DropdownMenu.Label id={`${stem}-${key}`} className={LABEL}>
        {label}
      </DropdownMenu.Label>
      {actions.map(item)}
    </DropdownMenu.Group>
  );
  const sub = (label: string, children: ReactElement[], tall = false) => (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={ROW}>
        {label}
        <ChevronRight
          aria-hidden="true"
          size={14}
          strokeWidth={1.75}
          className="ml-auto text-muted"
        />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          aria-label={label}
          sideOffset={6}
          className={tall ? TALL_SURFACE : SURFACE}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
  const diagrams = of("Diagram");
  const subgroups = [...new Set(diagrams.map((action) => action.subgroup))];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={TRIGGER} disabled={view === null}>
          <Plus aria-hidden="true" size={16} strokeWidth={1.75} />
          Insert
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className={SURFACE}
          // Radix hands focus back to the trigger when the menu closes; the
          // bar always returns an author to the buffer instead, having
          // inserted something or having pressed Escape.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            view?.focus();
          }}
        >
          {sub("Callout", of("Callout").map(item))}
          {sub(
            "Diagram",
            subgroups.map((subgroup, index) =>
              section(
                subgroup ?? "",
                diagrams.filter((action) => action.subgroup === subgroup),
                `diagram-${String(index)}`,
              ),
            ),
            true,
          )}
          <DropdownMenu.Separator className={SEPARATOR} />
          {section("Blocks", of("Blocks"), "blocks")}
          {section("Inline", of("Inline"), "inline")}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
