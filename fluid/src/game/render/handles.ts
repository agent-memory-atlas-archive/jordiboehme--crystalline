/**
 * The handles some terminals show (0.25.1): about one terminal in
 * `HANDLE_EVERY` carries a login line as its screen's last row. Which
 * terminal, and which of the lines, comes from the terminal's own seed, so
 * a terminal shows the same line every time it is built. It lives on the
 * render side since it reads `MARKS`; the generator never imports it.
 */

import { createRng, seedFor } from "../core/seed";
import type { Fixture } from "../world/types";
import { MARKS } from "./models/marks";

/** About 1 terminal in this many shows a handle. */
export const HANDLE_EVERY = 24;

/** The handle line the terminal `fixture` shows, or null. */
export function handleOf(fixture: Fixture): string | null {
  if (fixture.kind !== "terminal") return null;
  const rng = createRng(seedFor("handle", fixture.seed));
  const take = rng.chance(1 / HANDLE_EVERY);
  const line = rng.pick(MARKS.handleLines);
  return take ? line : null;
}
