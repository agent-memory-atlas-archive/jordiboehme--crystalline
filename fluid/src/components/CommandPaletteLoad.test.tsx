/**
 * The palette's first open, while its chunk (cmdk and the rows) is still on
 * the way: the shortcut opens something at once, the shared loader shows, the
 * keys pressed meanwhile are kept, and the real palette takes over with them.
 */

import { screen } from "@testing-library/react";
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

const gate = vi.hoisted(() => {
  const state = { release: () => {} };
  const opened = new Promise<void>((resolve) => {
    state.release = resolve;
  });
  return { opened, release: () => state.release() };
});

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});

vi.mock("./CommandPaletteBody", async (importOriginal) => {
  await gate.opened;
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

describe("the command palette's first open", () => {
  it("shows the loader, keeps the typed text and hands it to the palette", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { name: "Home" });

    await user.keyboard("{Meta>}k{/Meta}");

    // The chunk has not arrived: a box with the focus, and the shared loader.
    const box = screen.getByRole("textbox", { name: "Command palette" });
    expect(box).toHaveFocus();
    expect(
      screen.getByRole("status", { name: "Loading the command palette" }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.keyboard("sal");
    expect(box).toHaveValue("sal");

    gate.release();

    const dialog = await screen.findByRole("dialog", {
      name: /command palette/i,
    });
    const input = await screen.findByPlaceholderText(
      "Jump to a domain, or find an engram by title",
    );
    expect(dialog).toContainElement(input);
    expect(input).toHaveValue("sal");
    expect(input).toHaveFocus();

    // The next key adds to the text instead of replacing it.
    await user.keyboard("i");
    expect(input).toHaveValue("sali");
  });
});
