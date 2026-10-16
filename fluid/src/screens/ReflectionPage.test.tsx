import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE, ApiProblem, api } from "../api/client";
import {
  reflectionOfferKey,
  reflectionRoomKey,
} from "../collab/reflectionDraftKeys";
import { clearDraft, readDraft, writeDraft } from "../editor/drafts";
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
      // The Reflection's files: a page that links one lists it below the article.
      "/domains/eng/reflection/assets": () => ({ assets: [] }),
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

  it("draws one h1 when the page's own title is not its first line", async () => {
    serve("curate", true, {
      "/domains/eng/reflections/guides/deploying.md": () =>
        doc({
          markdown: MARKDOWN.replace(
            "\n# Deploying\n",
            "\n![shot.png](../assets/shot.png)\n\n# Deploying\n",
          ),
        }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    await within(await screen.findByRole("article")).findByText(
      "Deploys run at night.",
    );
    expect(
      screen.getAllByRole("heading", { name: "Deploying", level: 1 }),
    ).toHaveLength(1);
  });

  it("draws the header title when the intro holds a # line only in code", async () => {
    serve("curate", true, {
      "/domains/eng/reflections/guides/deploying.md": () =>
        doc({
          markdown: MARKDOWN.replace(
            "\n# Deploying\n",
            "\n```sh\n# not a title\n```\n",
          ),
        }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(
      await screen.findByRole("heading", { name: "Deploying", level: 1 }),
    ).toBeVisible();
  });

  /** The page with its `# Deploying` line written as `intro` instead. */
  function serveIntro(intro: string) {
    serve("curate", true, {
      "/domains/eng/reflections/guides/deploying.md": () =>
        doc({ markdown: MARKDOWN.replace("\n# Deploying\n", `\n${intro}\n`) }),
    });
  }

  async function titles(): Promise<HTMLElement[]> {
    await within(await screen.findByRole("article")).findByText(
      "Deploys run at night.",
    );
    return screen.getAllByRole("heading", { level: 1 });
  }

  it("takes a title underlined with = as the page's own", async () => {
    serveIntro("Deploying\n=========");
    renderApp("/d/eng/reflection/guides/deploying.md");
    const h1 = await titles();
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent("Deploying");
    expect(h1[0]?.closest("article")).not.toBeNull();
  });

  it("draws the header title when a # line is only in a tilde fence", async () => {
    serveIntro("~~~\n# not a title\n~~~");
    renderApp("/d/eng/reflection/guides/deploying.md");
    const h1 = await titles();
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent("Deploying");
    expect(h1[0]?.closest("article")).toBeNull();
  });

  it("draws the header title when a fence is never closed", async () => {
    serveIntro("```\n# not a title\nDeploying\n===");
    renderApp("/d/eng/reflection/guides/deploying.md");
    const h1 = await titles();
    expect(h1).toHaveLength(1);
    expect(h1[0]?.closest("article")).toBeNull();
  });

  it("jumps from a section to its source engrams for a reader of engrams", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const toggle = await screen.findByRole("button", {
      name: "1 source for Night deploys",
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
    expect(
      screen.queryByRole("button", { name: /^\d+ sources? for / }),
    ).toBeNull();
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

  it("drops the drafts of a page the server says is not there", async () => {
    const draft = {
      content: "## Gone\n\nText from another tab.\n",
      baseChecksum: "",
      savedAt: "2026-10-16T10:00:00Z",
    };
    writeDraft("ann", "eng", reflectionRoomKey("guides/gone.md"), draft);
    writeDraft("ann", "eng", reflectionOfferKey("guides/gone.md"), draft);
    writeDraft("ann", "eng", reflectionRoomKey("guides/here.md"), draft);
    serve("edit", false, {
      "/domains/eng/reflections/guides/gone.md": () => {
        throw new ApiProblem(404, "not found", "no reflection");
      },
    });
    renderApp("/d/eng/reflection/guides/gone.md");
    expect(
      await screen.findByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
    await waitFor(() => {
      expect(
        readDraft("ann", "eng", reflectionRoomKey("guides/gone.md")),
      ).toBeNull();
    });
    expect(
      readDraft("ann", "eng", reflectionOfferKey("guides/gone.md")),
    ).toBeNull();
    // Another page's draft is not this page's business.
    expect(
      readDraft("ann", "eng", reflectionRoomKey("guides/here.md")),
    ).not.toBeNull();
    clearDraft("ann", "eng", reflectionRoomKey("guides/here.md"));
  });

  it("keeps the drafts of a page it may not read", async () => {
    const draft = {
      content: "Mine.\n",
      baseChecksum: "",
      savedAt: "2026-10-16T10:00:00Z",
    };
    writeDraft("ann", "eng", reflectionRoomKey("guides/shut.md"), draft);
    serve("edit", false, {
      "/domains/eng/reflections/guides/shut.md": () => {
        throw new ApiProblem(403, "forbidden", "not yours");
      },
    });
    renderApp("/d/eng/reflection/guides/shut.md");
    expect(
      await screen.findByRole("heading", {
        name: "The page could not be read",
      }),
    ).toBeVisible();
    expect(
      readDraft("ann", "eng", reflectionRoomKey("guides/shut.md")),
    ).toEqual(draft);
    clearDraft("ann", "eng", reflectionRoomKey("guides/shut.md"));
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
    expect(
      screen.queryByRole("button", { name: /^\d+ sources? for / }),
    ).toBeNull();
  });

  it("counts a section's sources at the right end of its heading, with a dot when one changed", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const control = await screen.findByRole("button", {
      name: "1 source for Night deploys",
    });
    expect(control).toHaveTextContent("1 source");
    const heading = screen.getByRole("heading", {
      name: "Night deploys",
      level: 2,
    });
    expect(heading).toContainElement(control);
    expect(control.closest("[data-anchor-skip]")).not.toBeNull();
    expect(within(control).getByTestId("sources-changed")).toBeInTheDocument();
    expect(control).toHaveAccessibleDescription("A source changed.");
    // The list opens over the text, and Escape shuts it with focus back on
    // the control.
    await userEvent.click(control);
    expect(control).toHaveAttribute("aria-expanded", "true");
    const list = document.getElementById(
      control.getAttribute("aria-controls") as string,
    ) as HTMLElement;
    expect(list).toHaveClass("absolute");
    // Laid over the text after the heading, no part of it.
    expect(heading).not.toContainElement(list);
    expect(list.closest("[data-anchor-skip]")).not.toBeNull();
    expect(
      within(list).getByRole("link", { name: "Deploy runbook" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(control).toHaveFocus();
    await userEvent.click(control);
    await userEvent.click(screen.getByText("Deploys run at night."));
    expect(control).toHaveAttribute("aria-expanded", "false");
    // Focus leaving the control and the list shuts it too.
    await userEvent.click(control);
    await userEvent.tab();
    expect(
      within(list).getByRole("link", { name: "Deploy runbook" }),
    ).toHaveFocus();
    expect(control).toHaveAttribute("aria-expanded", "true");
    await userEvent.tab();
    expect(control).toHaveAttribute("aria-expanded", "false");
  });

  it("draws no dot when every source is current, and nothing for a section without sources", async () => {
    serve("curate", true, {
      "/domains/eng/reflections/guides/deploying.md": () =>
        doc({
          markdown: `${MARKDOWN}\n## Day deploys\n<!-- r:1a2b3c4d -->\n\nRarely.\n`,
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
                  state: "current",
                },
                {
                  permalink: "runbooks/night",
                  title: "Night runbook",
                  state: "current",
                },
              ],
            },
            {
              id: "1a2b3c4d",
              heading: "Day deploys",
              line: 19,
              changed: false,
              sources: [],
            },
          ],
        }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    const control = await screen.findByRole("button", {
      name: "2 sources for Night deploys",
    });
    expect(control).toHaveTextContent("2 sources");
    expect(within(control).queryByTestId("sources-changed")).toBeNull();
    expect(control).not.toHaveAccessibleDescription();
    expect(await screen.findByText("Rarely.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: / for Day deploys$/ }),
    ).toBeNull();
  });

  it("points the toggle at a list that exists while closed", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const toggle = await screen.findByRole("button", {
      name: "1 source for Night deploys",
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

describe("the reflection page header", () => {
  const THREAD = (id: string, status: string) => ({
    id,
    path: "guides/deploying.md",
    anchor: {
      section: "7f3a9c2e",
      quote: null,
      occurrence: 1,
      state: "found",
    },
    status,
    waiting_on: "people",
    opened_at: "2026-10-01T10:00:00Z",
    age_secs: 10,
    entries: [],
  });

  it("names the trail Reflection, folder, then the page's title", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const trail = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(
      within(trail).getByRole("link", { name: "Reflection" }),
    ).toHaveAttribute("href", "/d/eng/reflection");
    expect(within(trail).getByText("guides")).toBeVisible();
    expect(within(trail).getByText("Deploying")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(trail.textContent).not.toContain("deploying.md");
  });

  it("draws Edit as a secondary button and Print view, Move and Delete behind More actions", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const edit = await screen.findByRole("link", { name: "Edit" });
    expect(edit.className).not.toContain("bg-accent-700");
    // No red button at the top level any more.
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      (await screen.findAllByRole("menuitem")).map((row) => row.textContent),
    ).toEqual(["Print view", "Move", "Delete"]);
    // Move and Delete sit under a rule, after the safe row.
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete" }).className,
    ).toContain("text-red-700");
    expect(
      screen.getByRole("menuitem", { name: "Move" }).className,
    ).not.toContain("text-red");
  });

  it("gives a commenter Print view alone and an editor the same rows as a curator", async () => {
    serve("comment", false);
    const first = renderApp("/d/eng/reflection/guides/deploying.md");
    await screen.findByRole("heading", { name: "Deploying", level: 1 });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      (await screen.findAllByRole("menuitem")).map((row) => row.textContent),
    ).toEqual(["Print view"]);
    expect(screen.queryByRole("separator")).toBeNull();
    first.unmount();
    serve("edit", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );
    expect(
      (await screen.findAllByRole("menuitem")).map((row) => row.textContent),
    ).toEqual(["Print view", "Move", "Delete"]);
  });

  it("prints the page from Print view", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    serve("comment", false);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Print view" }),
    );
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("opens with Enter, walks with the arrows and returns focus on Escape", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const user = userEvent.setup();
    const more = await screen.findByRole("button", { name: "More actions" });
    more.focus();
    await user.keyboard("{Enter}");
    const print = await screen.findByRole("menuitem", { name: "Print view" });
    await waitFor(() => {
      expect(print).toHaveFocus();
    });
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Move" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(more).toHaveFocus();
  });

  it("asks twice before Delete and hands focus to the question", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "More actions" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const confirm = await screen.findByRole("button", {
      name: "Confirm delete",
    });
    await waitFor(() => {
      expect(confirm).toHaveFocus();
    });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus();
  });

  it("says sections, engrams and open threads on one line, leaving out zeros", async () => {
    serve("curate", true, {
      "/domains/eng/reflections/guides/deploying.md": () =>
        doc({ threads: [THREAD("t-1", "open"), THREAD("t-2", "resolved")] }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(
      await screen.findByText(
        "1 section \u00b7 Built from 1 engram \u00b7 1 open thread",
      ),
    ).toBeVisible();
  });

  it("draws the line straight under the body's own title, outside the text threads anchor on", async () => {
    serve("curate", true);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const h1 = await screen.findByRole("heading", {
      name: "Deploying",
      level: 1,
    });
    const line = await screen.findByText(
      "1 section \u00b7 Built from 1 engram",
    );
    expect(h1.nextElementSibling).toBe(line);
    expect(line.closest("article")).not.toBeNull();
    expect(line).toHaveAttribute("data-anchor-skip");
    // Said once: the header does not draw it a second time.
    expect(screen.getAllByText(/1 section/)).toHaveLength(1);
  });

  it("leaves the engram part out for a reader without engram rights, and zero threads", async () => {
    serve("comment", false);
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(await screen.findByText("1 section")).toBeVisible();
    expect(screen.queryByText(/Built from/)).toBeNull();
    expect(screen.queryByText(/open thread/)).toBeNull();
  });
});

describe("a reflection's images and files", () => {
  function servePage(path: string, body: string) {
    serve("read", false, {
      [`/domains/eng/reflections/${path}`]: () =>
        doc({
          path,
          markdown: `# Page\n\n${body}\n`,
          sections: [],
        }),
    });
  }

  it("a reader at knowledge none sees a reflection image from the Reflection's own route", async () => {
    servePage("guides/deploying.md", "![Flow](../assets/flow.png#right,w=50%)");
    renderApp("/d/eng/reflection/guides/deploying.md");
    const img = await screen.findByRole("img", { name: "Flow" });
    const src = img.getAttribute("src") ?? "";
    expect(src.endsWith("/domains/eng/reflection/assets/flow.png")).toBe(true);
    expect(src).not.toContain("/files/");
    const wrapper = img.closest("[style]") as HTMLElement;
    expect(wrapper.style.float).toBe("right");
    expect(wrapper.style.width).toBe("50%");
  });

  it("a root page's assets link is the Reflection's file, not the engram one", async () => {
    servePage("welcome.md", "![a](assets/a.png)");
    renderApp("/d/eng/reflection/welcome.md");
    const img = await screen.findByRole("img", { name: "a" });
    expect(
      (img.getAttribute("src") ?? "").endsWith("/reflection/assets/a.png"),
    ).toBe(true);
  });

  it("a link to a Reflection file opens its bytes in a new tab", async () => {
    servePage("guides/deploying.md", "[deck](../assets/deck.pdf)");
    renderApp("/d/eng/reflection/guides/deploying.md");
    const link = await screen.findByRole("link", { name: "deck" });
    expect(
      (link.getAttribute("href") ?? "").endsWith("/reflection/assets/deck.pdf"),
    ).toBe(true);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("an engram attachment in a reflection is never fetched", async () => {
    servePage(
      "welcome.md",
      "![shot](../assets/shot.png)\n\n![x](crystalline://eng/assets/x.png)",
    );
    renderApp("/d/eng/reflection/welcome.md");
    await screen.findAllByText(/This file is not in the Reflection/);
    const article = screen.getByRole("article");
    expect(article.querySelector("img")).toBeNull();
    expect(
      within(article).getAllByText(/This file is not in the Reflection/),
    ).toHaveLength(2);
  });

  it("never lets a script or data address reach an href or a src", async () => {
    servePage(
      "welcome.md",
      [
        "[w](javascript:alert(1)//../../assets/x.png)",
        "![i](javascript:alert(1)//../../assets/x.png)",
        "[m](JaVaScRiPt:alert(1)//../../assets/x.png)",
        "[v](vbscript:x//../../assets/x.png)",
        "[d](data:text/html,x//../../assets/x.png)",
        "<javascript:alert(1)//../../assets/x.png>",
      ].join("\n\n"),
    );
    renderApp("/d/eng/reflection/welcome.md");
    await screen.findByText("i");
    const article = screen.getByRole("article");
    const bad = /^\s*(javascript|vbscript|data):/i;
    for (const el of article.querySelectorAll("[href], [src]")) {
      expect(el.getAttribute("href") ?? "").not.toMatch(bad);
      expect(el.getAttribute("src") ?? "").not.toMatch(bad);
    }
  });
});

describe("a reflection's attachments", () => {
  const PAGE = "/domains/eng/reflections/guides/deploying.md";
  const ASSETS = "/domains/eng/reflection/assets";
  const LISTING = {
    assets: [
      {
        path: "assets/flow.png",
        mime: "image/png",
        size: 2048,
        modified: "2026-10-15T10:00:00Z",
        sha256: "abc",
      },
    ],
  };

  function serveFiles(right: string, routes: Record<string, Answer> = {}) {
    serve(right, right === "curate", {
      [PAGE]: () =>
        doc({
          markdown: "# Deploying\n\n![Flow](../assets/flow.png)\n",
          sections: [],
        }),
      [ASSETS]: () => LISTING,
      ...routes,
    });
  }

  function callsTo(route: string): number {
    return apiMock.mock.calls.filter(([path]) => path === route).length;
  }

  it.each(["edit", "read"])(
    "a contributor or reader (%s) sees the page's files and no curate controls",
    async (right) => {
      serveFiles(right);
      renderApp("/d/eng/reflection/guides/deploying.md");
      const region = await screen.findByRole("region", { name: "Attachments" });
      expect(await within(region).findByText("2.0 KiB")).toBeVisible();
      expect(within(region).getByText("flow.png")).toBeVisible();
      for (const name of [
        "Replace flow.png",
        "Move flow.png",
        "Remove flow.png",
      ]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
    },
  );

  const OLD = "1111111111111111aaaa";
  const NEW = "2222222222222222bbbb";

  /** flow.png under OLD until a PUT replaces it with NEW. */
  function serveReplace(routes: Record<string, Answer> = {}) {
    let sha = OLD;
    serveFiles("curate", {
      [ASSETS]: () => ({
        assets: [{ ...LISTING.assets[0], sha256: sha }],
      }),
      [`${ASSETS}/flow.png`]: () => {
        sha = NEW;
        return {
          path: "assets/flow.png",
          mime: "image/png",
          size: 3,
          sha256: NEW,
        };
      },
      ...routes,
    });
  }

  async function replaceFlow() {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Replace flow.png" }),
    );
    await user.upload(
      screen.getByLabelText("Replace flow.png: pick a file"),
      new File(["new"], "flow.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Replace" }));
  }

  it("a first load draws an image from one address only, the plain one", async () => {
    serveReplace();
    const seen: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const nodes =
          record.type === "attributes"
            ? [record.target]
            : [...record.addedNodes];
        for (const node of nodes) {
          if (!(node instanceof Element)) {
            continue;
          }
          const imgs =
            node instanceof HTMLImageElement
              ? [node]
              : [...node.querySelectorAll("img")];
          for (const img of imgs) {
            seen.push(img.getAttribute("src") ?? "");
          }
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src"],
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    const region = await screen.findByRole("region", { name: "Attachments" });
    // The listing has landed: the section shows the file's size.
    expect(await within(region).findByText("2.0 KiB")).toBeVisible();
    await screen.findByRole("img", { name: "Flow" });
    await act(async () => {
      await Promise.resolve();
    });
    observer.disconnect();
    expect(new Set(seen.filter((src) => src.includes("flow.png")))).toEqual(
      new Set([`${API_BASE}/domains/eng/reflection/assets/flow.png`]),
    );
  });

  it("a file replaced while one page was open is drawn anew on the next", async () => {
    serveReplace({
      "/domains/eng/reflections/PACT.md": () =>
        doc({
          path: "PACT.md",
          title: "PACT",
          markdown: "# PACT\n\n![Flow](assets/flow.png)\n",
          sections: [],
        }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    await screen.findByRole("region", { name: "Attachments" });
    await replaceFlow();
    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "Flow" }).getAttribute("src"),
      ).toMatch(/\?v=222222222222$/);
    });
    // The sidebar names the pact "How we write" whatever its title is.
    const pact = await within(
      screen.getByRole("navigation", { name: "Reflection of eng" }),
    ).findByRole("link", { name: "How we write" });
    expect(pact).toHaveAttribute("href", "/d/eng/reflection/PACT.md");
    await userEvent.click(pact);
    await screen.findByRole("heading", { name: "PACT", level: 1 });
    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "Flow" }).getAttribute("src"),
      ).toMatch(/\/reflection\/assets\/flow\.png\?v=222222222222$/);
    });
  });

  it("a replaced image is drawn from its new bytes, and no version reaches the text", async () => {
    serveReplace();
    renderApp("/d/eng/reflection/guides/deploying.md");
    const article = await screen.findByRole("article");
    const region = await screen.findByRole("region", { name: "Attachments" });
    expect(await within(region).findByText("2.0 KiB")).toBeVisible();
    // The bytes the page first drew are the baseline: no version yet.
    expect(
      (await within(article).findByRole("img", { name: "Flow" })).getAttribute(
        "src",
      ),
    ).toBe(`${API_BASE}/domains/eng/reflection/assets/flow.png`);
    await replaceFlow();
    await waitFor(() => {
      expect(
        within(article).getByRole("img", { name: "Flow" }).getAttribute("src"),
      ).toMatch(/\?v=222222222222$/);
    });
    // The version is an address for the browser only: no section id, no
    // source span and no text of the page carries it.
    expect(article.textContent).not.toContain("?v=");
    for (const el of article.querySelectorAll("*")) {
      for (const attr of el.attributes) {
        if (attr.name === "src" || attr.name === "href") {
          continue;
        }
        expect(attr.value).not.toContain("?v=");
      }
    }
  });

  it("a curator removes a file and the copy names the reflect queue", async () => {
    const removed = vi.fn(() => ({}));
    serveFiles("curate", { [`${ASSETS}/flow.png`]: removed });
    renderApp("/d/eng/reflection/guides/deploying.md");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Remove flow.png" }),
    );
    expect(
      screen.getByText(
        "Remove flow.png? Pages keep their links until edited. The reflect queue names them as missing.",
      ),
    ).toBeVisible();
    const pageReads = callsTo(PAGE);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(removed).toHaveBeenCalledWith(`${ASSETS}/flow.png`, {
        method: "DELETE",
      });
    });
    // The Reflection is refreshed, not only the listing.
    await waitFor(() => {
      expect(callsTo(PAGE)).toBeGreaterThan(pageReads);
    });
  });

  it("a move shows the server's receipt and refreshes every page", async () => {
    const moved = vi.fn(() => ({
      from: "assets/flow.png",
      to: "assets/diagrams/flow.png",
      links_rewritten: 2,
      links_failed: [{ path: "guides/other.md", reason: "not valid UTF-8" }],
      note: "the file moved; its index row did not follow",
    }));
    serveFiles("curate", { "/domains/eng/reflection/move-asset": moved });
    renderApp("/d/eng/reflection/guides/deploying.md");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Move flow.png" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Move flow.png" });
    const field = within(dialog).getByLabelText("New path");
    expect(field).toHaveValue("flow.png");
    await user.clear(field);
    await user.type(field, "diagrams/flow.png");
    const pageReads = callsTo(PAGE);
    const listingReads = callsTo(ASSETS);
    await user.click(within(dialog).getByRole("button", { name: "Move file" }));
    expect(
      await within(dialog).findByText("Moved. 2 links updated."),
    ).toBeVisible();
    expect(
      within(dialog).getByText("the file moved; its index row did not follow"),
    ).toBeVisible();
    expect(
      within(dialog).getByText("guides/other.md: not valid UTF-8"),
    ).toBeVisible();
    const [, init] = moved.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      from: "assets/flow.png",
      to: "assets/diagrams/flow.png",
    });
    // Every page that linked the file was rewritten: the Reflection is read again.
    await waitFor(() => {
      expect(callsTo(PAGE)).toBeGreaterThan(pageReads);
    });
    await waitFor(() => {
      expect(callsTo(ASSETS)).toBeGreaterThan(listingReads);
    });
  });

  it("a move refused while a page is open says so in the server's words", async () => {
    const sentence =
      "guides/deploying.md is open for editing; the file moves once the room is closed";
    serveFiles("curate", {
      "/domains/eng/reflection/move-asset": () => {
        throw new ApiProblem(409, "conflict", sentence);
      },
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Move flow.png" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Move flow.png" });
    const field = within(dialog).getByLabelText("New path");
    await user.clear(field);
    await user.type(field, "flow-2.png");
    await user.click(within(dialog).getByRole("button", { name: "Move file" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      sentence,
    );
  });
});
