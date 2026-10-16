/**
 * A domain's settings screen (`/d/:domain/settings`): every card the front
 * page drew before the MANIFEST became the page, under the same gates, and
 * the configuration sections with the way to start one. Each card has its
 * own suite; this file pins what the screen itself owns: that nothing moved
 * off the front page is lost, the order, the members gate, the start of a
 * configuration section, and the palette row the front page hands over.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { ApiProblem, api } from "../api/client";
import type { Answer } from "../test/harness";
import {
  answersFor,
  domainsResponse,
  manifestSectionsResponse,
  meResponse,
  renderApp,
  userFixture,
} from "../test/harness";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});

const apiMock = vi.mocked(api);

const MANIFEST = "# eng\n\nWhat this domain is for.\n";

function serve(
  routes: Record<string, Answer> = {},
  role: "admin" | "editor" = "admin",
) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () => meResponse({ user: userFixture({ role }) }),
      "/domains": domainsResponse,
      "/domains/eng/manifest": () => ({
        domain: "eng",
        markdown: MANIFEST,
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
      "/vocabulary": () => ({ domain: "eng", tags: [] }),
      "/domains/eng/members": () => ({
        owner: null,
        visibility: "shared",
        members: [],
      }),
      ...routes,
    }),
  );
}

/** Whether one element is drawn before another, in document order. */
function precedes(before: Element, after: Element): boolean {
  return (
    (before.compareDocumentPosition(after) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  );
}

beforeEach(() => {
  apiMock.mockReset();
  localStorage.clear();
});

describe("the domain settings screen", () => {
  it("holds every card that left the front page, in order", async () => {
    serve();

    renderApp("/d/eng/settings");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Domain settings" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "eng" })).toHaveAttribute(
      "href",
      "/d/eng",
    );
    const members = await screen.findByRole("region", { name: "Members" });
    const review = await screen.findByRole("region", { name: "Review mode" });
    const policies = await screen.findByRole("region", {
      name: "Domain policies",
    });
    const provisioning = screen.getByRole("region", { name: "Provisioning" });
    const aliases = screen.getByRole("region", { name: "Tag aliases" });
    const backup = screen.getByRole("region", { name: "Backup" });
    const danger = await screen.findByRole("region", { name: "Danger zone" });
    const order = [
      members,
      review,
      policies,
      provisioning,
      aliases,
      backup,
      danger,
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(precedes(order[i - 1] as Element, order[i] as Element)).toBe(true);
    }
    expect(
      within(backup).getByRole("link", { name: "Download archive" }),
    ).toBeVisible();
  });

  it("draws no members card for a caller the members read refuses", async () => {
    serve({
      "/domains/eng/members": () => {
        throw new ApiProblem(403, "forbidden", "not a member");
      },
    });

    renderApp("/d/eng/settings");

    await screen.findByRole("region", { name: "Domain policies" });
    await waitFor(() => {
      expect(
        apiMock.mock.calls.some((call) => call[0] === "/domains/eng/members"),
      ).toBe(true);
    });
    expect(screen.queryByRole("region", { name: "Members" })).toBeNull();
  });

  it("explains a configuration section that is not declared, and offers to start it", async () => {
    serve();

    renderApp("/d/eng/settings");

    const aliases = await screen.findByRole("region", { name: "Tag aliases" });
    // The meaning and the syntax, both the server's.
    expect(
      within(aliases).getByText(/Spellings that fold into one canonical tag/),
    ).toBeVisible();
    expect(within(aliases).getByText(/k8s -> kubernetes/)).toBeVisible();
    expect(
      within(aliases).getByRole("button", { name: "Add Tag Aliases" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Provisioning" })).getByRole(
        "button",
        { name: "Add Provisioning" },
      ),
    ).toBeVisible();
  });

  it("says nothing extra about a section that is declared, and lists its problems", async () => {
    serve({
      "/domains/eng/manifest": () => ({
        domain: "eng",
        markdown: MANIFEST,
        sections: manifestSectionsResponse({
          tag_aliases: {
            decls: [{ alias: "foo", canonical: "bar" }],
            problems: [
              {
                kind: "chained_alias",
                bullet: "foo -> bar",
                reason:
                  "canonical `bar` is itself an alias, resolution stays a single hop",
              },
            ],
          },
        }),
      }),
    });

    renderApp("/d/eng/settings");

    const aliases = await screen.findByRole("region", { name: "Tag aliases" });
    // A chained alias is a declaration AND a problem, so the bullet stands
    // twice: once in the list, once above the reason it was flagged for.
    expect(within(aliases).getAllByText("foo -> bar")).toHaveLength(2);
    expect(
      within(aliases).getByText(
        "canonical `bar` is itself an alias, resolution stays a single hop",
      ),
    ).toBeVisible();
    expect(
      within(aliases).queryByText(/Spellings that fold into one canonical tag/),
    ).toBeNull();
    expect(
      within(aliases).queryByRole("button", { name: "Add Tag Aliases" }),
    ).toBeNull();
  });

  it("shows the explanation but no action to a reader who cannot edit", async () => {
    serve({}, "editor");

    renderApp("/d/eng/settings");

    const aliases = await screen.findByRole("region", { name: "Tag aliases" });
    expect(
      within(aliases).getByText(/Spellings that fold into one canonical tag/),
    ).toBeVisible();
    expect(
      within(aliases).queryByRole("button", { name: "Add Tag Aliases" }),
    ).toBeNull();
  });

  it("draws the old bare line for a daemon that sends no startable sections", async () => {
    serve({
      "/domains/eng/manifest": () => ({
        domain: "eng",
        markdown: MANIFEST,
        sections: manifestSectionsResponse({ starters: [] }),
      }),
    });

    renderApp("/d/eng/settings");

    const aliases = await screen.findByRole("region", { name: "Tag aliases" });
    expect(within(aliases).getByText("No aliases")).toBeVisible();
    expect(
      within(aliases).queryByRole("button", { name: "Add Tag Aliases" }),
    ).toBeNull();
  });

  it("carries the section to the editor when the action is pressed", async () => {
    serve({ "/validate": () => ({ findings: [], errors: 0 }) });

    renderApp("/d/eng/settings");

    await userEvent.click(
      await screen.findByRole("button", { name: "Add Tag Aliases" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Editing eng MANIFEST" }),
    ).toBeVisible();
    const editor = await screen.findByLabelText("MANIFEST source");
    await waitFor(() => {
      expect(editor.textContent).toContain("## Tag Aliases");
    });
    expect(editor.textContent).toContain("k8s -> kubernetes");
  });

  it("arrives armed from the front page's Unregister domain palette row, at the question and focused", async () => {
    serve();
    const user = userEvent.setup();

    renderApp("/d/eng");
    await screen.findByRole("article", { name: "MANIFEST" });
    await user.keyboard("{Meta>}k{/Meta}");
    await user.click(
      await screen.findByRole("option", { name: /unregister domain/i }),
    );

    // The row asks, it does not act: the question waits in the danger zone,
    // in view and with the typed field focused.
    const card = await screen.findByRole("region", { name: "Danger zone" });
    const field = await within(card).findByLabelText("Type eng to confirm");
    await waitFor(() => {
      expect(field).toHaveFocus();
    });
    expect(card.closest("#danger-zone")).not.toBeNull();
  });

  it("clears the arming from the history entry, so a reload or a step back does not ask again", async () => {
    serve();
    let seen: unknown = "unset";
    function Probe() {
      seen = useLocation().state;
      return null;
    }

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/d/eng/settings",
            hash: "#danger-zone",
            state: { unregister: true },
          },
        ]}
      >
        <App />
        <Probe />
      </MemoryRouter>,
    );

    const card = await screen.findByRole("region", { name: "Danger zone" });
    expect(
      await within(card).findByLabelText("Type eng to confirm"),
    ).toBeVisible();
    // Replaced in place: same address, block kept, the arming gone.
    await waitFor(() => {
      expect(seen).toBeNull();
    });
  });

  it("answers an unknown domain the way the front page does", async () => {
    serve({
      "/domains/eng/tree": () => {
        throw new ApiProblem(404, "not found", "no domain");
      },
      "/reflection/domains": () => ({ domains: [] }),
    });

    renderApp("/d/eng/settings");

    expect(
      await screen.findByRole("heading", { name: "Domain not found" }),
    ).toBeVisible();
  });

  it("waits behind one loading state until its reads have answered", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    serve({
      "/domains/eng/members": async () => {
        await held;
        return { owner: null, visibility: "shared", members: [] };
      },
    });

    renderApp("/d/eng/settings");

    expect(
      await screen.findByRole("status", { name: "Loading the settings" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Domain policies" }),
    ).toBeNull();
    release();
    expect(
      await screen.findByRole("region", { name: "Members" }),
    ).toBeVisible();
  });

  it("opens a rail link at its block once the screen has loaded, also when members is refused", async () => {
    const scrolled: string[] = [];
    const spy = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(function (this: Element) {
        scrolled.push(this.id);
      });
    try {
      serve({
        "/domains/eng/members": () => {
          throw new ApiProblem(403, "forbidden", "not a member");
        },
      });
      renderApp("/d/eng/settings#policies");
      await screen.findByRole("region", { name: "Domain policies" });
      await waitFor(() => {
        expect(scrolled).toContain("policies");
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("shuts unregistering and the visibility switch while a rename runs", async () => {
    serve({
      "/domains": () => ({
        ...domainsResponse(),
        domains: [{ ...domainsResponse().domains[0], renaming: true }],
      }),
    });

    renderApp("/d/eng/settings");

    const REASON = "A rename of this domain is already running.";
    const unregister = await screen.findByRole("button", {
      name: "Unregister domain",
    });
    // The listing that says a rename runs lands after the card is drawn.
    await waitFor(() => {
      expect(unregister).toHaveAttribute("aria-disabled", "true");
    });
    expect(unregister).toHaveAccessibleDescription(REASON);
    const share = await screen.findByRole("button", { name: "Make private" });
    expect(share).toHaveAttribute("aria-disabled", "true");
    expect(share).toHaveAccessibleDescription(REASON);
    const importArchive = screen.getByRole("button", {
      name: "Import archive",
    });
    expect(importArchive).toHaveAttribute("aria-disabled", "true");
    expect(importArchive).toHaveAccessibleDescription(REASON);
  });
});
