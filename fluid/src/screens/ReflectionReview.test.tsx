import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblem, api } from "../api/client";
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

function thread(id: string, waiting: string, age: number, text: string) {
  return {
    id,
    path: "guides/deploying.md",
    anchor: {
      section: "7f3a9c2e",
      quote: "Deploys run at night",
      occurrence: 1,
      state: "found",
    },
    status: "open",
    waiting_on: waiting,
    opened_at: "2026-09-30T10:00:00Z",
    age_secs: age,
    entries: [
      {
        at: "2026-09-30T10:00:00Z",
        kind: "comment",
        author: {
          name: waiting === "agent" ? "vera" : "claude-code",
          agent: waiting !== "agent",
        },
        text,
      },
    ],
  };
}

const REVIEW = {
  domain: "eng",
  waiting_for_people: [
    {
      path: "guides/deploying.md",
      title: "Deploying",
      threads: [
        thread(
          "t-00000002",
          "people",
          86400 * 2,
          "Is the batch window still 2am?",
        ),
      ],
    },
  ],
  waiting_for_the_agent: [
    {
      path: "guides/deploying.md",
      title: "Deploying",
      threads: [
        thread("t-00000001", "agent", 7200, "Still true?"),
        thread("t-00000003", "agent", 60, "Typo here."),
      ],
    },
  ],
  queue: {
    domain: "eng",
    total: 53,
    page: 1,
    limit: 50,
    count: 3,
    kinds: { feedback: 1, update: 1, review: 1 },
    queue: [
      {
        n: 1,
        kind: "feedback",
        what: "changed",
        path: "guides/deploying.md",
        section: "7f3a9c2e",
        heading: "Night deploys",
        age_secs: 86400,
        changed_by: ["vera"],
        diff: "@@ -1 +1 @@\n-<!-- r:7f3a9c2e -->\n-Deploys run at night.\n+Deploys run after the batch.\n",
      },
      {
        n: 2,
        kind: "update",
        what: "source_changed",
        path: "guides/deploying.md",
        section: "7f3a9c2e",
        heading: "Night deploys",
        age_secs: 3600,
        sources: [
          {
            permalink: "runbooks/deploy",
            title: "Deploy runbook",
            state: "changed",
          },
        ],
      },
      {
        n: 3,
        kind: "review",
        what: "thread",
        path: "guides/deploying.md",
        section: "7f3a9c2e",
        thread: "t-00000001",
        age_secs: 7200,
      },
    ],
    guidance: "Work the oldest first.",
  },
};

function serve(
  review: unknown = REVIEW,
  status: Record<string, unknown> = {},
  nodes: unknown[] = [],
) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () => meResponse({ user: userFixture() }),
      "/domains": () => ({ behavior: [], domains: [] }),
      "/reflection/domains": () => ({ domains: [] }),
      "/domains/eng/reflection": () => ({
        domain: "eng",
        enabled: true,
        state: "on",
        home: "local",
        home_url: null,
        right: "curate",
        engrams_visible: true,
        pending_engrams: [],
        ...status,
      }),
      "/domains/eng/reflection/tree": () => ({
        domain: "eng",
        pact: { path: "PACT.md", title: "PACT", exists: true, open_threads: 0 },
        nodes,
      }),
      "/domains/eng/reflection/review": () => {
        if (review instanceof Error) {
          throw review;
        }
        return review;
      },
    }),
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

