/**
 * The Reflection home, and the doors into it: the mode switch on the domain
 * page, the redirect a person with knowledge none gets from every engram address, and the
 * notice that sends a reader to the instance where the Reflection lives.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblem, api } from "../api/client";
import type { Answer } from "../test/harness";
import {
  answersFor,
  domainsResponse,
  meResponse,
  renderApp,
  userFixture,
} from "../test/harness";

vi.setConfig({ testTimeout: 15000 });

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});
const apiMock = vi.mocked(api);

const missing = () => {
  throw new ApiProblem(404, "not found", "no domain 'eng'");
};

function status(overrides: Record<string, unknown> = {}) {
  return {
    domain: "eng",
    enabled: true,
    state: "on",
    home: "local",
    home_url: null,
    right: "curate",
    engrams_visible: true,
    pending_engrams: [],
    ...overrides,
  };
}

const TREE = {
  domain: "eng",
  pact: {
    path: "PACT.md",
    title: "How we write about eng",
    exists: true,
    open_threads: 1,
  },
  nodes: [
    {
      kind: "folder",
      name: "guides",
      path: "guides",
      children: [
        {
          kind: "reflection",
          name: "deploying.md",
          path: "guides/deploying.md",
          title: "Deploying",
          open_threads: 2,
          sections: 3,
        },
      ],
    },
  ],
};

/**
 * A person with knowledge `none` and Reflection `contributor` on `eng`: a
 * member of the private `eng`, so it may leave (`member: true`).
 */
function asContributor(routes: Record<string, Answer> = {}) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () =>
        meResponse({ user: userFixture({ name: "ann", role: "viewer" }) }),
      "/domains": () => ({ behavior: [], domains: [] }),
      "/domains/eng/tree": missing,
      "/domains/eng/engrams/runbooks/deploy": missing,
      "/reflection/domains": () => ({
        domains: [
          {
            domain: "eng",
            right: "edit",
            engrams_visible: false,
            home: "here",
            home_url: null,
            open_threads: 3,
          },
        ],
      }),
      "/domains/eng/reflection": () =>
        status({ right: "edit", engrams_visible: false, member: true }),
      "/domains/eng/reflection/tree": () => TREE,
      ...routes,
    }),
  );
}

/** An editor on a shared domain, who reads engrams and curates the Reflection. */
function asEditor(routes: Record<string, Answer> = {}) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () => meResponse({ user: userFixture() }),
      "/domains": domainsResponse,
      "/domains/eng/manifest": () => ({ domain: "eng", markdown: "# eng\n" }),
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
      "/domains/eng/members": () => ({
        owner: null,
        visibility: "shared",
        members: [],
      }),
      "/vocabulary": () => ({
        domain: "eng",
        tags: [],
        categories: [],
        relation_types: [],
      }),
      "/reflection/domains": () => ({ domains: [] }),
      "/domains/eng/reflection": () => status(),
      "/domains/eng/reflection/tree": () => TREE,
      ...routes,
    }),
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

