/**
 * The palette when its chunk fails to load: a short message, Close returns the
 * focus, and the next open (or Try again) loads it.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import {
  answersFor,
  domainsResponse,
  meResponse,
  renderApp,
  userFixture,
} from "../test/harness";

const attempts = vi.hoisted(() => ({ count: 0 }));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});

vi.mock("./CommandPaletteBody", async (importOriginal) => {
  attempts.count += 1;
  if (attempts.count <= 2) {
    throw new TypeError("Failed to fetch dynamically imported module");
  }
  return importOriginal();
});

const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () => meResponse({ user: userFixture() }),
      "/domains": domainsResponse,
      "/activity": () => ({ timeframe: "7d", count: 0, engrams: [] }),
      "/search": () => ({
        mode: "title",
        total: 0,
        page: 1,
        limit: 50,
        count: 0,
        hits: [],
      }),
      "/vocabulary": () => ({ tags: [] }),
    }),
  );
});

describe("the command palette when its chunk does not arrive", () => {
  it("offers Try again, closes with focus back, and opens on a retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { name: "Home" });

    const box = screen.getByLabelText("Search");
    box.focus();
    await user.keyboard("{Meta>}k{/Meta}");

    const alert = await screen.findByRole("dialog", { name: "Not loaded" });
    expect(alert).toHaveTextContent("This part did not load. Try again.");

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Not loaded" })).toBeNull();
    });
    expect(box).toHaveFocus();

    // The failed import is not cached for good: opening again starts a new
    // one, which fails here as well, and Try again then gets through.
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog", { name: "Not loaded" });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("dialog", { name: /command palette/i }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Not loaded" })).toBeNull();
  });
});