describe("the review screen", () => {
  it("puts open threads first, split by who they wait for, oldest first with their age", async () => {
    serve();
    renderApp("/d/eng/reflection/review");
    expect(
      await screen.findByRole("heading", { name: "Review", level: 1 }),
    ).toBeVisible();
    await screen.findByRole("region", { name: "Waiting for people" });
    const headings = within(screen.getByRole("main"))
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Open threads", "Reflect queue"]);
    const people = screen.getByRole("region", { name: "Waiting for people" });
    expect(
      within(people).getByText("Is the batch window still 2am?"),
    ).toBeVisible();
    expect(within(people).getByText("waiting 2 days")).toBeVisible();
    const agent = screen.getByRole("region", { name: "Waiting for the agent" });
    const texts = within(agent)
      .getAllByText(/Still true\?|Typo here\./)
      .map((el) => el.textContent);
    expect(texts).toEqual(["Still true?", "Typo here."]);
    expect(
      within(agent).getByRole("link", { name: "Deploying" }),
    ).toHaveAttribute("href", "/d/eng/reflection/guides/deploying.md");
  });

  it("shows the reflect queue read-only: feedback and update, no review rows, no id lines", async () => {
    serve();
    renderApp("/d/eng/reflection/review");
    const queue = await screen.findByRole("region", { name: "Reflect queue" });
    const list = within(queue).getByRole("list", {
      name: "Queue items for Deploying",
    });
    const rows = Array.from(list.children) as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("feedback")).toBeVisible();
    expect(
      within(rows[0] as HTMLElement).getByText("changed by vera"),
    ).toBeVisible();
    expect(queue.textContent).not.toContain("r:7f3a9c2e");
    expect(
      within(rows[1] as HTMLElement).getByRole("link", {
        name: "Deploy runbook",
      }),
    ).toHaveAttribute("href", "/d/eng/e/runbooks/deploy");
    expect(within(queue).getByText("50 more in the queue")).toBeVisible();
    expect(within(queue).queryByRole("button")).toBeNull();
  });

  it("says an empty review is good news", async () => {
    serve({
      ...REVIEW,
      waiting_for_people: [],
      waiting_for_the_agent: [],
      queue: { ...REVIEW.queue, total: 0, count: 0, queue: [] },
    });
    renderApp("/d/eng/reflection/review");
    expect(await screen.findAllByText("Nobody is waiting.")).toHaveLength(2);
    expect(screen.getByText("The queue is empty.")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("links a thread to its place on the page and draws no page link for a row with no path", async () => {
    const queue = {
      ...REVIEW.queue,
      total: 1,
      count: 1,
      queue: [
        {
          n: 1,
          kind: "update",
          what: "host_moved",
          path: "",
          section: null,
          heading: "",
          age_secs: 60,
        },
      ],
    };
    serve({ ...REVIEW, queue });
    renderApp("/d/eng/reflection/review");
    const people = await screen.findByRole("region", {
      name: "Waiting for people",
    });
    expect(
      within(people).getByRole("link", { name: "waiting 2 days" }),
    ).toHaveAttribute(
      "href",
      "/d/eng/reflection/guides/deploying.md#t-00000002",
    );
    const list = await screen.findByRole("list", { name: "Queue items" });
    expect(within(list).getByText("host_moved")).toBeVisible();
    expect(within(list).queryByRole("link")).toBeNull();
  });

  describe("file items", () => {
    function serveItem(item: Record<string, unknown>, status = {}) {
      serve(
        {
          ...REVIEW,
          queue: { ...REVIEW.queue, total: 1, count: 1, queue: [item] },
        },
        status,
      );
    }
    async function queueList() {
      return screen.findByRole("list", { name: /^Queue items/ });
    }

    it("a missing file is named under its section", async () => {
      serveItem({
        n: 1,
        kind: "feedback",
        what: "asset_missing",
        path: "guides/deploying.md",
        section: "7f3a9c2e",
        heading: "Night deploys",
        age_secs: 60,
        assets: ["assets/guides/gone.png", "assets/guides/other.pdf"],
      });
      renderApp("/d/eng/reflection/review");
      const list = await queueList();
      expect(within(list).getByText("asset_missing")).toBeVisible();
      expect(within(list).getByText("assets/guides/gone.png")).toBeVisible();
      expect(within(list).getByText("assets/guides/other.pdf")).toBeVisible();
      expect(within(list).getAllByRole("link")).toHaveLength(1);
    });

    it("an engram attachment row names the link as written", async () => {
      serveItem({
        n: 1,
        kind: "feedback",
        what: "engram_attachment",
        path: "guides/deploying.md",
        section: null,
        heading: "",
        age_secs: 60,
        targets: ["../../notes/runbook.md"],
      });
      renderApp("/d/eng/reflection/review");
      const list = await queueList();
      expect(within(list).getByText("../../notes/runbook.md")).toBeVisible();
      // No section heading, so the page link is the group's own.
      expect(within(list).queryByRole("link")).toBeNull();
      expect(
        within(screen.getByRole("region", { name: "Reflect queue" })).getByRole(
          "link",
          { name: "Deploying" },
        ),
      ).toHaveAttribute("href", "/d/eng/reflection/guides/deploying.md");
    });

    it("an engram attachment row hides its targets from a reader who cannot see engrams", async () => {
      serveItem(
        {
          n: 1,
          kind: "feedback",
          what: "engram_attachment",
          path: "guides/deploying.md",
          section: null,
          heading: "",
          age_secs: 60,
          targets: ["../../notes/runbook.md"],
        },
        { engrams_visible: false },
      );
      renderApp("/d/eng/reflection/review");
      const list = await queueList();
      expect(within(list).getByText("engram_attachment")).toBeVisible();
      expect(within(list).queryByText("../../notes/runbook.md")).toBeNull();
    });

    it("an unreferenced file row links the file", async () => {
      serveItem({
        n: 1,
        kind: "update",
        what: "asset_unreferenced",
        path: "",
        section: null,
        heading: "",
        age_secs: 60,
        asset: "assets/guides/old.png",
      });
      renderApp("/d/eng/reflection/review");
      const list = await queueList();
      const link = within(list).getByRole("link", {
        name: "assets/guides/old.png",
      });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("href")).toContain(
        "/domains/eng/reflection/assets/",
      );
      expect(within(list).getAllByRole("link")).toHaveLength(1);
    });

    it("a host move row says what is only on the previous host, with no page link", async () => {
      serveItem({
        n: 4,
        kind: "update",
        what: "host_moved",
        domain: "eng",
        path: "",
        section: null,
        heading: "",
        age_secs: 12,
        only_elsewhere: {
          previous_host: "alpha",
          engrams: 1,
          attachments: 0,
          pages: 1,
          files: 1,
        },
      });
      renderApp("/d/eng/reflection/review");
      const list = await queueList();
      expect(
        within(list).getByText(
          "This instance took over the domain. Only on alpha: 1 engram, 1 page and 1 file.",
        ),
      ).toBeVisible();
      expect(
        within(list).getByText(
          "Copy the domain folder over and sync. If the files are gone for good, run crystalline sync --domain eng --accept-disk.",
        ),
      ).toBeVisible();
      expect(within(list).queryByRole("link")).toBeNull();
    });

    it("a host move row with no previous host says the previous instance", async () => {
      serveItem({
        n: 4,
        kind: "update",
        what: "host_moved",
        path: "",
        section: null,
        heading: "",
        age_secs: 12,
        only_elsewhere: { previous_host: null, attachments: 2 },
      });
      renderApp("/d/eng/reflection/review");
      const list = await queueList();
      expect(
        within(list).getByText(
          "This instance took over the domain. Only on the previous instance: 2 attachments.",
        ),
      ).toBeVisible();
    });
  });

  it("draws no source engram links or titles for a reader who cannot see engrams", async () => {
    serve(REVIEW, { engrams_visible: false });
    renderApp("/d/eng/reflection/review");
    const queue = await screen.findByRole("region", { name: "Reflect queue" });
    const list = await within(queue).findByRole("list", {
      name: /^Queue items/,
    });
    expect(within(list).getByText("source_changed")).toBeVisible();
    expect(
      within(list).queryByRole("link", { name: "Deploy runbook" }),
    ).toBeNull();
    expect(queue.textContent).not.toContain("Deploy runbook");
  });

  describe("the queue, grouped by page", () => {
    const DIFF = [
      "--- original",
      "+++ modified",
      "@@ -1,12 +1,12 @@",
      " line one",
      " line two",
      " line three",
      " line four",
      " line five",
      "-old sentence",
      "+new sentence",
      " line six",
      " line seven",
      " line eight",
      " line nine",
      " line ten",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    function queueOf(items: Record<string, unknown>[]) {
      return {
        ...REVIEW,
        waiting_for_people: [],
        waiting_for_the_agent: [],
        queue: {
          ...REVIEW.queue,
          total: items.length,
          count: items.length,
          queue: items,
        },
      };
    }
    const row = (n: number, path: string, extra = {}) => ({
      n,
      kind: "feedback",
      what: "changed",
      path,
      section: "7f3a9c2e",
      heading: "Night deploys",
      age_secs: 60,
      ...extra,
    });

    it("groups the items under one link per page, titled from the tree", async () => {
      serve(
        queueOf([
          row(1, "guides/deploying.md"),
          row(2, "ops/failover.md"),
          row(3, "guides/deploying.md", { what: "asset_missing" }),
          {
            n: 4,
            kind: "update",
            what: "asset_unreferenced",
            path: "",
            section: null,
            heading: "",
            age_secs: 60,
            asset: "assets/old.png",
          },
        ]),
        {},
        [
          {
            kind: "reflection",
            name: "deploying.md",
            path: "guides/deploying.md",
            title: "Deploying",
            open_threads: 0,
            sections: 2,
          },
        ],
      );
      renderApp("/d/eng/reflection/review");
      const queue = await screen.findByRole("region", {
        name: "Reflect queue",
      });
      const groups = await within(queue).findByRole("list", {
        name: "Pages in the queue",
      });
      const heads = within(groups)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent);
      // The path with no page comes last; a page the tree lacks shows its path.
      expect(heads).toEqual(["Deploying", "ops/failover.md", "Not on a page"]);
      const first = within(groups).getByRole("list", {
        name: "Queue items for Deploying",
      });
      expect(first.children).toHaveLength(2);
      expect(
        within(groups).getByRole("link", { name: "ops/failover.md" }),
      ).toHaveAttribute("href", "/d/eng/reflection/ops/failover.md");
    });

    it("shows the changed lines with a little context and no file header lines", async () => {
      serve(queueOf([row(1, "guides/deploying.md", { diff: DIFF })]));
      renderApp("/d/eng/reflection/review");
      const diff = await screen.findByRole("group", {
        name: "Changes in Night deploys",
      });
      expect(diff).toHaveTextContent("new sentence");
      expect(diff).toHaveTextContent("old sentence");
      // Two lines of context each side; the stretch before is left out.
      expect(diff).toHaveTextContent("line four");
      expect(diff).toHaveTextContent("line seven");
      expect(diff).not.toHaveTextContent("line three");
      expect(diff).not.toHaveTextContent("line eight");
      expect(diff).not.toHaveTextContent("line ten");
      expect(diff).toHaveTextContent("Removed: ");
      expect(diff).toHaveTextContent("Added: ");
      for (const hidden of [
        "--- original",
        "+++ modified",
        "No newline at end of file",
        "@@",
      ]) {
        expect(diff.textContent).not.toContain(hidden);
      }
    });

    it("opens the full diff behind a disclosure and closes it again", async () => {
      const user = userEvent.setup();
      serve(queueOf([row(1, "guides/deploying.md", { diff: DIFF })]));
      renderApp("/d/eng/reflection/review");
      const diff = await screen.findByRole("group", {
        name: "Changes in Night deploys",
      });
      const open = screen.getByRole("button", { name: "Show the full diff" });
      expect(open).toHaveAttribute("aria-expanded", "false");
      await user.click(open);
      expect(diff).toHaveTextContent("line one");
      expect(diff).toHaveTextContent("line ten");
      expect(diff.textContent).not.toContain("No newline");
      const close = screen.getByRole("button", {
        name: "Show only the changed lines",
      });
      expect(close).toHaveAttribute("aria-expanded", "true");
      await user.click(close);
      expect(diff).not.toHaveTextContent("line one");
    });

    it("offers no disclosure for a diff that is all change", async () => {
      serve(
        queueOf([
          row(1, "guides/deploying.md", {
            diff: "@@ -1 +1 @@\n-old\n+new\n",
          }),
        ]),
      );
      renderApp("/d/eng/reflection/review");
      await screen.findByRole("group", { name: "Changes in Night deploys" });
      expect(
        screen.queryByRole("button", { name: "Show the full diff" }),
      ).toBeNull();
    });

    it("leaks no engram names to a reader without engram rights", async () => {
      serve(
        queueOf([
          row(1, "guides/deploying.md", {
            sources: [
              {
                permalink: "runbooks/deploy",
                title: "Deploy runbook",
                state: "changed",
              },
            ],
            targets: ["../../notes/runbook.md"],
            engrams: ["runbooks/deploy"],
          }),
        ]),
        { engrams_visible: false },
      );
      renderApp("/d/eng/reflection/review");
      const queue = await screen.findByRole("region", {
        name: "Reflect queue",
      });
      await within(queue).findByRole("list", { name: /^Queue items/ });
      for (const leak of ["Deploy runbook", "runbooks/deploy", "runbook.md"]) {
        expect(queue.textContent).not.toContain(leak);
      }
    });
  });

  it("draws the open threads in the thread look: avatars, hairlines, a waiting line, no boxes", async () => {
    serve();
    renderApp("/d/eng/reflection/review");
    const agent = await screen.findByRole("region", {
      name: "Waiting for the agent",
    });
    const cards = within(agent).getAllByRole("article");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.className).not.toContain("border");
      expect(card.querySelector("[data-avatar]")).not.toBeNull();
      expect(card).toHaveTextContent("Waiting for the agent");
      expect(card.parentElement?.className).toContain("border-t border-hair");
    }
    expect(
      within(
        screen.getByRole("region", { name: "Waiting for people" }),
      ).getByRole("article"),
    ).toHaveTextContent("Waiting for people");
  });

  it("shows the state notice instead of the review while the Reflection is off", async () => {
    serve(REVIEW, { enabled: false, state: "off" });
    renderApp("/d/eng/reflection/review");
    expect(
      await screen.findByText(/The Reflection is off for this domain/),
    ).toBeVisible();
    expect(screen.queryByRole("region", { name: "Reflect queue" })).toBeNull();
    expect(
      apiMock.mock.calls.some(([path]) =>
        String(path).endsWith("/reflection/review"),
      ),
    ).toBe(false);
  });

  it("shows the server's own sentence to a reader whose right is none", async () => {
    serve(
      new ApiProblem(403, "forbidden", "You may not read this Reflection."),
      { right: "none" },
    );
    renderApp("/d/eng/reflection/review");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You may not read this Reflection.",
    );
    expect(screen.queryByRole("region", { name: "Reflect queue" })).toBeNull();
  });
});
