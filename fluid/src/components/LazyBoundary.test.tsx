/**
 * What a lazy part shows when its chunk never arrives, and what it does not
 * catch: a failed import becomes a reload prompt in the part's place, while
 * an ordinary render error still escapes the boundary.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component } from "react";
import type { ReactNode } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router";
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
      <MemoryRouter>
        <p>Above</p>
        <LazyBoundary fallback={<p>Loading</p>}>
          <Missing />
        </LazyBoundary>
      </MemoryRouter>,
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
      <MemoryRouter>
        <Outer>
          <LazyBoundary fallback={<p>Loading</p>}>
            <Lazy />
          </LazyBoundary>
        </Outer>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("outer caught a bug in the screen"),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the prompt when the reader moves to another route", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Missing = lazyChunk(() =>
      Promise.reject(
        new TypeError("Failed to fetch dynamically imported module"),
      ),
    );
    const Present = lazyChunk(() =>
      Promise.resolve({ default: () => <p>The graph</p> }),
    );

    // Both routes draw their boundary at the same place in the tree, the way
    // the app's routes do under the frame's outlet, so React keeps one
    // boundary instance across the move; only the location tells it to let
    // go of the old failure.
    render(
      <MemoryRouter initialEntries={["/search"]}>
        <Link to="/graph">Graph</Link>
        <Link to="/search">Search</Link>
        <Routes>
          <Route
            path="/search"
            element={
              <LazyBoundary fallback={<p>Loading</p>}>
                <Missing />
              </LazyBoundary>
            }
          />
          <Route
            path="/graph"
            element={
              <LazyBoundary fallback={<p>Loading</p>}>
                <Present />
              </LazyBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("link", { name: "Graph" }));

    expect(await screen.findByText("The graph")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();

    // Back on the failed route the prompt returns: React keeps a lazy
    // component's rejected import for the life of the page, so only a
    // reload can fetch the chunk again. That is the prompt's whole advice.
    await userEvent.click(screen.getByRole("link", { name: "Search" }));
    expect(await screen.findByRole("alert")).toBeVisible();
  });
});
