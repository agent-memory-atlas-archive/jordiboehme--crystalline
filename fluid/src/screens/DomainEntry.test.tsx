/**
 * Where `/d/<domain>` leads. A domain opens on its Reflection when the
 * Reflection is in effect here and the caller may read it, and on its engrams
 * in every other case. The engram view has its own address, `/d/<domain>/
 * engrams`, which is what the switch and every engram-view link point at.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { ApiProblem, api } from "../api/client";
import type { Answer } from "../test/harness";
import {
  answersFor,
  domainsResponse,
  manifestSectionsResponse,
  meResponse,
  userFixture,
} from "../test/harness";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});

const apiMock = vi.mocked(api);

/** The status read, at the given state and right. */
function status(
  state: string,
  right = "curate",
  engramsVisible = true,
): () => unknown {
  return () => ({
    domain: "eng",
    state,
    home: state === "on" ? "local" : null,
    home_url: state === "elsewhere" ? "https://kb.example.org" : null,
    right,
    engrams_visible: engramsVisible,
    pending_engrams: [],
  });
}

function serve(routes: Record<string, Answer> = {}) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () => meResponse({ user: userFixture() }),
      "/domains": domainsResponse,
      "/reflection/domains": () => ({ domains: [] }),
      "/domains/eng/manifest": () => ({
        domain: "eng",
        markdown: "# eng",
        sections: manifestSectionsResponse(),
      }),
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
      "/vocabulary": () => ({
        domain: "eng",
        tags: [],
        categories: [],
        relation_types: [],
      }),
      "/domains/eng/members": () => ({
        owner: null,
        visibility: "shared",
        members: [],
      }),
      "/domains/eng/reflection/tree": () => ({ pages: [], folders: [] }),
      ...routes,
    }),
  );
}

/** A sibling of `App`, under the same in-memory history, reading it. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="probe">
      {`${location.pathname}${location.search}${location.hash}`}
    </div>
  );
}

function open(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function expectAt(path: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("probe")).toHaveTextContent(path, {
      normalizeWhitespace: false,
    });
  });
  expect(screen.getByTestId("probe").textContent).toBe(path);
}

/** The engram view's front page: the domain's name as the page heading. */
async function expectEngramView(): Promise<void> {
  const main = await screen.findByRole("main");
  expect(
    await within(main).findByRole("heading", { level: 1, name: "eng" }),
  ).toBeInTheDocument();
}

beforeEach(() => {
  apiMock.mockReset();
  localStorage.clear();
});

describe("opening a domain", () => {
  it("forwards to the Reflection when it is on and readable", async () => {
    serve({ "/domains/eng/reflection": status("on") });
    open("/d/eng");
    await expectAt("/d/eng/reflection");
  });

  it("keeps the hash when it forwards to the Reflection", async () => {
    serve({ "/domains/eng/reflection": status("on") });
    open("/d/eng#pact");
    await expectAt("/d/eng/reflection#pact");
  });

  it("forwards a reader who cannot read engrams to the Reflection", async () => {
    serve({ "/domains/eng/reflection": status("on", "read", false) });
    open("/d/eng");
    await expectAt("/d/eng/reflection");
  });

  it.each([
    ["off", "curate"],
    ["pending", "curate"],
    ["elsewhere", "curate"],
    ["hosted_elsewhere", "curate"],
    ["homeless", "curate"],
    ["on", "none"],
  ])(
    "stays on the engrams while the Reflection is %s (right %s)",
    async (state, right) => {
      serve({ "/domains/eng/reflection": status(state, right) });
      open("/d/eng");
      await expectEngramView();
      expect(screen.getByTestId("probe").textContent).toBe("/d/eng");
    },
  );

  it("stays on the engrams when the status read fails", async () => {
    serve({
      "/domains/eng/reflection": () => {
        throw new ApiProblem(403, "forbidden", "no");
      },
    });
    open("/d/eng");
    await expectEngramView();
    expect(screen.getByTestId("probe").textContent).toBe("/d/eng");
  });

  it("shows the domain loader, not the engrams, while the status loads", async () => {
    serve({
      "/domains/eng/reflection": () => new Promise(() => undefined),
    });
    open("/d/eng");
    expect(
      await screen.findByRole("status", { name: "Loading the domain" }),
    ).toBeInTheDocument();
    // Give the engram view every chance to appear: it must not. The sidebar
    // reads the tree on its own, so the engram listing is what tells.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      apiMock.mock.calls
        .map((call) => call[0])
        .some((path) => path.startsWith("/domains/eng/engrams")),
    ).toBe(false);
    expect(
      within(screen.getByRole("main")).queryByRole("heading", { level: 1 }),
    ).toBeNull();
    expect(screen.getByTestId("probe").textContent).toBe("/d/eng");
  });

  it("sends a folder or filter address to the engram view, query and all", async () => {
    serve({ "/domains/eng/reflection": status("on") });
    open("/d/eng?path=notes#top");
    await expectAt("/d/eng/engrams?path=notes#top");
  });
});

describe("the engram view's own address", () => {
  it("renders the engrams with Engrams current, after Reflection in the switch", async () => {
    serve({ "/domains/eng/reflection": status("on") });
    open("/d/eng/engrams");
    await expectEngramView();
    expect(screen.getByTestId("probe").textContent).toBe("/d/eng/engrams");
    const modes = await screen.findByRole("navigation", {
      name: "Domain view",
    });
    const links = within(modes).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Reflection",
      "Engrams",
    ]);
    const engrams = within(modes).getByRole("link", { name: "Engrams" });
    expect(engrams).toHaveAttribute("href", "/d/eng/engrams");
    expect(engrams).toHaveAttribute("aria-current", "page");
    expect(
      within(modes).getByRole("link", { name: "Reflection" }),
    ).not.toHaveAttribute("aria-current");
  });
});
