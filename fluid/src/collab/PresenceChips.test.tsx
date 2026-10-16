/**
 * The room's presence row: a chip a screen reader announces once.
 *
 * The server already appends "(agent)" onto a participant's name (Task 15 fix
 * round 1, M2), so the glyph beside an agent's chip is decoration for sighted
 * readers rather than a second announcement of the same word.
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CollabParticipant } from "./useCollabSession";
import { inkOn } from "./colors";
import { PresenceChips } from "./PresenceChips";

const PARTICIPANTS: CollabParticipant[] = [
  { name: "Ada (agent)", color: "#0ea5e9", self: false, agent: true },
  { name: "Jordi", color: "#22c55e", self: true, agent: false },
];

describe("PresenceChips", () => {
  it("hides the agent glyph from assistive tech and lets the chip text carry the word", () => {
    render(<PresenceChips participants={PARTICIPANTS} />);
    const glyph = document.querySelector("svg");
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).not.toHaveAttribute("role");
    expect(glyph).not.toHaveAttribute("aria-label");
    expect(screen.getByText("Ada (agent)")).toBeInTheDocument();
  });

  it("draws each person as an avatar in their own color, the list naming everyone", () => {
    render(<PresenceChips participants={PARTICIPANTS} />);
    const list = screen.getByRole("list", {
      name: "In this session: Ada (agent), Jordi (you)",
    });
    const [agent, self] = within(list).getAllByRole("listitem");
    expect(self).toHaveStyle({ backgroundColor: "#22c55e" });
    // The initial is drawn for the eye; the name is the text.
    expect(self).toHaveTextContent("JJordi");
    expect(within(self as HTMLElement).getByText("J")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // No dot of any color marks the local author: "(you)" is in the name.
    expect(self?.querySelector(".rounded-full.size-2")).toBeNull();
    expect(agent).toHaveStyle({ backgroundColor: "#0ea5e9" });
  });

  it("picks an ink that reads on the presence color", () => {
    // Bright palette colors take near-black, a dark color takes white.
    expect(inkOn("#f59e0b")).toBe("#0b0d13");
    expect(inkOn("#8b5cf6")).toBe("#0b0d13");
    expect(inkOn("#1e293b")).toBe("#ffffff");
    expect(inkOn("not a color")).toBe("#0b0d13");
    // The form a browser hands back from an inline style.
    expect(inkOn("rgb(245, 158, 11)")).toBe("#0b0d13");
    expect(inkOn("rgb(30, 41, 59)")).toBe("#ffffff");
  });
});
