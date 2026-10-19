/**
 * Conventional comment labels in a thread (conventionalcomments.org): the
 * Label menu and the chip of a comment box, and the pill a thread draws for a
 * comment whose first line is `<label> [decorations]: <subject>`.
 *
 * A label is optional for people, always. The comment box holds only the
 * person's words; the chip holds the label and its decorations, and the box
 * writes `<label> (<decorations>): <first line>` on send. Typing or pasting
 * the exact head at the very start of the box turns it into the chip, the
 * way `/` opens the editor's menu. The text that is stored is the text that
 * was sent; nothing about a label is stored apart from it.
 *
 * Labels are grey; only a blocking comment gets colour: a quiet red dot in
 * its pill, and a red icon beside its passage.
 */

import type { LucideIcon } from "lucide-react";
import {
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Lightbulb,
  ListTodo,
  Microscope,
  StickyNote,
  ThumbsUp,
  Wrench,
  X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactElement } from "react";
import { useId } from "react";

import type { ConventionalHead, Label } from "../markdown/conventionalComment";
import {
  DECORATIONS,
  LABELS,
  hasDecoration,
  isBlocking,
  toggleDecoration,
} from "../markdown/conventionalComment";
import { ITEM_CLASSES, MENU_CLASSES, MENU_LABEL, MENU_SEPARATOR } from "./menu";
import { BUTTON, FOCUS_RING } from "./primitives";

/** Each label's icon and the one line the menu explains it with. */
const LABEL_FACES: Record<Label, { icon: LucideIcon; hint: string }> = {
  praise: { icon: ThumbsUp, hint: "Something done well." },
  nitpick: { icon: Microscope, hint: "A small detail, take it or leave it." },
  suggestion: { icon: Lightbulb, hint: "A proposal to change something." },
  issue: { icon: CircleAlert, hint: "Something is wrong." },
  todo: { icon: ListTodo, hint: "A small task to do." },
  question: { icon: CircleHelp, hint: "You need an answer." },
  thought: { icon: Brain, hint: "An idea, no action needed." },
  chore: {
    icon: Wrench,
    hint: "A routine step to do before this is accepted.",
  },
  note: { icon: StickyNote, hint: "Something the reader should know." },
};

const DECORATION_HINTS: Record<(typeof DECORATIONS)[number], string> = {
  blocking: "Must be settled before this is accepted.",
  "non-blocking": "Fine to leave as it is.",
  "if-minor": "Only if the change is small.",
};

/** The menu rows with a second line: as tall as their words. */
const TWO_LINE_ROW = `${ITEM_CLASSES} h-auto! py-1.5 md:h-auto!`;

/** The red of a blocking comment, as a small dot. */
function BlockingDot(): ReactElement {
  return (
    <span
      aria-hidden
      data-blocking=""
      className="size-1.5 shrink-0 rounded-full bg-(--blocking)"
    />
  );
}

/**
 * The icon of a label: grey, or red on a blocking comment where the icon
 * stands alone (beside a thread's passage). In a pill or a chip the dot
 * carries the red, and the icon stays grey.
 */
export function LabelIcon({
  head,
  size = 14,
  alone = false,
}: {
  head: ConventionalHead;
  size?: number;
  alone?: boolean;
}): ReactElement {
  const Icon = LABEL_FACES[head.label].icon;
  return (
    <Icon
      aria-hidden
      size={size}
      strokeWidth={1.75}
      className={`shrink-0 ${alone && isBlocking(head) ? "text-(--blocking)" : "text-muted"}`}
    />
  );
}

/** A head's words: the label, then each decoration after a middle dot. */
function HeadWords({ head }: { head: ConventionalHead }): ReactElement {
  return (
    <span>
      {head.label}
      {head.decorations.map((decoration, index) => (
        <span key={`${decoration}-${String(index)}`}>
          <span aria-hidden> · </span>
          <span className="sr-only">, </span>
          {decoration}
        </span>
      ))}
    </span>
  );
}

/** The pill a thread draws for a labelled comment. */
export function LabelPill({ head }: { head: ConventionalHead }): ReactElement {
  return (
    <span
      data-label-pill=""
      className="mr-1.5 inline-flex items-center gap-1 rounded-full border border-hair-strong px-1.5 align-[1px] text-[12px] leading-[18px] font-medium text-ink-3"
    >
      {isBlocking(head) && <BlockingDot />}
      <LabelIcon head={head} size={13} />
      <HeadWords head={head} />
    </span>
  );
}

