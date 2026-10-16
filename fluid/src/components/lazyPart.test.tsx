/**
 * A lazy part whose chunk fails to load: a short message, "Try again" calls
 * `import()` again, and only a chunk failure is caught.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component } from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lazyPart } from "./lazyPart";

function Body({ name }: { name: string }) {
  return <p>Loaded {name}</p>;
}

/** Catches whatever the part lets through. */
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
});

describe("lazyPart", () => {
  it("shows the fallback, then the part", async () => {
    const Part = lazyPart(() => Promise.resolve({ default: Body }));
    render(<Part fallback={<p>Waiting</p>} name="one" />);
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(await screen.findByText("Loaded one")).toBeInTheDocument();
  });

  it("offers Try again after a failed import and imports again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi
      .fn<() => Promise<{ default: typeof Body }>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch module"))
      .mockResolvedValue({ default: Body });
    const Part = lazyPart(load);

    render(<Part fallback={<p>Waiting</p>} name="two" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This part did not load. Try again.");
    expect(load).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Loaded two")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the message when the second import fails too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi
      .fn<() => Promise<{ default: typeof Body }>>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("still offline"))
      .mockResolvedValue({ default: Body });
    const Part = lazyPart(load);
    render(<Part fallback={null} name="three" />);

    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("alert");
    expect(load).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Loaded three")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("lets a dialog be closed when its chunk is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    const Part = lazyPart<{ onClose: () => void }>(() =>
      Promise.reject(new TypeError("offline")),
    );
    render(<Part overlay fallback={null} onClose={onClose} />);

    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not catch an error thrown while the part renders", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never {
      throw new Error("render bug");
    }
    const Part = lazyPart(() => Promise.resolve({ default: Broken }));
    render(
      <Outer>
        <Part fallback={null} />
      </Outer>,
    );
    expect(await screen.findByText("outer caught render bug")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
