import { screen, within } from "@testing-library/react";
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

function serve(review: unknown = REVIEW, status: Record<string, unknown> = {}) {
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
        nodes: [],
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
    const list = within(queue).getByRole("list", { name: "Queue items" });
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
      return screen.findByRole("list", { name: "Queue items" });
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
      expect(within(list).getAllByRole("link")).toHaveLength(1);
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
      name: "Queue items",
    });
    expect(within(list).getByText("source_changed")).toBeVisible();
    expect(
      within(list).queryByRole("link", { name: "Deploy runbook" }),
    ).toBeNull();
    expect(queue.textContent).not.toContain("Deploy runbook");
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