/** A head as a screen reader hears it: `Label: question, non-blocking`. */
function spoken(head: ConventionalHead): string {
  return `Label: ${[head.label, ...head.decorations].join(", ")}`;
}

/**
 * The chip above a comment box: the label it will send and a button that
 * takes it off. A status line that is always there (and never seen) reads the
 * label out when it is chosen, typed or changed; a live region that appeared
 * together with its words would not reliably be heard.
 */
export function LabelChip({
  head,
  onRemove,
}: {
  head: ConventionalHead | null;
  onRemove: () => void;
}): ReactElement {
  return (
    <>
      <span role="status" className="sr-only">
        {head === null ? "" : spoken(head)}
      </span>
      {head !== null && (
        <div>
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-hair-strong bg-sunken py-0.5 pr-0.5 pl-2 text-[12.5px] text-ink-3">
            {isBlocking(head) && <BlockingDot />}
            <LabelIcon head={head} size={13} />
            <span className="sr-only">Label: </span>
            <HeadWords head={head} />
            <button
              type="button"
              aria-label="Remove the label"
              onClick={onRemove}
              className={`inline-grid size-5 place-items-center rounded-full text-muted hover:bg-hair hover:text-ink ${FOCUS_RING}`}
            >
              <X aria-hidden size={12} />
            </button>
          </span>
        </div>
      )}
    </>
  );
}

/** The button the Label menu opens from: the comment box's quiet face. */
const TRIGGER = `${BUTTON.ghost} inline-flex items-center gap-1 data-[state=open]:bg-slate-100 dark:data-[state=open]:bg-slate-800`;

/**
 * The Label menu: the nine labels, each with its icon and one line, and once
 * a label is chosen the three decorations as switches. Blocking and
 * non-blocking exclude each other; if-minor goes with either. The menu stays
 * open while a choice is made, and hands the keyboard back to the comment
 * box when it closes.
 */
export function LabelMenu({
  head,
  onChange,
  onClosed,
}: {
  head: ConventionalHead | null;
  onChange: (head: ConventionalHead) => void;
  /** Where the keyboard goes when the menu closes: the comment box. */
  onClosed: () => void;
}): ReactElement {
  const stem = useId();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={TRIGGER}>
          Label
          <ChevronDown aria-hidden size={14} strokeWidth={1.75} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className={`${MENU_CLASSES} max-h-(--radix-dropdown-menu-content-available-height) w-80 overflow-y-auto`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onClosed();
          }}
        >
          <DropdownMenu.RadioGroup
            aria-labelledby={`${stem}-labels`}
            value={head?.label ?? ""}
          >
            <DropdownMenu.Label id={`${stem}-labels`} className={MENU_LABEL}>
              Label
            </DropdownMenu.Label>
            {LABELS.map((label) => {
              const { icon: Icon, hint } = LABEL_FACES[label];
              return (
                <DropdownMenu.RadioItem
                  key={label}
                  value={label}
                  className={TWO_LINE_ROW}
                  onSelect={(event) => {
                    // Stay open: the decorations follow below.
                    event.preventDefault();
                    onChange({ label, decorations: head?.decorations ?? [] });
                  }}
                >
                  <Icon
                    aria-hidden
                    size={16}
                    strokeWidth={1.75}
                    className="shrink-0 text-muted"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-ink">{label}</span>
                    <span className="text-[12px] text-muted">{hint}</span>
                  </span>
                  <DropdownMenu.ItemIndicator className="ml-auto">
                    <Check aria-hidden size={14} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
          {head !== null && (
            <>
              <DropdownMenu.Separator className={MENU_SEPARATOR} />
              <DropdownMenu.Group aria-labelledby={`${stem}-decorations`}>
                <DropdownMenu.Label
                  id={`${stem}-decorations`}
                  className={MENU_LABEL}
                >
                  Decorations
                </DropdownMenu.Label>
                {DECORATIONS.map((decoration) => (
                  <DropdownMenu.CheckboxItem
                    key={decoration}
                    checked={hasDecoration(head, decoration)}
                    className={TWO_LINE_ROW}
                    onSelect={(event) => {
                      event.preventDefault();
                      onChange({
                        label: head.label,
                        decorations: toggleDecoration(
                          head.decorations,
                          decoration,
                        ),
                      });
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium text-ink">{decoration}</span>
                      <span className="text-[12px] text-muted">
                        {DECORATION_HINTS[decoration]}
                      </span>
                    </span>
                    <DropdownMenu.ItemIndicator className="ml-auto">
                      <Check aria-hidden size={14} />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.CheckboxItem>
                ))}
              </DropdownMenu.Group>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
