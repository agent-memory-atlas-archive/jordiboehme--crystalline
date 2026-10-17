/**
 * The switcher's menu body is a lazy part. When it cannot be loaded, the menu
 * says so as an item a keyboard reaches, and choosing it reloads the page.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DomainSwitcher } from "./DomainSwitcher";

vi.mock("./DomainSwitcherMenu", () => {
  throw new Error("the chunk did not arrive");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the domain switcher without its menu body", () => {
  it("offers a reload a keyboard can reach", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<DomainSwitcher domain="eng" onCreateDomain={null} />);
    const trigger = screen.getByRole("button", { name: "eng, switch domain" });
    // A preload that fails is quiet: no unhandled rejection, no message yet.
    trigger.focus();
    const user = userEvent.setup();
    await user.keyboard("{Enter}");
    const item = await screen.findByRole("menuitem", {
      name: "Could not load the domains. Reload",
    });
    await user.keyboard("{ArrowDown}");
    expect(item).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(reload).toHaveBeenCalledOnce();
  });
});
