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

  it("imports again when the part is mounted again after a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const load = vi
      .fn<() => Promise<{ default: typeof Body }>>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue({ default: Body });
    const Part = lazyPart(load);
    const first = render(<Part fallback={null} name="again" />);
    await screen.findByRole("alert");
    first.unmount();

    render(<Part fallback={null} name="again" />);
    expect(await screen.findByText("Loaded again")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("lets a dialog be closed when its chunk is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    const Part = lazyPart<{ onClose: () => void }>(() =>
      Promise.reject(new TypeError("offline")),
    );
    render(<Part overlay fallback={null} onClose={onClose} />);

    const card = await screen.findByRole("dialog", { name: "Not loaded" });
    expect(card).toHaveAttribute("aria-modal", "true");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("puts the focus on Try again, keeps it in the card and closes on Escape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    const Part = lazyPart<{ onClose: () => void }>(() =>
      Promise.reject(new TypeError("offline")),
    );
    render(<Part overlay fallback={null} onClose={onClose} />);

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(retry).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await userEvent.tab();
    expect(retry).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives the focus back to returnFocusTo on Close", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const opener = document.createElement("button");
    document.body.append(opener);
    const Part = lazyPart<{
      onClose: () => void;
      returnFocusTo: HTMLElement;
    }>(() => Promise.reject(new TypeError("offline")));
    render(
      <Part
        overlay
        fallback={null}
        onClose={() => {}}
        returnFocusTo={opener}
      />,
    );
    await screen.findByRole("dialog", { name: "Not loaded" });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("gives the focus back to what had it when the part mounted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const Part = lazyPart<{ onClose: () => void }>(() =>
      Promise.reject(new TypeError("offline")),
    );
    render(<Part overlay fallback={null} onClose={() => {}} />);
    await screen.findByRole("dialog", { name: "Not loaded" });
    expect(opener).not.toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("offers a reload after a second failure in a row", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const Part = lazyPart<object>(() => Promise.reject(new TypeError("gone")));
    render(<Part fallback={null} />);

    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: "Reload the page" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Reload the page" }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("logs the original error behind the message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("module threw while evaluating");
    const Part = lazyPart<object>(() => Promise.reject(cause));
    render(<Part fallback={null} />);
    await screen.findByRole("alert");
    expect(log).toHaveBeenCalledWith(cause);
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
