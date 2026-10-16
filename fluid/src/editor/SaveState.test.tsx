/**
 * The save state's one status region: solo states and Offline are announced,
 * a room's own saving and saved are shown without being read out.
 */

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RECONNECTED_MS, SaveState } from "./SaveState";

describe("SaveState", () => {
  it("announces a solo state in its status region", () => {
    const { rerender } = render(<SaveState state={null} />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    rerender(<SaveState state="unsaved" />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Unsaved changes");
    rerender(<SaveState state="saved" />);
    expect(region).toHaveTextContent("Saved");
  });

  it("shows a room's saving and saved without announcing them", () => {
    const { rerender } = render(<SaveState state="saving" room />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    expect(screen.getByText("Saving")).toBeVisible();
    rerender(<SaveState state="saved" room />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toBeEmptyDOMElement();
    expect(screen.getByText("Saved")).toBeVisible();
  });

  it("announces Offline in a room", () => {
    const { rerender } = render(<SaveState state="saved" room />);
    const region = screen.getByRole("status");
    rerender(<SaveState state="offline" room />);
    expect(region).toHaveTextContent("Offline, kept on this device");
  });

  it("says Connected again once when a room comes back, then goes quiet", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<SaveState state="offline" room />);
      const region = screen.getByRole("status");
      rerender(<SaveState state="saved" room />);
      expect(region).toHaveTextContent("Connected again.");
      // Still shown as Saved for the eye.
      expect(screen.getByText("Saved")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(RECONNECTED_MS);
      });
      expect(region).toBeEmptyDOMElement();
      rerender(<SaveState state="saving" room />);
      expect(region).toBeEmptyDOMElement();
    } finally {
      vi.useRealTimers();
    }
  });
});
