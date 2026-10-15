/**
 * The two draft keys of a reflection's editor. Apart from `provider.ts` so a
 * screen that only needs the keys (the page's delete and move) does not pull
 * in the collaboration libraries.
 */

/**
 * The key a reflection room's drafts are kept under: `reflection:` plus the
 * path inside `reflections/`. A client key only: the server keys the room by
 * the reflection's path and greets with the bare path. It can never be an
 * engram's draft key, because a permalink never holds `:`.
 */
export function reflectionRoomKey(path: string): string {
  return `reflection:${path}`;
}

/**
 * The key of text set aside for the next mount of a reflection's editor (an
 * earlier session's copy on offer, or this tab's text when the file version
 * was taken). Apart from {@link reflectionRoomKey}, which follows the live
 * text, so that copy can never overwrite an offer. It holds `:` like the room
 * key, so it is never an engram's key either, and the two prefixes differ
 * before the path starts.
 */
export function reflectionOfferKey(path: string): string {
  return `reflection-offer:${path}`;
}
