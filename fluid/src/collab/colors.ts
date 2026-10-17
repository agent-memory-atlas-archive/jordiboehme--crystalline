/**
 * Who is who in a room, in one color each.
 *
 * The color is derived from the account name rather than handed out by the
 * server: every participant computes the same color for the same person
 * without a round trip, and a reconnect never repaints the room.
 */

/** The palette y-codemirror.next paints cursors and selections with; the
 *  light variant is the selection background (the upstream 0x33 alpha
 *  convention). Chosen for contrast on both schemes. Eight distinct hues for
 *  telling people apart, not the app's accent - teal (`#14b8a6`) stays put
 *  here even though the accent scale moved off teal, and none of the eight
 *  is retuned to track it. */
const PALETTE = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#ec4899",
] as const;

/** A deterministic presence color per account name, from a fixed palette. */
export function presenceColor(name: string): {
  color: string;
  colorLight: string;
} {
  let hash = 0;
  for (const unit of name) {
    hash = (hash * 31 + unit.charCodeAt(0)) >>> 0;
  }
  const color = PALETTE[hash % PALETTE.length] ?? PALETTE[0];
  return { color, colorLight: `${color}33` };
}

/**
 * The text color that reads on a presence color: near-black on the bright
 * palette above (every entry clears 4.5:1 with it), white on anything dark a
 * peer may have sent instead.
 */
export function inkOn(color: string): string {
  const channels = channelsOf(color);
  if (channels === null) {
    return "#0b0d13";
  }
  const linear = (value: number) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  const [red, green, blue] = channels;
  const luminance =
    0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  // Where the two contrasts cross for near-black (L 0.004) and white.
  return luminance > 0.18 ? "#0b0d13" : "#ffffff";
}

/** A `#rrggbb` color or the `rgb(r, g, b)` a browser hands back, as numbers. */
function channelsOf(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})/i.exec(color)?.[1];
  if (hex !== undefined) {
    return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color);
  if (rgb !== null) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}
