/**
 * What a lazy part shows when its chunk never arrives, and what it does not
 * catch: a failed import becomes a reload prompt in the part's place, while
 * an ordinary render error still escapes the boundary.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lazyChunk } from "../lazyChunk";
import { LazyBoundary } from "./LazyBoundary";

/** Catches whatever the boundary under test lets through. */
class Outer extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    return this.state.error === null ? (
      this.props.children
    ) : (
      <p>outer caught {(this.state.error as Error).message}</p>
    );
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LazyBoundary", () => {
  it("draws a reload prompt in place of a part whose import is refused", async () => {
    // React reports the caught error to the console; that is expected here.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const Missing = lazyChunk(() =>
      Promise.reject(
        new TypeError("Failed to fetch dynamically imported module"),
      ),
    );

    render(
      <>
        <p>Above</p>
        <LazyBoundary fallback={<p>Loading</p>}>
          <Missing />
        </LazyBoundary>
      </>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This part of Fluid could not load. Reload the page to get the newest version.",
    );
    // Only the part is replaced; the page around it stays.
    expect(screen.getByText("Above")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("lets an ordinary render error through", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): ReactNode {
      throw new Error("a bug in the screen");
    }
    const Lazy = lazyChunk(() => Promise.resolve({ default: Broken }));

    render(
      <Outer>
        <LazyBoundary fallback={<p>Loading</p>}>
          <Lazy />
        </LazyBoundary>
      </Outer>,
    );

    expect(
      await screen.findByText("outer caught a bug in the screen"),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
