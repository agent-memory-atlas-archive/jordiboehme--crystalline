/**
 * What a callout kind looks like: the word it is shown and read out as, and
 * its icon. One table for the reading page (`Callout.tsx`) and the editor's
 * live preview (`editor/elementPreviews.ts`), so a head reads the same in
 * both.
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

import type { CalloutKind } from "../markdown/callouts";

/** The word each kind is read out and shown as. */
export const CALLOUT_WORDS: Record<CalloutKind, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
  details: "Details",
};

export const CALLOUT_ICONS: Record<CalloutKind, LucideIcon> = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert,
  details: ChevronRight,
};