describe("the doors into the Reflection", () => {
  it("creates the pact when there is none, for a curator", async () => {
    const put = vi.fn(() => ({
      checksum: "p",
      created: true,
      ids_assigned: [],
    }));
    asEditor({
      "/domains/eng/reflection/tree": () => ({
        ...TREE,
        pact: {
          path: "PACT.md",
          title: "PACT.md",
          exists: false,
          open_threads: 0,
        },
      }),
      "/domains/eng/reflections/PACT.md": (_p, init) =>
        init?.method === "PUT" ? put() : missing(),
    });
    renderApp("/d/eng/reflection");
    await userEvent.click(
      await screen.findByRole("button", { name: "Write the pact" }),
    );
    await waitFor(() => {
      expect(put).toHaveBeenCalledTimes(1);
    });
  });

  it("offers an editor no way to write the pact", async () => {
    asEditor({
      "/domains/eng/reflection": () => status({ right: "edit" }),
      "/domains/eng/reflection/tree": () => ({
        ...TREE,
        pact: {
          path: "PACT.md",
          title: "PACT.md",
          exists: false,
          open_threads: 0,
        },
      }),
    });
    renderApp("/d/eng/reflection");
    expect(await screen.findByText("No pact is written yet.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Write the pact" })).toBeNull();
  });

  it("a person with knowledge none opening the engram address of a domain lands in its Reflection", async () => {
    asContributor();
    renderApp("/d/eng/e/runbooks/deploy");
    // Exactly what a stranger is told: nothing about whether the engram exists.
    expect(
      await screen.findByRole("heading", { name: "Engram not found" }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("link", { name: "See what eng does hold" }),
    );
    expect(
      await screen.findByRole("heading", { name: "eng", level: 1 }),
    ).toBeVisible();
    expect(screen.getByText("Reflection", { selector: "p" })).toBeVisible();
    // A contributor has one mode, so there is nothing to switch between.
    expect(
      screen.queryByRole("navigation", { name: "Domain view" }),
    ).toBeNull();
  });

  it("a stranger still gets domain not found", async () => {
    asContributor({ "/reflection/domains": () => ({ domains: [] }) });
    renderApp("/d/eng");
    expect(
      await screen.findByRole("heading", { name: "Domain not found" }),
    ).toBeVisible();
  });

  it("offers both modes to a reader of engrams and marks the one on screen", async () => {
    asEditor();
    renderApp("/d/eng");
    const modes = await screen.findByRole("navigation", {
      name: "Domain view",
    });
    expect(
      within(modes).getByRole("link", { name: "Engrams" }),
    ).toHaveAttribute("aria-current", "page");
    await userEvent.click(
      within(modes).getByRole("link", { name: "Reflection" }),
    );
    const again = await screen.findByRole("navigation", {
      name: "Domain view",
    });
    expect(
      within(again).getByRole("link", { name: "Reflection" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("draws no switch while the Reflection is off", async () => {
    asEditor({
      "/domains/eng/reflection": () => status({ state: "off", enabled: false }),
    });
    renderApp("/d/eng");
    expect(
      await screen.findByRole("heading", { name: "eng", level: 1 }),
    ).toBeVisible();
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/domains/eng/reflection");
    });
    expect(
      screen.queryByRole("navigation", { name: "Domain view" }),
    ).toBeNull();
  });

  it("turns the Reflection half of the switch into a link to the home instance when the Reflection lives elsewhere", async () => {
    asEditor({
      "/domains/eng/reflection": () =>
        status({
          state: "elsewhere",
          home: "elsewhere",
          home_url: "https://team.example.com",
        }),
    });
    renderApp("/d/eng");
    const modes = await screen.findByRole("navigation", {
      name: "Domain view",
    });
    expect(
      within(modes).getByRole("link", { name: "Engrams" }),
    ).toHaveAttribute("aria-current", "page");
    const away = within(modes).getByRole("link", {
      name: "Reflection (opens on another server)",
    });
    expect(away).toHaveAttribute("href", "https://team.example.com");
    expect(away).not.toHaveAttribute("aria-current");
    // The bar says it now; the domain page no longer carries the sentence.
    expect(screen.queryByText(/This domain's Reflection lives at/)).toBeNull();
  });

  it("never turns a home address that is not a web address into a link", async () => {
    asEditor({
      "/domains/eng/reflection": () =>
        status({
          state: "elsewhere",
          home: "elsewhere",
          home_url: "javascript:alert(1)",
        }),
    });
    renderApp("/d/eng");
    expect(
      await screen.findByRole("heading", { name: "eng", level: 1 }),
    ).toBeVisible();
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/domains/eng/reflection");
    });
    // Nowhere safe to go, so no switch at all rather than a dead half.
    expect(
      screen.queryByRole("navigation", { name: "Domain view" }),
    ).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("leaves a person with knowledge none on domain not found when the Reflection lives elsewhere", async () => {
    asContributor({
      "/reflection/domains": () => ({
        domains: [
          {
            domain: "eng",
            state: "elsewhere",
            right: "edit",
            engrams_visible: false,
            home: "elsewhere",
            home_url: "https://team.example.com",
            open_threads: 0,
          },
        ],
      }),
    });
    renderApp("/d/eng");
    expect(
      await screen.findByRole("heading", { name: "Domain not found" }),
    ).toBeVisible();
  });
  it("never sends a reader of engrams to the Reflection from a missing address", async () => {
    asEditor({
      "/domains/eng/tree": missing,
      "/reflection/domains": () => ({
        domains: [
          {
            domain: "eng",
            right: "curate",
            engrams_visible: true,
            home: "here",
            home_url: null,
            open_threads: 0,
          },
        ],
      }),
    });
    renderApp("/d/eng?path=gone");
    expect(
      await screen.findByRole("heading", { name: "Domain not found" }),
    ).toBeVisible();
  });
});

describe("the Reflection home", () => {
  it("names the pending engrams while the switch waits for them", async () => {
    asEditor({
      "/domains/eng/reflection": () =>
        status({
          state: "pending",
          pending_engrams: ["reflections/old-note.md"],
        }),
    });
    renderApp("/d/eng/reflection");
    expect(
      await screen.findByText(
        "The Reflection waits until these engrams leave reflections/:",
      ),
    ).toBeVisible();
    expect(screen.getByText("reflections/old-note.md")).toBeVisible();
  });

  it("links the pact and the review screen with the open thread count", async () => {
    asEditor();
    renderApp("/d/eng/reflection");
    // The sidebar names the pact too, so the home's own links are read
    // inside the main region.
    const main = await screen.findByRole("main");
    expect(
      await within(main).findByRole("link", { name: "How we write about eng" }),
    ).toHaveAttribute("href", "/d/eng/reflection/PACT.md");
    expect(
      within(main).getByRole("link", { name: "3 open threads" }),
    ).toHaveAttribute("href", "/d/eng/reflection/review");
  });

  it("searches the Reflection in the mode asked for, says which ran, and never shows an id line", async () => {
    const asked: string[] = [];
    asEditor({
      "/domains/eng/reflection/search": (path) => {
        asked.push(path);
        return {
          domain: "eng",
          query: "night",
          mode: "text",
          total: 1,
          page: 1,
          limit: 20,
          count: 1,
          hits: [
            {
              path: "guides/deploying.md",
              title: "Deploying",
              section: "7f3a9c2e",
              heading: "Night deploys",
              // The shipped snippet (core Task 30) carries no heading line;
              // an id line is stripped anyway, as defence.
              snippet: "Deploys run at night.\n<!-- r:0b1c2d3e -->",
            },
          ],
        };
      },
    });
    renderApp("/d/eng/reflection");
    // Addressed the way the engram search test addresses its own Mode select.
    await userEvent.selectOptions(
      await screen.findByLabelText("Mode"),
      "semantic",
    );
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search the Reflection" }),
      "night",
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    const hit = await screen.findByRole("link", {
      name: "Deploying: Night deploys",
    });
    expect(hit).toHaveAttribute(
      "href",
      "/d/eng/reflection/guides/deploying.md#s-7f3a9c2e",
    );
    expect(asked.at(-1)).toBe(
      "/domains/eng/reflection/search?q=night&limit=20&search_type=semantic",
    );
    expect(
      screen.getByText(
        "Asked for semantic, ran as text: the pages are not embedded yet.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/r:0b1c2d3e/)).toBeNull();
  });

  it("links a hit on the intro to the page's top and pages through a long answer", async () => {
    asEditor({
      "/domains/eng/reflection/search": () => ({
        domain: "eng",
        query: "night",
        mode: "hybrid",
        total: 25,
        page: 1,
        limit: 20,
        count: 1,
        hits: [
          {
            path: "a.md",
            title: "A",
            section: "_top",
            heading: "",
            snippet: "Intro.",
          },
        ],
      }),
    });
    renderApp("/d/eng/reflection?q=night");
    expect(await screen.findByRole("link", { name: "A" })).toHaveAttribute(
      "href",
      "/d/eng/reflection/a.md#s-_top",
    );
    expect(screen.getByText("25 hits, ranked by hybrid.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/domains/eng/reflection/search?q=night&limit=20&page=2",
      );
    });
  });

  it("says once where a Reflection that lives elsewhere is", async () => {
    asEditor({
      "/domains/eng/reflection": () =>
        status({
          state: "elsewhere",
          home: "elsewhere",
          home_url: "https://team.example.com",
        }),
    });
    renderApp("/d/eng/reflection");
    expect(
      await screen.findByRole("link", { name: "https://team.example.com" }),
    ).toBeVisible();
    expect(
      screen.getAllByText(/This domain's Reflection lives at/),
    ).toHaveLength(1);
    // The bar keeps the switch, its Reflection half pointing at the home.
    expect(
      within(screen.getByRole("navigation", { name: "Domain view" })).getByRole(
        "link",
        { name: "Reflection (opens on another server)" },
      ),
    ).toHaveAttribute("href", "https://team.example.com");
  });

  it("says a homeless Reflection has no home yet, never that it is off", async () => {
    asEditor({
      "/domains/eng/reflection": () =>
        status({ state: "homeless", home: null }),
    });
    renderApp("/d/eng/reflection");
    expect(await screen.findByText(/Reflection has no home yet/)).toBeVisible();
    expect(screen.queryByText(/is off for this domain/)).toBeNull();
  });

  it("names the instance that serves the Reflection, never that it is off", async () => {
    asEditor({
      "/domains/eng/reflection": () =>
        status({
          state: "hosted_elsewhere",
          home: null,
          host_label: "office-mac",
        }),
    });
    renderApp("/d/eng/reflection");
    expect(
      await screen.findByText(
        "This domain's Reflection is served by another instance: office-mac.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/is off for this domain/)).toBeNull();
  });

  it("says a rename holds the Reflection when no instance is named", async () => {
    asEditor({
      "/domains/eng/reflection": () =>
        status({ state: "hosted_elsewhere", home: null, host_label: null }),
    });
    renderApp("/d/eng/reflection");
    expect(
      await screen.findByText(
        "This domain is being renamed. Its Reflection opens again when the rename is done.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/served by another instance/)).toBeNull();
  });

  it("lets a contributor leave the domain", async () => {
    const left = vi.fn(() => undefined);
    asContributor({
      "/domains/eng/members/ann": (_path, init) =>
        init?.method === "DELETE" ? left() : missing(),
    });
    renderApp("/d/eng/reflection");
    await userEvent.click(
      await screen.findByRole("button", { name: "Leave this domain" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm leave" }),
    );
    await waitFor(() => {
      expect(left).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByRole("heading", { name: "Home", level: 1 }),
    ).toBeVisible();
  });

  it("offers no leave where there is no membership: knowledge none set for every shared domain", async () => {
    asContributor({
      "/auth/me": () =>
        meResponse({ user: userFixture({ name: "nora", role: "none" }) }),
      "/domains/eng/reflection": () =>
        status({ right: "edit", engrams_visible: false, member: false }),
    });
    renderApp("/d/eng");
    expect(
      await within(await screen.findByRole("main")).findByRole("link", {
        name: "How we write about eng",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Leave this domain" }),
    ).toBeNull();
  });

  it("offers no leave to a reader of engrams, whose membership lives on the domain page", async () => {
    asEditor();
    renderApp("/d/eng/reflection");
    expect(
      await within(await screen.findByRole("main")).findByRole("link", {
        name: "How we write about eng",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Leave this domain" }),
    ).toBeNull();
  });
});

describe("the Reflection home, fix round 1", () => {
  /** One page of a long answer: `total` hits, 20 a page, one drawn. */
  function longAnswer(
    total: number,
    hits: unknown[] = [
      {
        path: "a.md",
        title: "A",
        section: "_top",
        heading: "",
        snippet: "Intro.",
      },
    ],
  ) {
    return () => ({
      domain: "eng",
      query: "night",
      mode: "hybrid",
      total,
      page: 1,
      limit: 20,
      count: hits.length,
      hits,
    });
  }

  it("says what a pending Reflection waits for when it may not name the engrams", async () => {
    asContributor({
      "/domains/eng/reflection": () =>
        status({
          state: "pending",
          right: "edit",
          engrams_visible: false,
          member: true,
          pending_engrams: [],
        }),
    });
    renderApp("/d/eng/reflection");
    expect(
      await screen.findByText(
        "The Reflection waits until some engrams are moved out of reflections/. A curator does that.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/leave reflections\/:/)).toBeNull();
    // The sidebar tree is a list of its own; the screen draws none.
    expect(within(screen.getByRole("main")).queryByRole("list")).toBeNull();
  });

  it("lets a contributor leave while the Reflection is not open", async () => {
    asContributor({
      "/domains/eng/reflection": () =>
        status({
          state: "homeless",
          home: null,
          right: "edit",
          engrams_visible: false,
          member: true,
        }),
    });
    renderApp("/d/eng/reflection");
    expect(await screen.findByText(/Reflection has no home yet/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Leave this domain" }),
    ).toBeVisible();
  });

  it("says domain not found only when the status is not found", async () => {
    asEditor({ "/domains/eng/reflection": missing });
    renderApp("/d/eng/reflection");
    expect(
      await screen.findByRole("heading", { name: "Domain not found" }),
    ).toBeVisible();
  });

  it("shows any other failure as the server's own words", async () => {
    asEditor({
      "/domains/eng/reflection": () => {
        throw new ApiProblem(500, "internal", "the index is not open");
      },
    });
    renderApp("/d/eng/reflection");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the index is not open",
    );
    expect(
      screen.queryByRole("heading", { name: "Domain not found" }),
    ).toBeNull();
  });

  it("says the Reflection is off and who switches it on", async () => {
    asEditor({
      "/domains/eng/reflection": () => status({ state: "off", enabled: false }),
    });
    renderApp("/d/eng/reflection");
    expect(
      await screen.findByText(
        "The Reflection is off for this domain. Its owner switches it on in the domain policies.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("searchbox", { name: "Search the Reflection" }),
    ).toBeNull();
  });

  it("says no page matches when the answer is empty", async () => {
    asEditor({ "/domains/eng/reflection/search": longAnswer(0, []) });
    renderApp("/d/eng/reflection?q=night");
    expect(await screen.findByText("No page matches.")).toBeVisible();
    expect(screen.queryByText(/hits?, ranked by/)).toBeNull();
  });

  it("offers no previous page on the first page and no next page on the last", async () => {
    asEditor({ "/domains/eng/reflection/search": longAnswer(25) });
    renderApp("/d/eng/reflection?q=night");
    expect(
      await screen.findByRole("button", { name: "Next page" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Previous page" })).toBeNull();
  });

  it("goes back a page and offers no next page on the last one", async () => {
    asEditor({ "/domains/eng/reflection/search": longAnswer(25) });
    renderApp("/d/eng/reflection?q=night&page=2");
    await userEvent.click(
      await screen.findByRole("button", { name: "Previous page" }),
    );
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/domains/eng/reflection/search?q=night&limit=20",
      );
    });
  });

  it("draws the last page without a next page", async () => {
    asEditor({ "/domains/eng/reflection/search": longAnswer(25) });
    renderApp("/d/eng/reflection?q=night&page=2");
    expect(
      await screen.findByRole("button", { name: "Previous page" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("says one thing on a page past the last one, and offers the way back", async () => {
    asEditor({ "/domains/eng/reflection/search": longAnswer(25, []) });
    renderApp("/d/eng/reflection?q=night&page=9");
    expect(await screen.findByText("No page matches.")).toBeVisible();
    expect(screen.queryByText("25 hits, ranked by hybrid.")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Previous page" }),
    );
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/domains/eng/reflection/search?q=night&limit=20&page=2",
      );
    });
  });

  it("draws two hits on one path without a section id apart", async () => {
    const hit = {
      path: "a.md",
      title: "A",
      section: null,
      heading: "",
      snippet: "One.",
    };
    asEditor({
      "/domains/eng/reflection/search": longAnswer(2, [
        hit,
        { ...hit, snippet: "Two." },
      ]),
    });
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderApp("/d/eng/reflection?q=night");
    expect(await screen.findAllByRole("link", { name: "A" })).toHaveLength(2);
    expect(
      errors.mock.calls.some((call) => String(call[0]).includes("same key")),
    ).toBe(false);
    errors.mockRestore();
  });

  it("keeps the search box in step with the address when it changes under it", async () => {
    asEditor({ "/domains/eng/reflection/search": longAnswer(1) });
    renderApp("/d/eng/reflection?q=night&search_type=text");
    const field = await screen.findByRole("searchbox", {
      name: "Search the Reflection",
    });
    expect(field).toHaveValue("night");
    expect(screen.getByLabelText("Mode")).toHaveValue("text");
    // The switch's own link is a new address on the same screen, as a step
    // back or forward in the history is.
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Domain view" })).getByRole(
        "link",
        { name: "Reflection" },
      ),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("searchbox", { name: "Search the Reflection" }),
      ).toHaveValue("");
    });
    expect(screen.getByLabelText("Mode")).toHaveValue("hybrid");
  });
});

/**
 * The mode switch lives in the top bar on every screen inside a domain (spec
 * 4.2): the Engrams half is current on the domain page, an engram and the
 * editor, the Reflection half on every Reflection screen. Only the half
 * whose address is on screen says "page"; the other screens of a mode say
 * "true", because the reader is in that mode but not on that page.
 */
describe("the mode switch in the top bar", () => {
  async function modes(): Promise<HTMLElement> {
    return within(await screen.findByRole("banner")).findByRole("navigation", {
      name: "Domain view",
    });
  }

  it("draws no switch outside a domain", async () => {
    asEditor({
      "/activity": () => ({ timeframe: "7d", count: 0, engrams: [] }),
    });
    renderApp("/");
    expect(
      await screen.findByRole("button", { name: "All domains, switch domain" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Domain view" }),
    ).toBeNull();
  });

  it("marks Engrams as the mode of an engram page", async () => {
    asEditor({
      "/domains/eng/engrams/alpha": () => ({
        domain: "eng",
        permalink: "alpha",
        title: "Alpha",
        url: "crystalline://eng/alpha",
        content: "# Alpha\n",
        frontmatter: {},
        observations: [],
        relations: [],
        links: [],
      }),
    });
    renderApp("/d/eng/e/alpha");
    const nav = await modes();
    expect(within(nav).getByRole("link", { name: "Engrams" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(
      within(nav).getByRole("link", { name: "Reflection" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks Reflection on the Reflection home as the page itself", async () => {
    asEditor();
    renderApp("/d/eng/reflection");
    const nav = await modes();
    expect(
      within(nav).getByRole("link", { name: "Reflection" }),
    ).toHaveAttribute("aria-current", "page");
    // Moved, not copied: the screen's own header no longer carries one.
    expect(
      within(screen.getByRole("main")).queryByRole("navigation", {
        name: "Domain view",
      }),
    ).toBeNull();
  });

  it("keeps the switch on the review screen, with Reflection as its mode", async () => {
    asEditor({
      "/domains/eng/reflection/review": () => ({
        domain: "eng",
        threads: [],
        queue: [],
      }),
    });
    renderApp("/d/eng/reflection/review");
    const nav = await modes();
    expect(
      within(nav).getByRole("link", { name: "Reflection" }),
    ).toHaveAttribute("aria-current", "true");
    expect(within(nav).getByRole("link", { name: "Engrams" })).toHaveAttribute(
      "href",
      "/d/eng",
    );
  });

  it("draws no switch for a person with knowledge none, who has one mode", async () => {
    asContributor();
    renderApp("/d/eng/reflection");
    expect(
      await screen.findByRole("heading", { name: "eng", level: 1 }),
    ).toBeVisible();
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/domains/eng/reflection");
    });
    expect(
      screen.queryByRole("navigation", { name: "Domain view" }),
    ).toBeNull();
  });
});
