/**
 * The help map when its chunk fails to load: a short message, Close returns the
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

vi.mock("./HelpOverlayBody", async (importOriginal) => {
  attempts.count += 1;
  if (attempts.count <= 1) {
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

describe("the shortcut map when its chunk does not arrive", () => {
  it("closes with the focus back on the avatar that opened it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { name: "Home" });

    const avatar = await screen.findByRole("button", { name: "Ada Lovelace" });
    await user.click(avatar);
    await user.click(
      await screen.findByRole("menuitem", { name: /keyboard shortcuts/i }),
    );

    await screen.findByRole("dialog", { name: "Not loaded" });
    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Not loaded" })).toBeNull();
    });
    expect(avatar).toHaveFocus();
  });
});
