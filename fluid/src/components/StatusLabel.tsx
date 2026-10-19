/**
 * A status label in the text: `:status[In review]{blue}` (see
 * `markdown/directives.ts`). A small pill at cap height, a 1px ring and a
 * light tint in its colour (`.status-label` in `index.css`), the words in the
 * page's own ink, so its contrast is the page's. On paper it is outlined.
 */

import type { ReactNode } from "react";

import type { StatusColour } from "../markdown/directives";

export default function StatusLabel({
  colour,
  children,
}: {
  colour: StatusColour;
  children?: ReactNode;
}) {
  return (
    <span data-status={colour} className="status-label">
      {children}
    </span>
  );
}
