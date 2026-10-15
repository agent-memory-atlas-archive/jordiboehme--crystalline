import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblem, api } from "../api/client";
import type { Answer } from "../test/harness";
import {
  answersFor,
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

const MARKDOWN =
  "---\ntitle: Deploying\nreflection:\n  7f3a9c2e:\n    sources:\n      - engram: runbooks/deploy\n        checksum: ab\n---\n\n# Deploying\n\nShort intro.\n\n## Night deploys\n<!-- r:7f3a9c2e -->\n\nDeploys run at night.\n";

function doc(overrides: Record<string, unknown> = {}) {
  return {
    domain: "eng",
    path: "guides/deploying.md",
    title: "Deploying",
    markdown: MARKDOWN,
    checksum: "c1",
    sections: [
      {
        id: "7f3a9c2e",
        heading: "Night deploys",
        line: 14,
        changed: false,
        sources: [
          {
            permalink: "runbooks/deploy",
            title: "Deploy runbook",
            state: "changed",
          },
        ],
      },
    ],
    threads: [],
    ...overrides,
  };
}

function status(right: string, engramsVisible: boolean) {
  return {
    domain: "eng",
    enabled: true,
    state: "on",
    home: "local",
    home_url: null,
    right,
    engrams_visible: engramsVisible,
    pending_engrams: [],
  };
}

function serve(
  right: string,
  engramsVisible: boolean,
  routes: Record<string, Answer> = {},
) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () =>
        meResponse({
          user: userFixture({
            name: "ann",
            role: engramsVisible ? "editor" : "viewer",
          }),
        }),
      "/domains": () => ({ behavior: [], domains: [] }),
      "/reflection/domains": () => ({ domains: [] }),
      "/domains/eng/reflection": () => status(right, engramsVisible),
      "/domains/eng/reflection/tree": () => ({
        domain: "eng",
        pact: { path: "PACT.md", title: "PACT", exists: true, open_threads: 0 },
        nodes: [],
      }),
      "/domains/eng/reflections/guides/deploying.md": () => doc(),
      ...routes,
    }),
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

describe("the reflection page", () => {
  it("renders the page without its frontmatter or its section ids", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(
      await screen.findByRole("heading", { name: "Deploying", level: 1 }),
    ).toBeVisible();
    const article = screen.getByRole("article");
    expect(
      await within(article).findByText("Deploys run at night."),
    ).toBeVisible();
    expect(article.textContent).not.toContain("r:7f3a9c2e");
    expect(article.textContent).not.toContain("reflection:");
    expect(
      article.querySelector("#s-7f3a9c2e")?.getAttribute("data-section"),
    ).toBe("7f3a9c2e");
    expect(article.querySelector("#s-_top")).not.toBeNull();
  });

  it("jumps from a section to its source engrams for a reader of engrams", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const toggle = await screen.findByRole("button", {
      name: "Sources for Night deploys",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    const link = screen.getByRole("link", { name: "Deploy runbook" });
    expect(link).toHaveAttribute("href", "/d/eng/e/runbooks/deploy");
    expect(
      within(link.closest("li") as HTMLElement).getByText("changed"),
    ).toBeVisible();
  });

  it("shows a contributor no sources at all", async () => {
    serve("edit", false, {
      "/domains/eng/reflections/guides/deploying.md": () =>
        doc({
          sections: [
            {
              id: "7f3a9c2e",
              heading: "Night deploys",
              line: 14,
              changed: false,
            },
          ],
        }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(await screen.findByText("Deploys run at night.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Sources for/ })).toBeNull();
    expect(document.body.innerHTML).not.toContain("runbooks/deploy");
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/d/eng/reflection-edit/guides/deploying.md",
    );
  });

  it("offers no Edit to a reader who may only comment, and says who is editing", async () => {
    serve("read", true, {
      "/domains/eng/reflections/guides/deploying.md": () =>
        doc({ live: { present: ["jordi", "claude-code"] } }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(
      await screen.findByText("jordi, claude-code editing now"),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("opens PACT.md like any page", async () => {
    serve("edit", false, {
      "/domains/eng/reflections/PACT.md": () =>
        doc({
          path: "PACT.md",
          title: "How we write",
          markdown: "# How we write\n\nFor new people.\n",
          sections: [],
        }),
    });
    renderApp("/d/eng/reflection/PACT.md");
    expect(
      await screen.findByRole("heading", { name: "How we write", level: 1 }),
    ).toBeVisible();
    expect(await screen.findByText("For new people.")).toBeVisible();
    // PACT.md is written by curators; a contributor proposes through a comment.
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  });

  it("says a missing page is missing", async () => {
    serve("edit", false, {
      "/domains/eng/reflections/guides/gone.md": () => {
        throw new ApiProblem(
          404,
          "not found",
          "no reflection 'guides/gone.md' in domain 'eng'",
        );
      },
    });
    renderApp("/d/eng/reflection/guides/gone.md");
    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
    expect(screen.getByText("No page at guides/gone.md in eng.")).toBeVisible();
  });

  it("keeps two sections without ids and with one heading apart", async () => {
    const md = "# T\n\n## Same\n\nfirst body\n\n## Same\n\nsecond body\n";
    serve("edit", false, {
      "/domains/eng/reflections/guides/deploying.md": () =>
        doc({
          markdown: md,
          sections: [
            { id: null, heading: "Same", line: 3, changed: false },
            { id: null, heading: "Same", line: 7, changed: false },
          ],
        }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(await screen.findByText("first body")).toBeVisible();
    expect(screen.getByText("second body")).toBeVisible();
    const ids = [
      ...screen.getByRole("article").querySelectorAll("section"),
    ].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows no sources to a reader without engrams even when the server sends them", async () => {
    serve("edit", false, {
      "/domains/eng/reflections/guides/deploying.md": () => doc(),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(await screen.findByText("Deploys run at night.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Sources for/ })).toBeNull();
  });

  it("points the toggle at a list that exists while closed", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const toggle = await screen.findByRole("button", {
      name: "Sources for Night deploys",
    });
    const id = toggle.getAttribute("aria-controls") as string;
    expect(document.getElementById(id)).toHaveAttribute("hidden");
  });

  it("names a failed read and links back to the Reflection", async () => {
    serve("edit", false, {
      "/domains/eng/reflections/guides/deploying.md": () => {
        throw new ApiProblem(500, "boom", "the server broke");
      },
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(
      await screen.findByRole("heading", {
        name: "The page could not be read",
      }),
    ).toBeVisible();
    expect(screen.getByText("the server broke")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "See the Reflection of eng" }),
    ).toBeVisible();
  });
});
