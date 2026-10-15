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
import { WORDS, curates, levelsFor, raiseForNone } from "./reflectionLevels";

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
    // An `output`, not a `span`: it is labelable, so the form `Field`'s
    // visible "Reflection" label still points at something a screen reader
    // reads when the choice is implied.
    return <output id={id}>curator</output>;
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
