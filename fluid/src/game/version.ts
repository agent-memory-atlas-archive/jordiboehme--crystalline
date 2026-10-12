/**
 * The generator's version, folded into every seed the station derives.
 *
 * The station is regenerated from the content on every visit and nothing is
 * stored, so the only thing that can make a room look different while its
 * engram stays the same is a change to the generator itself. Bumping this
 * number is how such a change is made on purpose: every seed moves with it,
 * and the golden rooms in `world/golden/` are rewritten in the same commit.
 * The number moves once per release that changes the world, not once per
 * change: the first generator change of a release bumps it, and later
 * changes within the same unreleased release may move the goldens again
 * without a second bump, since no released station saw the rooms in
 * between. A golden move in a release that did not bump this is a bug.
 */
export const GAME_VERSION = 4;
