/**
 * The screen the app opens on: what this instance knows about, and what has
 * been learned lately.
 *
 * The cards are the answer to "what is in here", so what they say has to come
 * from the listing rather than from a guess: the count, the routing line the
 * MANIFEST carries, and a date that names which fact it is - the last thing
 * recorded, or, when nothing was, the last sync.
 */

import { screen, waitFor, within } from "@testing-library/react";
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

const apiMock = vi.mocked(api);

/** The activity payload, in the engine's own shape. */
function activityResponse() {
  return {
    timeframe: "7d",
    count: 1,
    engrams: [
      {
        domain: "eng",
        permalink: "notes/beta",
        title: "Beta",
        engram_type: "decision",
        status: "stable",
        tags: ["eng"],
        recorded_at: "2026-08-04",
      },
    ],
  };
}

function serve(routes: Record<string, () => unknown> = {}) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () => meResponse({ user: userFixture() }),
      "/domains": domainsResponse,
      "/activity": activityResponse,
      ...routes,
    }),
  );
}

/** The screen's own region, so the sidebar's domain links are out of scope. */
async function main() {
  return within(await screen.findByRole("main"));
}

beforeEach(() => {
  apiMock.mockReset();
});

describe("the home screen", () => {
  it("gives every domain a card with its count and its routing line", async () => {
    serve();

    renderApp("/");

    const screenMain = await main();
    const card = await screenMain.findByRole("link", { name: "eng" });
    expect(card).toHaveAttribute("href", "/d/eng");
    expect(await screenMain.findByText("4 engrams")).toBeVisible();
    expect(
      await screenMain.findByText("Route here for eng questions."),
    ).toBeVisible();
    // What backs the domain is a fact about it, so it wears the same chip
    // every other fact in this app wears.
    expect(screenMain.getByText("file").className).toContain("slate");
  });

  it("badges a private domain's card and leaves a shared one plain", async () => {
    serve({
      "/domains": () => ({
        behavior: [],
        domains: [
          { name: "eng", kind: "file", engrams: 4, when_to_use: [] },
          {
            name: "lab",
            kind: "file",
            engrams: 2,
            private: true,
            when_to_use: [],
          },
        ],
      }),
    });

    renderApp("/");

    const screenMain = await main();
    const lab = (await screenMain.findByRole("link", { name: "lab" })).closest(
      "article",
    );
    expect(lab).toHaveTextContent("private");
    // A row that does not say it is private wears nothing, which is also what
    // a listing from a server that never heard of the field looks like.
    expect(
      (await screenMain.findByRole("link", { name: "eng" })).closest("article"),
    ).not.toHaveTextContent("private");
  });

  it("leaves the tagline to the screen that owns it", async () => {
    serve();

    renderApp("/");

    // Said once, on the way in. A subtitle repeating it under every visit is
    // the kind of line a reader stops seeing.
    await (await main()).findByRole("heading", { name: "Home", level: 1 });
    expect(screen.queryByText(/mind-meld/)).toBeNull();
  });

  it("dates a card by what was recorded, not by what was guessed", async () => {
    serve();

    renderApp("/");

    // The feed puts an engram in `eng` on 2026-08-04, so that is the card's
    // last activity. A domain the feed never mentions gets no invented date.
    expect(
      await (await main()).findByText("Last activity 2026-08-04"),
    ).toBeVisible();
  });

  it("lists what was recorded lately, linked to the engrams", async () => {
    serve();

    renderApp("/");

    const feed = await screen.findByRole("region", {
      name: /Recent activity/,
    });
    const entry = await within(feed).findByRole("link", { name: /Beta/ });
    expect(entry).toHaveAttribute("href", "/d/eng/e/notes/beta");
    expect(within(feed).getByText(/7d/)).toBeVisible();
  });

  it("says the feed is empty rather than showing an empty box", async () => {
    serve({
      "/activity": () => ({ timeframe: "7d", count: 0, engrams: [] }),
    });

    renderApp("/");

    expect(
      await screen.findByText(/Nothing was recorded in the last 7d/),
    ).toBeVisible();
    // An empty feed is a state with a way out of it: what fills it, and a
    // door into the first domain there is.
    expect(
      screen.getByText(
        "Activity appears as engrams are written, edited or verified.",
      ),
    ).toBeVisible();
    const feed = await screen.findByRole("region", { name: /Recent activity/ });
    expect(
      within(feed).getByRole("link", { name: "Start in eng" }),
    ).toHaveAttribute("href", "/d/eng");
  });

  it("offers no door into a domain when there are none", async () => {
    serve({
      "/domains": () => ({ behavior: [], domains: [] }),
      "/activity": () => ({ timeframe: "7d", count: 0, engrams: [] }),
    });

    renderApp("/");

    await screen.findByText(/Nothing was recorded in the last 7d/);
    expect(screen.queryByRole("link", { name: /^Start in/ })).toBeNull();
  });

  it("says a failed domain listing is an alert, with no loader and no empty list", async () => {
    serve({
      "/domains": () => {
        throw new ApiProblem(500, "internal", "the listing broke");
      },
    });

    renderApp("/");

    const body = await main();
    const alert = await body.findByRole("alert");
    expect(alert).toHaveTextContent("the listing broke");
    await waitFor(() => {
      expect(
        screen.queryByRole("status", { name: "Loading domains" }),
      ).toBeNull();
    });
    expect(body.queryByText(/No domains are registered/)).toBeNull();
    expect(body.queryByRole("link", { name: /^Start in/ })).toBeNull();
  });

  it("lists the domains from connected servers with a link to each server", async () => {
    serve({
      "/domains": () => ({
        ...domainsResponse(),
        mounted: [
          {
            name: "jordi-acme",
            source: "acme",
            source_url: "https://kb.acme.com",
            remote_name: "jordi",
            web_url: "https://kb.acme.com/d/jordi",
          },
        ],
      }),
    });
    renderApp("/");
    const section = await screen.findByRole("region", {
      name: "From connected servers",
    });
    const link = within(section).getByRole("link", {
      name: "jordi-acme on acme",
    });
    expect(link).toHaveAttribute("href", "https://kb.acme.com/d/jordi");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      within(section).getByText(/opens on its server/),
    ).toBeInTheDocument();
  });

  it("shows no server section when nothing is connected", async () => {
    serve();
    renderApp("/");
    const home = await main();
    await home.findByRole("heading", { name: "Domains" });
    expect(
      home.queryByRole("region", { name: "From connected servers" }),
    ).not.toBeInTheDocument();
  });

  it("lists the domains a contributor works on, and never says the instance is empty", async () => {
    serve({
      "/domains": () => ({ behavior: [], domains: [] }),
      "/reflection/domains": () => ({
        domains: [
          {
            domain: "eng",
            state: "on",
            right: "edit",
            engrams_visible: false,
            home: "here",
            home_url: null,
            open_threads: 3,
          },
          {
            domain: "ops",
            state: "elsewhere",
            right: "read",
            engrams_visible: false,
            home: "elsewhere",
            home_url: "https://team.example.com",
            open_threads: 0,
          },
          {
            domain: "lab",
            state: "pending",
            right: "read",
            engrams_visible: false,
            home: null,
            home_url: null,
            open_threads: 0,
          },
        ],
      }),
    });
    renderApp("/");
    const section = await screen.findByRole("region", { name: "Reflection" });
    expect(within(section).getByRole("link", { name: "eng" })).toHaveAttribute(
      "href",
      "/d/eng/reflection",
    );
    expect(within(section).getByText("3 open threads")).toBeVisible();
    expect(
      within(section).getByRole("link", { name: "https://team.example.com" }),
    ).toBeVisible();
    // A Reflection that is not live yet says so instead of counting threads.
    expect(within(section).getByRole("link", { name: "lab" })).toHaveAttribute(
      "href",
      "/d/lab/reflection",
    );
    expect(within(section).getByText("Not open yet")).toBeVisible();
    expect(
      screen.queryByText("No domains are registered on this instance yet."),
    ).toBeNull();
  });

  it("says what a Reflection hosted by another instance, or without a home, is doing", async () => {
    serve({
      "/domains": () => ({ behavior: [], domains: [] }),
      "/reflection/domains": () => ({
        domains: [
          {
            domain: "a",
            state: "hosted_elsewhere",
            host_label: "node-2",
            right: "read",
            engrams_visible: false,
            home: null,
            home_url: null,
            open_threads: 0,
          },
          {
            domain: "b",
            state: "hosted_elsewhere",
            host_label: null,
            right: "read",
            engrams_visible: false,
            home: null,
            home_url: null,
            open_threads: 0,
          },
          {
            domain: "c",
            state: "homeless",
            right: "read",
            engrams_visible: false,
            home: null,
            home_url: null,
            open_threads: 0,
          },
        ],
      }),
    });
    renderApp("/");
    const section = await screen.findByRole("region", { name: "Reflection" });
    expect(
      within(section).getByText("Served by another instance: node-2"),
    ).toBeVisible();
    expect(
      within(section).getByText(
        "Being renamed. It opens again when the rename is done.",
      ),
    ).toBeVisible();
    expect(within(section).getAllByText("Not open yet")).toHaveLength(1);
  });

  it("leaves a domain whose engrams the caller reads out of the Reflection section", async () => {
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
            open_threads: 1,
          },
        ],
      }),
    });
    renderApp("/");
    expect(
      await (await main()).findByRole("heading", { name: "Domains" }),
    ).toBeVisible();
    expect(screen.queryByRole("region", { name: "Reflection" })).toBeNull();
  });
});
