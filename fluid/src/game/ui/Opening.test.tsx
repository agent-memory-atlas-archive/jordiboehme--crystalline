import { act, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BLINK_MS,
  OPENING_BLINKS,
  OPENING_LABEL,
  OPENING_TEXT,
  Opening,
} from "./Opening";
import { TYPE_CPS } from "./c64Clock";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const TYPED_MS = (OPENING_TEXT.length * 1000) / TYPE_CPS;
// The time of `n` characters, with a tick of margin: the clock ticks on
// whole milliseconds, a little under one character.
const charsMs = (n: number) => Math.ceil((n * 1000) / TYPE_CPS) + 33;
const END_MS = TYPED_MS + OPENING_BLINKS * 2 * BLINK_MS;

function frame() {
  return screen.getByRole("dialog", { name: OPENING_LABEL });
}

function cursor(): string | null {
  return (
    frame().querySelector("[data-cursor]")?.getAttribute("data-cursor") ?? null
  );
}

function typedText(): string {
  const panel = frame().querySelector("[aria-hidden]")!;
  return (panel.textContent ?? "").replace(/[█\u00a0]/g, "");
}

describe("Opening", () => {
  it("asks the question in capitals", () => {
    expect(OPENING_TEXT).toBe("SHALL WE PLAY A GAME?");
  });

  // Mutation caught: the line printed at once, or at another rate.
  it("types the line one character at a time at TYPE_CPS", () => {
    render(<Opening onDone={vi.fn()} />);
    expect(typedText()).toBe("");
    act(() => {
      vi.advanceTimersByTime(charsMs(5));
    });
    expect(typedText()).toBe(OPENING_TEXT.slice(0, 5));
    act(() => {
      vi.advanceTimersByTime(Math.ceil(TYPED_MS));
    });
    expect(typedText()).toBe(OPENING_TEXT);
  });

  // Mutation caught: done when the line is typed (no blinks), the blink
  // count off, or onDone called more than once.
  it("blinks the cursor OPENING_BLINKS times, then is done once", () => {
    const onDone = vi.fn();
    render(<Opening onDone={onDone} />);
    act(() => {
      vi.advanceTimersByTime(Math.ceil(TYPED_MS) + 1);
    });
    expect(onDone).not.toHaveBeenCalled();
    let blinks = 0;
    let last = cursor();
    const step = 20;
    const until = Math.floor(END_MS - TYPED_MS) - 60;
    for (let t = 0; t < until; t += step) {
      act(() => {
        vi.advanceTimersByTime(step);
      });
      const now = cursor();
      if (last === "on" && now === "off") blinks += 1;
      last = now;
    }
    expect(blinks).toBe(OPENING_BLINKS);
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(END_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // Mutation caught: the auto-repeat of a key held before the screen showed
  // skips it, or is let through to act in the station.
  it("ignores the auto-repeat of a held key but still cancels it", () => {
    const onDone = vi.fn();
    render(<Opening onDone={onDone} />);
    const held = new KeyboardEvent("keydown", {
      key: "a",
      code: "KeyA",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(held);
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(held.defaultPrevented).toBe(true);
    fireEvent.keyDown(document.body, { key: "a", code: "KeyA" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // Mutation caught: the blink rendering the screen again.
  it("does not render again through the blinks", () => {
    let renders = 0;
    render(
      <Profiler
        id="opening"
        onRender={() => {
          renders += 1;
        }}
      >
        <Opening onDone={vi.fn()} />
      </Profiler>,
    );
    act(() => {
      vi.advanceTimersByTime(Math.ceil(TYPED_MS) + 100);
    });
    const typedRenders = renders;
    expect(cursor()).toBe("on");
    act(() => {
      vi.advanceTimersByTime(BLINK_MS);
    });
    expect(cursor()).toBe("off");
    act(() => {
      vi.advanceTimersByTime(BLINK_MS);
    });
    expect(cursor()).toBe("on");
    expect(renders).toBe(typedRenders);
  });

  // Mutation caught: the typing timed by `Date.now()`.
  it("types by performance.now(), not by the wall clock", () => {
    render(<Opening onDone={vi.fn()} />);
    vi.setSystemTime(Date.now() - 3_600_000);
    act(() => {
      vi.advanceTimersByTime(charsMs(5));
    });
    expect(typedText()).toBe(OPENING_TEXT.slice(0, 5));
  });

  // Mutation caught: the `preventDefault` dropped (an Esc that skips the
  // screen would also pause the station behind it), or onDone per key.
  it("skips on any key, once, and cancels the key it took", () => {
    const onDone = vi.fn();
    render(<Opening onDone={onDone} />);
    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(esc);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);
    fireEvent.keyDown(document.body, { key: "a", code: "KeyA" });
    fireEvent.click(frame());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("skips on a click, once", () => {
    const onDone = vi.fn();
    render(<Opening onDone={onDone} />);
    fireEvent.click(frame());
    fireEvent.click(frame());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // Mutation caught: every key taken, browser shortcuts included.
  it("lets browser shortcuts through: neither cancelled nor a skip", () => {
    const onDone = vi.fn();
    render(<Opening onDone={onDone} />);
    const shortcuts: KeyboardEventInit[] = [
      { key: "r", code: "KeyR", metaKey: true },
      { key: "l", code: "KeyL", ctrlKey: true },
      { key: "ArrowLeft", code: "ArrowLeft", altKey: true },
      { key: "F1", code: "F1" },
      { key: "F5", code: "F5" },
      { key: "F12", code: "F12" },
    ];
    for (const init of shortcuts) {
      const event = new KeyboardEvent("keydown", {
        ...init,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        document.body.dispatchEvent(event);
      });
      expect(event.defaultPrevented, init.code).toBe(false);
      expect(onDone, init.code).not.toHaveBeenCalled();
    }
    fireEvent.keyDown(document.body, { key: "Shift", code: "ShiftLeft" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // Mutation caught: the typed characters announced one by one, no live
  // region, or one mounted with its text.
  it("hides the typed characters and hands the whole line to a live region", () => {
    render(<Opening onDone={vi.fn()} />);
    const live = frame().querySelectorAll('[aria-live="polite"]');
    expect(live).toHaveLength(1);
    const region = live[0]!;
    expect(region.textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(charsMs(5));
    });
    expect(region.textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(Math.ceil(TYPED_MS));
    });
    expect(region.textContent).toBe(OPENING_TEXT);
    for (const p of frame().querySelectorAll("p")) {
      if (region.contains(p)) continue;
      expect(p.closest("[aria-hidden]")).not.toBeNull();
    }
  });

  it("takes the focus when it shows and gives it back when it goes", () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    try {
      const view = render(<Opening onDone={vi.fn()} />);
      expect(document.activeElement).toBe(frame());
      view.unmount();
      expect(document.activeElement).toBe(before);
    } finally {
      before.remove();
    }
  });

  it("stops its timers on unmount", () => {
    const onDone = vi.fn();
    const view = render(<Opening onDone={onDone} />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(END_MS);
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});
