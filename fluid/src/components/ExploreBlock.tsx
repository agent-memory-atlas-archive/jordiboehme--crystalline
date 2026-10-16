/**
 * Two other ways of looking at the engram, as quiet rows in the details rail.
 *
 * Each row opens a panel that lives under the prose (the neighborhood graph,
 * and what an agent is taught): the rail only holds the switch. The rows keep
 * the names the old disclosure buttons had, "Show the neighborhood" and "Show
 * what an agent is taught", flipping to "Hide ..." while their panel is open,
 * and they carry `aria-expanded` and `aria-controls` the same way.
 */

import type { LucideIcon } from "lucide-react";
import { Eye, Network } from "lucide-react";

import { FOCUS_RING, RAIL_LABEL } from "./primitives";

/** The ids of the two panels, which the rows control. */
export const GRAPH_PANEL_ID = "engram-graph-panel";
export const AGENTS_EYE_PANEL_ID = "engram-agents-eye-panel";

export interface ExploreBlockProps {
  graphOpen: boolean;
  onGraph: () => void;
  eyeOpen: boolean;
  onEye: () => void;
}

export function ExploreBlock({
  graphOpen,
  onGraph,
  eyeOpen,
  onEye,
}: ExploreBlockProps) {
  return (
    <section aria-label="Explore" className="text-sm">
      <h2 className={`mb-2 ${RAIL_LABEL}`}>Explore</h2>
      <ul className="-mx-2 flex flex-col">
        <li>
          <Row
            icon={Network}
            open={graphOpen}
            controls={GRAPH_PANEL_ID}
            onClick={onGraph}
            label={
              graphOpen ? "Hide the neighborhood" : "Show the neighborhood"
            }
          />
        </li>
        <li>
          <Row
            icon={Eye}
            open={eyeOpen}
            controls={AGENTS_EYE_PANEL_ID}
            onClick={onEye}
            label={
              eyeOpen
                ? "Hide what an agent is taught"
                : "Show what an agent is taught"
            }
          />
        </li>
      </ul>
    </section>
  );
}

function Row({
  icon: Icon,
  open,
  controls,
  onClick,
  label,
}: {
  icon: LucideIcon;
  open: boolean;
  controls: string;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onClick}
      className={`flex min-h-11 w-full md:min-h-8 items-center gap-2 rounded-[7px] px-2 text-left text-ink-3 hover:bg-sunken hover:text-ink ${FOCUS_RING}`}
    >
      <Icon
        aria-hidden="true"
        size={16}
        strokeWidth={1.75}
        className="text-faint"
      />
      {label}
    </button>
  );
}
