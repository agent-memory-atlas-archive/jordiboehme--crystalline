/**
 * A callout in the text: a quote the writer marked `[!KIND]` (see
 * `markdown/callouts.ts`). Drawn calm, with no box: a 3px rule and a light
 * tint in the kind's colour (`.callout` in `index.css`), a small icon and the
 * title, the body in the page's own ink.
 *
 * A folded callout is a native `<details>` inside the same note, so the
 * browser does the opening and closing and the keyboard works as it does
 * everywhere else. The head is drawn from the head the writer wrote, never
 * stamped with a source offset, and carries the anchoring skip marker: a
 * selection that starts on it is a selection of the words below it.
 */

import {
  ChevronRight,
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { CalloutKind } from "../markdown/callouts";
import { SKIP_ATTR } from "../reflectionQuotes";
import { FOCUS_RING } from "./primitives";

/** The word each kind is read out and shown as. */
const CALLOUT_WORDS: Record<CalloutKind, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
  details: "Details",
};

const ICONS: Record<CalloutKind, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
  details: ChevronRight,
};

const HEAD = "flex items-center gap-1.5 font-semibold text-ink";
const ICON = "shrink-0 text-(--callout)";

export default function Callout({
  kind,
  title,
  fold,
  children,
}: {
  kind: CalloutKind;
  title: string | null;
  fold: "open" | "closed" | null;
  children?: ReactNode;
}) {
  const word = CALLOUT_WORDS[kind];
  const Icon = ICONS[kind];
  const label = title === null ? word : `${word}: ${title}`;
  const shown = title ?? word;
  const skip = { [SKIP_ATTR]: "" };
  if (fold === null) {
    return (
      <aside
        role="note"
        aria-label={label}
        data-callout={kind}
        className="callout my-4 rounded-r-md py-2 pr-3 pl-4"
      >
        <div {...skip} className={`${HEAD} my-1`}>
          <Icon aria-hidden size={16} className={ICON} />
          <span>{shown}</span>
        </div>
        {children}
      </aside>
    );
  }
  return (
    <aside
      role="note"
      aria-label={label}
      data-callout={kind}
      className="callout my-4 rounded-r-md py-2 pr-3 pl-4"
    >
      <details
        data-callout={kind}
        data-fold={fold}
        className="group"
        {...(fold === "open" ? { open: true } : {})}
      >
        <summary
          {...skip}
          className={`${HEAD} my-1 cursor-pointer list-none rounded-sm [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}
        >
          <ChevronRight
            aria-hidden
            size={16}
            className={`${ICON} transition-transform group-open:rotate-90 motion-reduce:transition-none`}
          />
          {kind === "details" ? null : (
            <Icon aria-hidden size={16} className={ICON} />
          )}
          <span>{shown}</span>
        </summary>
        {children}
      </details>
    </aside>
  );
}
