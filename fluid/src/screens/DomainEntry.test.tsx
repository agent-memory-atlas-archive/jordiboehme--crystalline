/**
 * Where `/d/<domain>` leads. A domain opens on its Reflection when the
 * Reflection is in effect here and the caller may read it, and on its engrams
 * in every other case. The engram view has its own address, `/d/<domain>/
 * engrams`, which is what the switch and every engram-view link point at.
 */

import { focusManager } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import type { InitialEntry } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    <div
      data-testid="probe"
      data-state={JSON.stringify(location.state ?? null)}
    >
      {`${location.pathname}${location.search}${location.hash}`}
    </div>
  );
}

function open(entry: InitialEntry) {
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

/** How many times the status was read. */
function statusReads(): number {
  return apiMock.mock.calls.filter(
    (call) => call[0] === "/domains/eng/reflection",
  ).length;
}

const realMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

beforeEach(() => {
  apiMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  if (realMatchMedia === undefined) {
    Reflect.deleteProperty(window, "matchMedia");
  } else {
    Object.defineProperty(window, "matchMedia", realMatchMedia);
  }
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

  it.each([
    [404, "not found"],
    [500, "server error"],
  ])(
    "stays on the engrams when the status read answers %i",
    async (code, title) => {
      serve({
        "/domains/eng/reflection": () => {
          throw new ApiProblem(code, title, "no");
        },
      });
      open("/d/eng");
      // A 500 is tried once more before the screen hears about it.
      const main = await screen.findByRole("main");
      expect(
        await within(main).findByRole(
          "heading",
          { level: 1, name: "eng" },
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId("probe").textContent).toBe("/d/eng");
    },
  );

  it("keeps the engrams once shown, when a later read says the Reflection is on", async () => {
    let state = "off";
    serve({ "/domains/eng/reflection": () => status(state)() });
    open("/d/eng");
    await expectEngramView();
    const before = statusReads();
    state = "on";
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => {
      expect(statusReads()).toBeGreaterThan(before);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("probe").textContent).toBe("/d/eng");
    expect(
      within(screen.getByRole("main")).getByRole("heading", {
        level: 1,
        name: "eng",
      }),
    ).toBeInTheDocument();
    act(() => {
      focusManager.setFocused(undefined);
    });
  });

  it("marks Engrams current on the domain's address when it stays there", async () => {
    serve({ "/domains/eng/reflection": status("elsewhere") });
    open("/d/eng");
    await expectEngramView();
    const modes = await screen.findByRole("navigation", {
      name: "Domain view",
    });
    expect(
      within(modes).getByRole("link", { name: "Engrams" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("marks no half current on the domain's address before it has decided", async () => {
    // A phone: the switch has a row of its own, drawn from the listing
    // before the status answers.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    serve({
      "/reflection/domains": () => ({
        domains: [
          {
            domain: "eng",
            state: "on",
            right: "curate",
            engrams_visible: true,
            home: "here",
            home_url: null,
            open_threads: 0,
          },
        ],
      }),
      "/domains/eng/reflection": () => new Promise(() => undefined),
    });
    open("/d/eng");
    const modes = await screen.findByRole("navigation", {
      name: "Domain view",
    });
    for (const name of ["Reflection", "Engrams"]) {
      expect(within(modes).getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  it("writes a filter on the engram view's own address, keeping the page and its focus", async () => {
    serve({
      "/domains/eng/reflection": status("off"),
      "/vocabulary": () => ({
        domain: "eng",
        tags: [{ name: "eng", engrams: 3, observations: 5 }],
        categories: [],
        relation_types: [],
      }),
    });
    open("/d/eng");
    await expectEngramView();
    const main = screen.getByRole("main");
    await userEvent.click(within(main).getByRole("button", { name: "Filter" }));
    const chip = await within(main).findByRole("button", { name: /#eng/ });
    await userEvent.click(chip);
    await expectAt("/d/eng/engrams?tags=eng");
    // The same page: the control the reader used is still there, focused.
    expect(chip.isConnected).toBe(true);
    expect(chip).toHaveFocus();
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

  it("carries the navigation state along with the query", async () => {
    serve({ "/domains/eng/reflection": status("on") });
    open({
      pathname: "/d/eng",
      search: "?path=notes",
      state: { discarded: "alpha.md" },
    });
    await expectAt("/d/eng/engrams?path=notes");
    expect(screen.getByTestId("probe")).toHaveAttribute(
      "data-state",
      JSON.stringify({ discarded: "alpha.md" }),
    );
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
