/**
 * Colour codes in inline code: `#0969DA`, `#09f`, `rgb(9, 105, 218)` or
 * `hsl(212, 92%, 45%)`, alone in the span, get a small swatch before them.
 * Anything else in the span (`#define`, `color: #09f`) is code and no more.
 */

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const ALPHA = String.raw`(?:\s*,\s*(?:0|1|0?\.\d+|\d{1,3}%))?`;

const RGB = new RegExp(
  String.raw`^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})${ALPHA}\s*\)$`,
  "i",
);

const HSL = new RegExp(
  String.raw`^hsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*,\s*(\d{1,3}(?:\.\d+)?)%${ALPHA}\s*\)$`,
  "i",
);

function within(values: (string | undefined)[], most: number): boolean {
  return values.every((value) => Number(value) <= most);
}

/** The colour an inline code span holds, or null when it holds anything else. */
export function colourOf(code: string): string | null {
  const text = code.trim();
  if (HEX.test(text)) {
    return text;
  }
  const rgb = RGB.exec(text);
  if (rgb !== null) {
    return within(rgb.slice(1, 4), 255) ? text : null;
  }
  const hsl = HSL.exec(text);
  if (hsl !== null) {
    return within([hsl[1]], 360) && within(hsl.slice(2, 4), 100) ? text : null;
  }
  return null;
}
