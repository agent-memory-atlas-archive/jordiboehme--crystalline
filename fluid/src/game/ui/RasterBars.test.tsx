import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { burstsAtMs } from "../audio/modem";
import { CONNECTING_LABEL, Connecting } from "./Connecting";
import { Opening } from "./Opening";
import { C64_BLUE, C64_LIGHT_BLUE } from "./DeviceRefusal";
import { BARS_IMAGE, C64_PALETTE, CYCLE_PX, barsOffset } from "./raster";

const NUMBER = "555-0142";
const FROM = burstsAtMs(NUMBER);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function bars(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>("[data-raster-bars]");
}

function reduceMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduce && query === "(prefers-reduced-motion: reduce)",
        media: query,
      }) as MediaQueryList,
  );
}

describe("the connecting screen's raster bars", () => {
  // Mutation caught: the bars from the first frame (before the high
  // tones), never, or not hidden from a screen reader.
  it("turns the border to bars when the bursts start, hidden from a screen reader", () => {
    render(<Connecting number={NUMBER} name="ENG" onDone={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: CONNECTING_LABEL });
    act(() => {
      vi.advanceTimersByTime(FROM - 1);
    });
    expect(bars(dialog)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const layer = bars(dialog);
    expect(layer).not.toBeNull();
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(layer?.style.backgroundImage).toContain("linear-gradient");
    // The live region and the accessible name are as they were.
    expect(dialog.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: CONNECTING_LABEL })).toBe(dialog);
  });

  // Mutation caught: the bars drawn once and never moved, or moved by a
  // React render per frame instead of the frame loop.
  it("moves the bars every animation frame", () => {
    const frames = vi.spyOn(window, "requestAnimationFrame");
    render(<Connecting number={NUMBER} name="ENG" onDone={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(FROM);
    });
    expect(frames).toHaveBeenCalled();
    const layer = bars(document.body);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const first = layer?.style.backgroundPosition;
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(layer?.style.backgroundPosition).not.toBe(first);
    expect(frames.mock.calls.length).toBeGreaterThan(5);
  });

  // Mutation caught: the bars animated for a viewer who asked for less
  // motion, or dropped for them instead of shown still.
  it("shows still bars and asks for no frame with reduced motion", () => {
    reduceMotion(true);
    const frames = vi.spyOn(window, "requestAnimationFrame");
    render(<Connecting number={NUMBER} name="ENG" onDone={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(FROM + 500);
    });
    const layer = bars(document.body);
    expect(layer).not.toBeNull();
    expect(frames).not.toHaveBeenCalled();
    const still = layer?.style.backgroundPosition;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(layer?.style.backgroundPosition).toBe(still);
  });

  // Mutation caught: the preference read once, so a change while the
  // screen shows is ignored, or its listener left on the query after the
  // screen went.
  it("follows a change of the reduced-motion preference", () => {
    let reduce = false;
    let listener: (() => void) | null = null;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return reduce && query === "(prefers-reduced-motion: reduce)";
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => {
        listener = fn;
      },
      removeEventListener: () => {
        listener = null;
      },
    }));
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const view = render(
      <Connecting number={NUMBER} name="ENG" onDone={vi.fn()} />,
    );
    act(() => {
      vi.advanceTimersByTime(FROM + 100);
    });
    const layer = bars(document.body);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const moving = layer?.style.backgroundPosition;
    reduce = true;
    act(() => {
      listener?.();
    });
    const calls = frames.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(frames.mock.calls.length).toBe(calls);
    expect(layer?.style.backgroundPosition).toBe(moving);
    reduce = false;
    act(() => {
      listener?.();
      vi.advanceTimersByTime(300);
    });
    expect(layer?.style.backgroundPosition).not.toBe(moving);
    // The screen going takes the listener down with it.
    expect(listener).not.toBeNull();
    view.unmount();
    expect(listener).toBeNull();
  });

  // Mutation caught: the frame loop or the turn-on timer left running
  // after the screen went.
  it("stops the frame loop and its timer when the screen goes", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const view = render(
      <Connecting number={NUMBER} name="ENG" onDone={vi.fn()} />,
    );
    act(() => {
      vi.advanceTimersByTime(FROM + 100);
    });
    view.unmount();
    expect(cancel).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    // Gone before the bars turned on: no timer left either.
    const early = render(
      <Connecting number={NUMBER} name="ENG" onDone={vi.fn()} />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    early.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // Mutation caught: the bars on the opening screen too.
  it("leaves the opening screen's border plain", () => {
    render(<Opening onDone={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(FROM + 500);
    });
    expect(bars(document.body)).toBeNull();
  });

  // Mutation caught: a scroll that turns back (the sway outrunning it), or
  // one so fast a point of the border goes dark to light and back more
  // than three times a second (WCAG 2.3.1).
  it("scrolls forward, never through a whole cycle in a third of a second", () => {
    for (let ms = 0; ms < 4000; ms += 5) {
      const step = barsOffset(ms + 5) - barsOffset(ms);
      expect(step, `${ms}`).toBeGreaterThan(0);
      expect(barsOffset(ms + 334) - barsOffset(ms), `${ms}`).toBeLessThan(
        CYCLE_PX,
      );
    }
  });

  // Mutation caught: a colour left out of the bars, or a palette that
  // does not match the screens' own blues.
  it("draws all sixteen C64 colours, the screens' blues among them", () => {
    expect(new Set(C64_PALETTE).size).toBe(16);
    expect(C64_PALETTE).toContain(C64_BLUE);
    expect(C64_PALETTE).toContain(C64_LIGHT_BLUE);
    for (const colour of C64_PALETTE) expect(BARS_IMAGE).toContain(colour);
  });
});
