/**
 * The Reflection level beside a knowledge level (spec B5). Two axes, set side
 * by side: what a person may do with the engrams, and what they may do with
 * the domain's Reflection. The Reflection level only raises what the
 * knowledge level gives - "as knowledge" means a viewer reads and comments,
 * and `none` sees nothing - and every knowledge editor and above curates
 * whatever is stored. So for them this draws "curator" as text, never as a
 * choice: curating is never granted on its own.
 */

import { useId } from "react";
import type { ReactElement } from "react";

import type { ReflectionLevel } from "../api/model";
import { FIELD } from "./primitives";

/** Every stored Reflection level, least to most. */
// eslint-disable-next-line react-refresh/only-export-components
export const REFLECTION_LEVELS: ReflectionLevel[] = [
  "default",
  "reader",
  "contributor",
];

const WORDS: Record<ReflectionLevel, string> = {
  default: "as knowledge",
  reader: "reader",
  contributor: "contributor",
};

/** Whether a knowledge level curates the Reflection, so the choice is implied. */
// eslint-disable-next-line react-refresh/only-export-components
export function curates(knowledge: string): boolean {
  return (
    knowledge === "editor" || knowledge === "manager" || knowledge === "admin"
  );
}

/**
 * The Reflection levels worth offering beside `knowledge`. Knowledge `none`
 * with "as knowledge" would grant nothing at all, and the server refuses such
 * a membership, so it is not offered there.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function levelsFor(knowledge: string): ReflectionLevel[] {
  return knowledge === "none"
    ? REFLECTION_LEVELS.filter((level) => level !== "default")
    : REFLECTION_LEVELS;
}

/** The Reflection level to send when the knowledge level becomes `knowledge`. */
// eslint-disable-next-line react-refresh/only-export-components
export function raiseForNone(
  knowledge: string,
  reflection: ReflectionLevel,
): ReflectionLevel {
  return knowledge === "none" && reflection === "default"
    ? "reader"
    : reflection;
}

/** The words a stored Reflection level reads as, for a row that may not change it. */
// eslint-disable-next-line react-refresh/only-export-components
export function reflectionWords(
  knowledge: string,
  reflection: ReflectionLevel,
): string {
  return curates(knowledge) ? "curator" : WORDS[reflection];
}

export function ReflectionLevelSelect({
  id,
  label,
  knowledge,
  value,
  disabledReason,
  onChange,
}: {
  /** Set inside a form `Field`, whose visible label already points at it. */
  id?: string | undefined;
  label: string;
  knowledge: string;
  value: ReflectionLevel;
  disabledReason?: string | undefined;
  onChange: (level: ReflectionLevel) => void;
}): ReactElement {
  const own = useId();
  const selectId = id ?? own;
  const reasonId = useId();
  if (curates(knowledge)) {
    return <span>curator</span>;
  }
  return (
    <>
      {id === undefined && (
        <label htmlFor={selectId} className="sr-only">
          {label}
        </label>
      )}
      <select
        id={selectId}
        value={raiseForNone(knowledge, value)}
        // `aria-disabled`, not `disabled`, for the reason the level select
        // beside it gives: a read-only instance is a certainty, and the
        // control keeps announcing why.
        aria-disabled={disabledReason !== undefined}
        aria-describedby={disabledReason !== undefined ? reasonId : undefined}
        onChange={(event) => {
          if (disabledReason !== undefined) {
            return;
          }
          onChange(event.target.value as ReflectionLevel);
        }}
        className={`${FIELD} aria-disabled:cursor-default aria-disabled:opacity-50`}
      >
        {levelsFor(knowledge).map((level) => (
          <option key={level} value={level}>
            {WORDS[level]}
          </option>
        ))}
      </select>
      {disabledReason !== undefined && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </>
  );
}
