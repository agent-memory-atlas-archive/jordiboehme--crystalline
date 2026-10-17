/**
 * A link to a lazy screen warms its chunk when the pointer arrives or the
 * keyboard lands on it, before any click.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api/client";
import {
  answersFor,
  domainsResponse,
  meResponse,
  renderApp,
  userFixture,
} from "./test/harness";

const loaded = vi.hoisted(() => ({ domainHome: 0 }));

vi.mock("./api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});

vi.mock("./screens/DomainHome", () => {
  loaded.domainHome += 1;
  return { default: () => null };
});

const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () => meResponse({ user: userFixture() }),
      "/domains": domainsResponse,
      "/activity": () => ({ timeframe: "7d", count: 0, engrams: [] }),
      "/vocabulary": () => ({ tags: [] }),
    }),
  );
});

describe("prefetching from links", () => {
  it("starts a domain's chunk on hover, once, without a click", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await screen.findByRole("heading", { name: "Home" });
    expect(loaded.domainHome).toBe(0);

    const link = (await screen.findAllByRole("link", { name: /^eng\b/ }))[0];
    if (link === undefined) {
      throw new Error("no link to the eng domain");
    }
    await user.hover(link);
    await user.unhover(link);
    await user.hover(link);

    await vi.waitFor(() => {
      expect(loaded.domainHome).toBe(1);
    });
  });
});
