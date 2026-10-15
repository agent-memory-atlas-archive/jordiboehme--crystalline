/**
 * The members card's skeleton, and when the domain page draws it.
 *
 * The card is lazy, and it draws nothing until its members read lands, or at
 * all for a caller the read refuses. So the page gates the card's boundary on
 * that same read: the skeleton stands only where the card will stand. The
 * card's chunk never arrives in this file (the mock below never settles), so
 * the skeleton, where it is drawn, stays on screen long enough to be seen:
 * without the gate it would be there for the refused caller too.
 */

import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblem, api } from "../api/client";
import {
  answersFor,
  domainsResponse,
  meResponse,
  renderApp,
  userFixture,
} from "../test/harness";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});

// A chunk that is still on the way, for as long as the test runs.
vi.mock("../components/MembersCard", () => new Promise<never>(() => {}));

const apiMock = vi.mocked(api);

function serve(members: () => unknown) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () => meResponse({ user: userFixture() }),
      "/domains": domainsResponse,
      "/domains/eng/manifest": () => ({ domain: "eng", markdown: "" }),
      "/domains/eng/tree": () => ({
        domain: "eng",
        path: "/",
        folders: [],
        engrams: [],
      }),
      "/domains/eng/engrams": () => ({
        mode: "text",
        total: 0,
        page: 1,
        limit: 50,
        count: 0,
        hits: [],
      }),
      "/vocabulary": () => ({ domain: "eng", tags: [] }),
      "/domains/eng/members": members,
    }),
  );
}

function membersRead(): boolean {
  return apiMock.mock.calls.some((call) => call[0] === "/domains/eng/members");
}

beforeEach(() => {
  apiMock.mockReset();
  localStorage.clear();
});

describe("the members card's skeleton", () => {
  it("is drawn while the card's chunk loads for a caller the read answers", async () => {
    serve(() => ({ owner: null, visibility: "shared", members: [] }));
    renderApp("/d/eng");

    expect(
      await screen.findByRole("status", { name: "Loading the members" }),
    ).toBeInTheDocument();
  });

  it("is never drawn for a caller the members read refuses", async () => {
    serve(() => {
      throw new ApiProblem(403, "forbidden", "not a member");
    });
    renderApp("/d/eng");

    await screen.findByRole("region", { name: "Engrams" });
    await waitFor(() => {
      expect(membersRead()).toBe(true);
    });
    // Let the refusal settle into the query before looking.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      screen.queryByRole("status", { name: "Loading the members" }),
    ).toBeNull();
  });
});
