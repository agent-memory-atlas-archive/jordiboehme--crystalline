import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import type { Answer } from "../test/harness";
import {
  answersFor,
  meResponse,
  renderApp,
  userFixture,
} from "../test/harness";
import { reflectionPathOf } from "../paths";
import { ReflectionNav } from "./ReflectionNav";

vi.setConfig({ testTimeout: 15000 });
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});
const apiMock = vi.mocked(api);

/** A folder chain `l1/l2/.../lN` with one page at the bottom. */
function deepTree(depth: number) {
  const names = Array.from({ length: depth }, (_, i) => `l${String(i + 1)}`);
  let node: unknown = {
    kind: "reflection",
    name: "bottom.md",
    path: `${names.join("/")}/bottom.md`,
    title: "The bottom page",
    open_threads: 0,
    sections: 1,
  };
  for (let i = depth; i >= 1; i -= 1) {
    node = {
      kind: "folder",
      name: names[i - 1],
      path: names.slice(0, i).join("/"),
      children: [node],
    };
  }
  return {
    domain: "eng",
    pact: {
      path: "PACT.md",
      title: "How we write",
      exists: true,
      open_threads: 0,
    },
    nodes: [
      node,
      {
        kind: "reflection",
        name: "top.md",
        path: "top.md",
        title: "Top page",
        open_threads: 2,
        sections: 1,
      },
    ],
  };
}

function serve(routes: Record<string, Answer> = {}) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () =>
        meResponse({ user: userFixture({ name: "ann", role: "viewer" }) }),
      "/domains": () => ({ behavior: [], domains: [] }),
      "/reflection/domains": () => ({
        domains: [
          {
            domain: "eng",
            right: "edit",
            engrams_visible: false,
            home: "here",
            home_url: null,
            open_threads: 2,
          },
        ],
      }),
      "/domains/eng/reflection": () => ({
        domain: "eng",
        enabled: true,
        state: "on",
        home: "here",
        home_url: null,
        right: "edit",
        engrams_visible: false,
        pending_engrams: [],
      }),
      "/domains/eng/reflection/tree": () => deepTree(12),
      ...routes,
    }),
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

describe("reflectionPathOf", () => {
  it("reads the page path out of the domain splat", () => {
    expect(reflectionPathOf("reflection/guides/a.md")).toBe("guides/a.md");
    expect(reflectionPathOf("reflection-edit/guides/a.md")).toBe("guides/a.md");
    expect(reflectionPathOf("reflection")).toBe("");
    expect(reflectionPathOf("reflection/review")).toBe("");
    expect(reflectionPathOf("e/notes/a")).toBeNull();
    expect(reflectionPathOf("")).toBeNull();
  });
});

describe("the reflection tree", () => {
  it("a page twelve folders deep opens its whole path and is marked current", async () => {
    serve();
    const path = `${Array.from({ length: 12 }, (_, i) => `l${String(i + 1)}`).join("/")}/bottom.md`;
    renderApp(`/d/eng/reflection/${path}`);
    const nav = await screen.findByRole("navigation", {
      name: "Reflection of eng",
    });
    const current = await within(nav).findByRole("link", {
      name: "The bottom page",
    });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute("title", "The bottom page");
    for (let i = 1; i <= 12; i += 1) {
      expect(
        within(nav).getByRole("button", { name: `Collapse l${String(i)}` }),
      ).toHaveAttribute("aria-expanded", "true");
    }
    // Indentation stops growing after six levels, so the name keeps its room.
    const indents = Array.from(nav.querySelectorAll("[data-depth]")).map((el) =>
      el.className.includes("ml-3"),
    );
    expect(indents.filter(Boolean)).toHaveLength(6);
  });

  it("lists the pact first, pages with their open threads, and the review screen", async () => {
    serve();
    renderApp("/d/eng/reflection");
    const nav = await screen.findByRole("navigation", {
      name: "Reflection of eng",
    });
    // The tree arrives after the frame, so wait for the pact first.
    await within(nav).findByRole("link", { name: "How we write" });
    const links = within(nav).getAllByRole("link");
    expect(links[0]).toHaveAccessibleName("eng");
    expect(links[0]).toHaveAttribute("href", "/d/eng/reflection");
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[1]).toHaveAccessibleName("How we write");
    expect(within(nav).getByRole("link", { name: "Top page" })).toHaveAttribute(
      "href",
      "/d/eng/reflection/top.md",
    );
    expect(within(nav).getByText("2 open threads")).toBeInTheDocument();
    expect(within(nav).getByTitle("2 open threads")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/d/eng/reflection/review",
    );
  });

  it("folds a folder from its own button without leaving the page", async () => {
    serve();
    renderApp("/d/eng/reflection");
    const nav = await screen.findByRole("navigation", {
      name: "Reflection of eng",
    });
    await userEvent.click(
      await within(nav).findByRole("button", { name: "Expand l1" }),
    );
    expect(
      within(nav).getByRole("button", { name: "Collapse l1" }),
    ).toBeVisible();
    expect(
      within(nav).getByRole("button", { name: "Expand l2" }),
    ).toBeVisible();
  });

  it("opens the folders on the way when the reader walks to a page, and keeps the ones they opened", async () => {
    serve();
    const deep = `/d/eng/reflection/${Array.from({ length: 12 }, (_, i) => `l${String(i + 1)}`).join("/")}/bottom.md`;
    function Walk() {
      const navigate = useNavigate();
      const { pathname } = useLocation();
      return (
        <>
          <button type="button" onClick={() => void navigate(deep)}>
            walk
          </button>
          <ReflectionNav
            domain="eng"
            path={
              pathname === deep ? deep.slice("/d/eng/reflection/".length) : ""
            }
          />
        </>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/d/eng/reflection"]}>
          <Walk />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const nav = await screen.findByRole("navigation", {
      name: "Reflection of eng",
    });
    await userEvent.click(
      await within(nav).findByRole("button", { name: "Expand l1" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "walk" }));
    expect(
      await within(nav).findByRole("button", { name: "Collapse l12" }),
    ).toBeVisible();
    expect(
      within(nav).getByRole("button", { name: "Collapse l1" }),
    ).toBeVisible();
  });
});
