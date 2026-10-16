/**
 * The address a link out of the app prints after its words (the print sheet
 * in `index.css` draws it from `data-print-url`).
 */

/** The longest address printed in full; a longer one ends in an ellipsis. */
export const PRINT_URL_MAX = 80;

/**
 * The printed address of a link: a web address without its scheme, a mail
 * address without `mailto:`, cut to {@link PRINT_URL_MAX} characters. Null
 * for any other link, and when the words already are the address.
 */
export function printUrl(href: string, words: string): string | null {
  const bare = (text: string) =>
    text
      .trim()
      .replace(/^(https?:\/\/|mailto:)/i, "")
      .replace(/\/$/, "");
  if (!/^(https?:\/\/|mailto:)/i.test(href)) {
    return null;
  }
  const shown = bare(href);
  if (shown === "" || bare(words) === shown) {
    return null;
  }
  return shown.length > PRINT_URL_MAX
    ? `${shown.slice(0, PRINT_URL_MAX - 1)}…`
    : shown;
}
