import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { READY_MS, Loading, ReadyFlash } from "./Loading";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A content area: the loader until `arrived`, then the content. */
function Area({
  arrived,
  cached = false,
}: {
  arrived: boolean;
  cached?: boolean;
}) {
  return (
    <main className="relative">
      {arrived || cached ? (
        <p>The content</p>
      ) : (
        <Loading label="Loading the engram" subject="Some Title" />
      )}
      <ReadyFlash />
    </main>
  );
}

describe("Loading", () => {
  it("shows the caps text to the eye and one plain sentence to a screen reader", () => {
    render(<Loading label="Loading the engram" subject="the-permalink" />);
    const status = screen.getByRole("status", { name: "Loading the engram" });
    const caps = status.querySelector("[aria-hidden]");
    expect(caps).not.toBeNull();
    expect(caps?.textContent).toBe("SEARCHING FOR THE-PERMALINKLOADING█");
    expect(status.getAttribute("data-loading")).toBe("full");
  });

  it("has a compact one-line variant", () => {
    render(<Loading compact label="Loading menu" />);
    const status = screen.getByRole("status", { name: "Loading menu" });
    expect(status.textContent).toBe("LOADING█");
    expect(status.getAttribute("data-loading")).toBe("compact");
  });

  it("draws a blinking block cursor, still under reduced motion (see the stylesheet test)", () => {
    render(<Loading label="x" subject="y" />);
    expect(document.querySelector(".loading-cursor")).not.toBeNull();
  });
});

describe("READY.", () => {
  it("appears when content replaces a shown loader, then goes after 400 ms", async () => {
    const { rerender } = render(<Area arrived={false} />);
    expect(screen.queryByText("READY.")).toBeNull();
    rerender(<Area arrived />);
    // The content is there on the same commit, before READY. is.
    expect(screen.getByText("The content")).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    const ready = screen.getByText("READY.");
    expect(ready).toHaveAttribute("aria-hidden", "true");
    // Laid over, not in the flow: it cannot move the layout.
    expect(ready.className).toContain("absolute");
    expect(ready.className).toContain("pointer-events-none");
    act(() => {
      vi.advanceTimersByTime(READY_MS - 1);
    });
    expect(screen.getByText("READY.")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("READY.")).toBeNull();
  });

  it("does not appear when the content was cached and no loader showed", async () => {
    render(<Area arrived={false} cached />);
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(READY_MS * 2);
    });
    expect(screen.queryByText("READY.")).toBeNull();
  });

  it("does not appear when one loader hands over to another", async () => {
    function Chain() {
      const [second, setSecond] = useState(false);
      return (
        <main className="relative">
          {second ? (
            <Loading label="Second" subject="b" />
          ) : (
            <Loading label="First" subject="a" />
          )}
          <button
            onClick={() => {
              setSecond(true);
            }}
          >
            next
          </button>
          <ReadyFlash />
        </main>
      );
    }
    render(<Chain />);
    await act(async () => {
      screen.getByText("next").click();
      await Promise.resolve();
    });
    expect(screen.queryByText("READY.")).toBeNull();
  });

  it("is not flashed by a compact loader", async () => {
    const { rerender } = render(
      <main>
        <Loading compact label="Loading menu" />
        <ReadyFlash />
      </main>,
    );
    rerender(
      <main>
        <p>menu</p>
        <ReadyFlash />
      </main>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("READY.")).toBeNull();
  });
});

describe("Skeleton (kept for the editors)", () => {
  it("is the same loader, searching for what the label names", async () => {
    const { Skeleton } = await import("./Skeleton");
    render(<Skeleton label="Loading the editor" />);
    const status = screen.getByRole("status", { name: "Loading the editor" });
    expect(status.textContent).toContain("SEARCHING FOR THE EDITOR");
  });
});
