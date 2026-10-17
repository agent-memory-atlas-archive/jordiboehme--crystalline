/**
 * The pure rules of the Reflection level beside a knowledge level (spec B5),
 * kept apart from the select that draws them.
 */

import type { ReflectionLevel } from "../api/model";

/** Every stored Reflection level, least to most. */
export const REFLECTION_LEVELS: ReflectionLevel[] = [
  "default",
  "reader",
  "contributor",
];

export const WORDS: Record<ReflectionLevel, string> = {
  default: "as knowledge",
  reader: "reader",
  contributor: "contributor",
};

/** Whether a knowledge level curates the Reflection, so the choice is implied. */
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
export function levelsFor(knowledge: string): ReflectionLevel[] {
  return knowledge === "none"
    ? REFLECTION_LEVELS.filter((level) => level !== "default")
    : REFLECTION_LEVELS;
}

/** The Reflection level to send when the knowledge level becomes `knowledge`. */
export function raiseForNone(
  knowledge: string,
  reflection: ReflectionLevel,
): ReflectionLevel {
  return knowledge === "none" && reflection === "default"
    ? "reader"
    : reflection;
}

/** The words a stored Reflection level reads as, for a row that may not change it. */
export function reflectionWords(
  knowledge: string,
  reflection: ReflectionLevel,
): string {
  return curates(knowledge) ? "curator" : WORDS[reflection];
}

/**
 * The Reflection choice to keep when the knowledge level becomes `knowledge`.
 * A curating level implies the Reflection, so a stale reader or contributor
 * choice is dropped to `default` rather than sent unseen; `none` is raised.
 */
export function reflectionAfter(
  knowledge: string,
  reflection: ReflectionLevel,
): ReflectionLevel {
  return curates(knowledge) ? "default" : raiseForNone(knowledge, reflection);
}
