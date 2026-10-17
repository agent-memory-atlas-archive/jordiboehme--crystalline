/**
 * The one edit a reading page makes: one task box flipped in the file text.
 *
 * Pure and small on purpose. A reading page knows where a box starts (the
 * renderer maps the parser's offset back into the whole file) and hands
 * this the file it read, so what goes back to the server is that file with
 * three characters changed and every other byte as it was. A box that is
 * not where the offset says, or is the not-applicable `[~]`, is no box to
 * flip: the answer is null and the page reads the file again.
 */

/** The three task boxes that tick: open, done, done written with a capital. */
const TICKABLE = /^\[[ xX]\]$/;

/** The text with the task box at `offset` (the `[` of `[ ]`/`[x]`/`[X]`) set to `next`; null when no box is there. */
export function tickAt(
  text: string,
  offset: number,
  next: "[ ]" | "[x]",
): string | null {
  if (!Number.isInteger(offset) || offset < 0) {
    return null;
  }
  if (!TICKABLE.test(text.slice(offset, offset + 3))) {
    return null;
  }
  return `${text.slice(0, offset)}${next}${text.slice(offset + 3)}`;
}
