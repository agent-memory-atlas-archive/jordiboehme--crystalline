/**
 * The editor's safety net: the buffer snapshots to browser storage until a
 * successful save, so a crash, a closed tab or an in-app navigation loses at
 * most a second of typing. Per user and per engram, because two accounts on
 * one browser are two people, and offering one the other's half-thought would
 * be worse than offering nothing.
 *
 * Storage failures are swallowed on write and read: a full or blocked
 * localStorage degrades to "no draft", never to a broken editor.
 */

export interface Draft {
  /** The full buffer text as last seen. */
  content: string;
  /** The server checksum the session was based on when this was written. */
  baseChecksum: string;
  /** When the snapshot was taken, RFC 3339. */
  savedAt: string;
}

/** How long a pause in typing writes a snapshot, ms. */
export const DRAFT_DEBOUNCE_MS = 1000;

/** The storage key of one person's draft of one engram. */
export function draftKey(
  user: string,
  domain: string,
  permalink: string,
): string {
  return `fluid.draft.${user}.${domain}/${permalink}`;
}

/** The stored draft, or null when there is none or it will not parse. */
export function readDraft(
  user: string,
  domain: string,
  permalink: string,
): Draft | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(draftKey(user, domain, permalink));
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    return parseDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseDraft(value: unknown): Draft | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const parsed = value as Partial<Draft>;
  if (
    typeof parsed.content !== "string" ||
    typeof parsed.baseChecksum !== "string"
  ) {
    return null;
  }
  return {
    content: parsed.content,
    baseChecksum: parsed.baseChecksum,
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
  };
}

/** Write a snapshot; a refused storage write is a lost snapshot, not an error. */
export function writeDraft(
  user: string,
  domain: string,
  permalink: string,
  draft: Draft,
): void {
  try {
    localStorage.setItem(
      draftKey(user, domain, permalink),
      JSON.stringify(draft),
    );
  } catch {
    // Full or blocked storage: the unload prompt still guards the work.
  }
}

/** Drop the snapshot, after a successful save or an explicit discard. */
export function clearDraft(
  user: string,
  domain: string,
  permalink: string,
): void {
  try {
    localStorage.removeItem(draftKey(user, domain, permalink));
  } catch {
    // Nothing to do: an unremovable draft re-offers itself, harmlessly.
  }
}

/**
 * Carry one draft to the address its document moved to. Unsaved text is
 * never dropped: a draft already standing at the new address stays as it is,
 * and then the old one stays where it was too.
 */
export function moveDraft(
  user: string,
  from: { domain: string; slot: string },
  to: { domain: string; slot: string },
): void {
  if (from.domain === to.domain && from.slot === to.slot) {
    return;
  }
  if (
    readDraft(user, from.domain, from.slot) === null ||
    readDraft(user, to.domain, to.slot) !== null
  ) {
    return;
  }
  // The stored text as it is, so a slot holding a history of offers (see
  // `readOffers`) moves whole rather than as its newest entry alone.
  try {
    const raw = localStorage.getItem(draftKey(user, from.domain, from.slot));
    if (raw === null) {
      return;
    }
    localStorage.setItem(draftKey(user, to.domain, to.slot), raw);
  } catch {
    return; // nothing moved: the draft stays where it was
  }
  clearDraft(user, from.domain, from.slot);
}

/** How many texts one slot keeps on offer. */
export const OFFER_LIMIT = 3;

/**
 * A short history of texts set aside for a later offer, newest first, at
 * most {@link OFFER_LIMIT}. Stored as one draft, the newest, whose `earlier`
 * field holds the older ones: whatever reads a slot as one draft (a move, a
 * delete, an older build) still finds the newest text there, and a slot
 * written before the history existed reads as a history of one. A newer
 * text no longer replaces an offer nobody answered; the oldest of four goes.
 */
export function readOffers(
  user: string,
  domain: string,
  slot: string,
): Draft[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(draftKey(user, domain, slot));
  } catch {
    return [];
  }
  if (raw === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { earlier?: unknown };
    const newest = parseDraft(parsed);
    if (newest === null) {
      return [];
    }
    const earlier = Array.isArray(parsed.earlier)
      ? parsed.earlier.flatMap((entry) => {
          const draft = parseDraft(entry);
          return draft === null ? [] : [draft];
        })
      : [];
    return [newest, ...earlier].slice(0, OFFER_LIMIT);
  } catch {
    return [];
  }
}

/** Store a history of offers, newest first; an empty one clears the slot. */
function writeOffers(
  user: string,
  domain: string,
  slot: string,
  offers: readonly Draft[],
): void {
  const [newest, ...earlier] = offers.slice(0, OFFER_LIMIT);
  if (newest === undefined) {
    clearDraft(user, domain, slot);
    return;
  }
  try {
    localStorage.setItem(
      draftKey(user, domain, slot),
      JSON.stringify({ ...newest, earlier }),
    );
  } catch {
    // Full or blocked storage: as for a single draft.
  }
}

/**
 * Set a text aside as the newest offer. One that says the same as an
 * offer already kept takes that offer's place rather than standing twice.
 */
export function addOffer(
  user: string,
  domain: string,
  slot: string,
  draft: Draft,
): void {
  const rest = readOffers(user, domain, slot).filter(
    (offer) => offer.content !== draft.content,
  );
  writeOffers(user, domain, slot, [draft, ...rest]);
}

/**
 * Drop the offers in `gone`, matched by text and time. Any other offer in
 * the slot (set aside after these were shown) stays for a later offer.
 */
export function removeOffers(
  user: string,
  domain: string,
  slot: string,
  gone: readonly Draft[],
): void {
  const offers = readOffers(user, domain, slot);
  const left = offers.filter(
    (offer) =>
      !gone.some(
        (g) => g.content === offer.content && g.savedAt === offer.savedAt,
      ),
  );
  if (left.length !== offers.length) {
    writeOffers(user, domain, slot, left);
  }
}
