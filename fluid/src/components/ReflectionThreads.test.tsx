import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblem, api } from "../api/client";
import type { Answer } from "../test/harness";
import {
  answersFor,
  meResponse,
  renderApp,
  userFixture,
} from "../test/harness";
import { ACTIVE_HIGHLIGHT, QUOTE_HIGHLIGHT } from "../reflectionQuotes";

vi.setConfig({ testTimeout: 15000 });
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});
const apiMock = vi.mocked(api);

const MARKDOWN =
  "# Deploying\n\n## Night deploys\n<!-- r:7f3a9c2e -->\n\nDeploys run **at** night.\nDeploys run at night, after the batch.\n";

function thread(id: string, overrides: Record<string, unknown> = {}) {
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
    waiting_on: "agent",
    opened_at: "2026-09-30T10:00:00Z",
    age_secs: 3600,
    entries: [
      {
        at: "2026-09-30T10:00:00Z",
        kind: "comment",
        author: { name: "vera", agent: false },
        text: "Still true?",
      },
    ],
    ...overrides,
  };
}

function serve(
  threads: unknown[],
  routes: Record<string, Answer> = {},
  markdown = MARKDOWN,
) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () =>
        meResponse({ user: userFixture({ name: "vera", role: "viewer" }) }),
      "/domains": () => ({ behavior: [], domains: [] }),
      "/reflection/domains": () => ({ domains: [] }),
      "/domains/eng/reflection": () => ({
        domain: "eng",
        enabled: true,
        state: "on",
        home: "local",
        home_url: null,
        right: "read",
        engrams_visible: true,
        member: false,
        pending_engrams: [],
      }),
      "/domains/eng/reflection/tree": () => ({
        domain: "eng",
        pact: { path: "PACT.md", title: "PACT", exists: true, open_threads: 0 },
        nodes: [],
      }),
      "/domains/eng/reflections/guides/deploying.md": () => ({
        domain: "eng",
        path: "guides/deploying.md",
        title: "Deploying",
        markdown,
        checksum: "c1",
        sections: [
          {
            id: "7f3a9c2e",
            heading: "Night deploys",
            line: 3,
            changed: false,
            sources: [],
          },
        ],
        threads,
      }),
      ...routes,
    }),
  );
}

/** The page's answer, with the threads `threads()` gives at the time. */
function docWith(threads: () => unknown[]): Answer {
  return () => ({
    domain: "eng",
    path: "guides/deploying.md",
    title: "Deploying",
    markdown: MARKDOWN,
    checksum: "c1",
    sections: [
      {
        id: "7f3a9c2e",
        heading: "Night deploys",
        line: 3,
        changed: false,
        sources: [],
      },
    ],
    threads: threads(),
  });
}

/** A request's JSON body. */
function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === "string" ? init.body : "null");
}

/** A fake highlight registry, so the paint is observable in jsdom. */
const registry = new Map<string, { ranges: Range[] }>();
class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}
const host = globalThis as unknown as { CSS?: unknown; Highlight?: unknown };
const saved = { CSS: host.CSS, Highlight: host.Highlight };

beforeEach(() => {
  apiMock.mockReset();
  registry.clear();
  host.CSS = { highlights: registry };
  host.Highlight = FakeHighlight;
});
afterEach(() => {
  vi.restoreAllMocks();
  host.CSS = saved.CSS;
  host.Highlight = saved.Highlight;
  window.getSelection()?.removeAllRanges();
});

/** Select from the start of one rendered text to an offset in another, as a reader would. */
function select(from: Text, to: Text, toOffset: number): void {
  const range = document.createRange();
  range.setStart(from, 0);
  range.setEnd(to, toOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

/** The first rendered text node that starts with `prefix`. */
function textNode(prefix: string): Text {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.textContent ?? "").startsWith(prefix)) {
      return node as Text;
    }
  }
  throw new Error(`no text starting with "${prefix}"`);
}

describe("comments on a reflection", () => {
  it("anchors a comment on the selected passage, source markers included", async () => {
    const opened = vi.fn((_path: string, _init?: RequestInit) =>
      thread("t-00000001"),
    );
    serve([], {
      "/domains/eng/reflection/threads": (path, init) => opened(path, init),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    await screen.findByText("at");
    select(textNode("Deploys run "), textNode(" night."), 6);
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(screen.getByText("Deploys run **at** night")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Your comment" })).toHaveFocus();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Your comment" }),
      "Still true?",
    );
    await userEvent.click(
      within(screen.getByRole("form", { name: "New comment" })).getByRole(
        "button",
        { name: "Comment" },
      ),
    );
    await waitFor(() => {
      expect(opened).toHaveBeenCalledTimes(1);
    });
    expect(bodyOf(opened.mock.calls[0]?.[1])).toEqual({
      path: "guides/deploying.md",
      section: "7f3a9c2e",
      quote: "Deploys run **at** night",
      occurrence: 1,
      text: "Still true?",
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Comment" })).toHaveFocus();
    });
  });

  it("lets go of the page passage when text in a thread is selected", async () => {
    serve([thread("t-00000001")]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    await screen.findByText("Still true?");
    select(textNode("Deploys run "), textNode(" night."), 6);
    const button = screen.getByRole("button", { name: "Comment" });
    expect(button).toHaveAttribute("aria-disabled", "false");
    const words = textNode("Still true?");
    select(words, words, 5);
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("returns focus to the Comment button when the comment is cancelled", async () => {
    serve([]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    await screen.findByText("at");
    select(textNode("Deploys run "), textNode(" night."), 6);
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "New comment" })).toBeNull();
    expect(screen.getByRole("button", { name: "Comment" })).toHaveFocus();
  });

  it("puts a passage it cannot pin on the section", async () => {
    const opened = vi.fn((_path: string, _init?: RequestInit) =>
      thread("t-00000001"),
    );
    serve(
      [],
      {
        "/domains/eng/reflection/threads": (path, init) => opened(path, init),
      },
      "# Deploying\n\n## Night deploys\n<!-- r:7f3a9c2e -->\n\nTom &amp; Jerry deploy.\n",
    );
    renderApp("/d/eng/reflection/guides/deploying.md");
    const words = await screen.findByText(/Jerry deploy/);
    const text = words.firstChild as Text;
    select(text, text, 3);
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(
      screen.getByText(
        "This passage cannot be pinned exactly, so the comment goes on the section.",
      ),
    ).toBeVisible();
    await userEvent.type(
      screen.getByRole("textbox", { name: "Your comment" }),
      "Who?",
    );
    await userEvent.click(
      within(screen.getByRole("form", { name: "New comment" })).getByRole(
        "button",
        { name: "Comment" },
      ),
    );
    await waitFor(() => {
      expect(opened).toHaveBeenCalledTimes(1);
    });
    expect(bodyOf(opened.mock.calls[0]?.[1])).toEqual({
      path: "guides/deploying.md",
      section: "7f3a9c2e",
      text: "Who?",
    });
  });

  it("shows the anonymous visitor every thread and no way to write one", async () => {
    serve([thread("t-00000001")], {
      "/auth/me": () => meResponse({ user: null, anonymous: true }),
      "/domains/eng/reflection/threads": () => ({
        threads: [
          thread("t-00000002", {
            status: "resolved",
            entries: [
              {
                at: "2026-09-30T11:00:00Z",
                kind: "resolve",
                author: { name: "ann", agent: false },
                text: "Done.",
              },
            ],
          }),
        ],
      }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(
      await screen.findByRole("article", { name: "Thread on Night deploys" }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Show resolved threads" }),
    );
    expect(await screen.findByText("Resolved: Done.")).toBeVisible();
    for (const name of ["Comment", "Answer", "Resolve", "Reopen"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("offers no way to write on a server that serves read-only", async () => {
    serve([thread("t-00000001")], {
      "/auth/me": () =>
        meResponse({
          user: userFixture({ name: "vera", role: "viewer" }),
          read_only: true,
        }),
      "/domains/eng/reflection/threads": () => ({
        threads: [
          thread("t-00000002", {
            status: "resolved",
            entries: [
              {
                at: "2026-09-30T11:00:00Z",
                kind: "resolve",
                author: { name: "ann", agent: false },
                text: "Done.",
              },
            ],
          }),
        ],
      }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(
      await screen.findByRole("article", { name: "Thread on Night deploys" }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Show resolved threads" }),
    );
    expect(await screen.findByText("Resolved: Done.")).toBeVisible();
    for (const name of ["Comment", "Answer", "Resolve", "Reopen"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("keeps the Comment button shut until something is selected", async () => {
    serve([]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const button = await screen.findByRole("button", { name: "Comment" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(
      "Select text on the page to comment on it.",
    );
  });

  it("a thread whose passage was rewritten shows the old quote and says the text changed", async () => {
    // The server answered "found" before an agent rewrote the passage; the
    // text on screen no longer holds it, and that is what counts.
    serve([
      thread("t-00000001", {
        anchor: {
          section: "7f3a9c2e",
          quote: "Deploys run in the morning",
          occurrence: 1,
          state: "found",
        },
      }),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    expect(within(card).getByText("Deploys run in the morning")).toBeVisible();
    expect(within(card).getByText("The text changed.")).toBeVisible();
    await waitFor(() => {
      expect(registry.get(QUOTE_HIGHLIGHT)?.ranges ?? []).toHaveLength(0);
    });
  });

  it("two threads on the same passage are both listed and both painted", async () => {
    serve([
      thread("t-00000001"),
      thread("t-00000002", {
        entries: [
          {
            at: "2026-09-30T10:01:00Z",
            kind: "comment",
            author: { name: "ann", agent: false },
            text: "Same question.",
          },
        ],
      }),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(
      await screen.findAllByRole("article", {
        name: "Thread on Night deploys",
      }),
    ).toHaveLength(2);
    expect(screen.getByText("Still true?")).toBeVisible();
    expect(screen.getByText("Same question.")).toBeVisible();
    await waitFor(() => {
      const ranges = registry.get(QUOTE_HIGHLIGHT)?.ranges ?? [];
      expect(ranges).toHaveLength(2);
      expect(ranges.map((r) => r.toString())).toEqual([
        "Deploys run at night",
        "Deploys run at night",
      ]);
    });
  });

  it("shows a quote cut inside emphasis without the stray markers", async () => {
    serve([
      thread("t-00000001", {
        anchor: {
          section: "7f3a9c2e",
          quote: "at** night",
          occurrence: 1,
          state: "found",
        },
      }),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    expect(within(card).getByText("at night")).toBeVisible();
    expect(within(card).queryByText("The text changed.")).toBeNull();
  });

  it("lists a thread whose section is gone under its own heading", async () => {
    serve([
      thread("t-00000001", {
        anchor: {
          section: "0b1c2d3e",
          quote: "Old text",
          occurrence: 1,
          state: "section_gone",
        },
      }),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    expect(
      await screen.findByRole("article", { name: "Thread on the page" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Not on the page any more" }),
    ).toBeVisible();
    expect(screen.getByText("Old text")).toBeVisible();
  });

  it("resolves with a short outcome and reopens visibly", async () => {
    const steps: { url: string; body: unknown }[] = [];
    // The server's state: the page lists the thread while it is open, the
    // resolved list while it is resolved.
    let status: "open" | "resolved" = "open";
    const resolvedThread = thread("t-00000001", {
      status: "resolved",
      entries: [
        {
          at: "2026-09-30T10:00:00Z",
          kind: "comment",
          author: { name: "vera", agent: false },
          text: "Still true?",
        },
        {
          at: "2026-09-30T11:00:00Z",
          kind: "resolve",
          author: { name: "claude-code", agent: true },
          text: "Yes, still at night.",
        },
      ],
    });
    const docRoute = docWith(() =>
      status === "open" ? [thread("t-00000001")] : [],
    );
    serve([], {
      "/domains/eng/reflections/guides/deploying.md": docRoute,
      "/domains/eng/reflection/threads/t-00000001/resolve": (url, init) => {
        steps.push({ url, body: bodyOf(init) });
        status = "resolved";
        return resolvedThread;
      },
      "/domains/eng/reflection/threads": () => ({
        threads: status === "resolved" ? [resolvedThread] : [],
      }),
      "/domains/eng/reflection/threads/t-00000001/reopen": (url, init) => {
        steps.push({ url, body: bodyOf(init) });
        status = "open";
        return thread("t-00000001");
      },
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    await userEvent.type(
      within(card).getByRole("textbox", { name: "Outcome" }),
      "Yes, still at night.",
    );
    await userEvent.click(
      within(card).getByRole("button", { name: "Resolve" }),
    );
    await waitFor(() => {
      expect(steps[0]).toEqual({
        url: "/domains/eng/reflection/threads/t-00000001/resolve",
        body: { path: "guides/deploying.md", outcome: "Yes, still at night." },
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("article", { name: "Thread on Night deploys" }),
      ).toBeNull();
    });
    expect(screen.getByRole("heading", { name: "Threads" })).toHaveFocus();
    await userEvent.click(
      screen.getByRole("button", { name: "Show resolved threads" }),
    );
    const resolved = await screen.findByText("Resolved: Yes, still at night.");
    const resolvedCard = resolved.closest("article") as HTMLElement;
    expect(resolvedCard).toHaveAccessibleName("Thread on Night deploys");
    expect(within(resolvedCard).getByText("(agent)")).toBeVisible();
    await userEvent.click(
      within(resolvedCard).getByRole("button", { name: "Reopen" }),
    );
    await waitFor(() => {
      expect(steps[1]?.url).toBe(
        "/domains/eng/reflection/threads/t-00000001/reopen",
      );
    });
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "Outcome" }),
      ).toBeInTheDocument();
    });
    // Reopened: listed once, as an open thread.
    expect(
      screen.getAllByRole("article", { name: "Thread on Night deploys" }),
    ).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Threads" })).toHaveFocus();
  });

  it("answers with the text and reads the page again", async () => {
    const answered = vi.fn((_path: string, _init?: RequestInit) =>
      thread("t-00000001"),
    );
    const docRoute = vi.fn(docWith(() => [thread("t-00000001")]));
    serve([], {
      "/domains/eng/reflections/guides/deploying.md": docRoute,
      "/domains/eng/reflection/threads/t-00000001/answer": (path, init) =>
        answered(path, init),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    const reads = docRoute.mock.calls.length;
    await userEvent.type(
      within(card).getByRole("textbox", { name: "Your answer" }),
      "Yes.",
    );
    await userEvent.click(within(card).getByRole("button", { name: "Answer" }));
    await waitFor(() => {
      expect(answered).toHaveBeenCalledTimes(1);
    });
    expect(bodyOf(answered.mock.calls[0]?.[1])).toEqual({
      path: "guides/deploying.md",
      text: "Yes.",
    });
    await waitFor(() => {
      expect(docRoute.mock.calls.length).toBeGreaterThan(reads);
    });
    expect(
      within(card).getByRole("textbox", { name: "Your answer" }),
    ).toHaveValue("");
  });

  it("paints the thread under the pointer a second time, and clears it all on leaving", async () => {
    serve([thread("t-00000001")]);
    const view = renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    await waitFor(() => {
      expect(registry.get(QUOTE_HIGHLIGHT)?.ranges ?? []).toHaveLength(1);
    });
    expect(registry.get(ACTIVE_HIGHLIGHT)?.ranges ?? []).toHaveLength(0);
    fireEvent.mouseEnter(card.parentElement as HTMLElement);
    await waitFor(() => {
      expect(
        (registry.get(ACTIVE_HIGHLIGHT)?.ranges ?? []).map((r) => r.toString()),
      ).toEqual(["Deploys run at night"]);
    });
    fireEvent.mouseLeave(card.parentElement as HTMLElement);
    await waitFor(() => {
      expect(registry.get(ACTIVE_HIGHLIGHT)?.ranges ?? []).toHaveLength(0);
    });
    view.unmount();
    expect(registry.size).toBe(0);
  });

  it("gives a thread its own id as the address, and a link to it scrolls there", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    serve([thread("t-00000001")]);
    renderApp("/d/eng/reflection/guides/deploying.md#t-00000001");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    expect(card).toHaveAttribute("id", "t-00000001");
    await waitFor(() => {
      expect(scrolled.mock.contexts).toContain(card);
    });
  });

  it("says a reopen with no words was reopened", async () => {
    serve([
      thread("t-00000001", {
        entries: [
          {
            at: "2026-09-30T10:00:00Z",
            kind: "reopen",
            author: { name: "vera", agent: false },
            text: "",
          },
        ],
      }),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    expect(within(card).getByText("Reopened")).toBeVisible();
  });

  it("shows a quote it cannot find on the page as it was stored", async () => {
    serve([
      thread("t-00000001", {
        anchor: {
          section: "7f3a9c2e",
          quote: "at** dawn",
          occurrence: 1,
          state: "text_changed",
        },
      }),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    expect(within(card).getByText("at** dawn")).toBeVisible();
  });

  it("treats an empty quote as a comment on the section", async () => {
    serve([
      thread("t-00000001", {
        anchor: {
          section: "7f3a9c2e",
          quote: "",
          occurrence: 1,
          state: "found",
        },
      }),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    expect(card.querySelector("blockquote")).toBeNull();
    expect(within(card).queryByText("The text changed.")).toBeNull();
  });

  it("lists resolved threads per section, a gone one under its own heading", async () => {
    serve([], {
      "/domains/eng/reflection/threads": () => ({
        threads: [
          thread("t-00000003", {
            status: "resolved",
            anchor: {
              section: "0b1c2d3e",
              quote: "Old text",
              occurrence: 1,
              state: "section_gone",
            },
          }),
        ],
      }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    await userEvent.click(
      await screen.findByRole("button", { name: "Show resolved threads" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Not on the page any more" }),
    ).toBeVisible();
    expect(
      screen.getByRole("article", { name: "Thread on the page" }),
    ).toBeVisible();
  });

  it("says when the resolved threads cannot be read", async () => {
    serve([], {
      "/domains/eng/reflection/threads": () => {
        throw new ApiProblem(500, "Internal Server Error", "the index is busy");
      },
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    await userEvent.click(
      await screen.findByRole("button", { name: "Show resolved threads" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the index is busy",
    );
  });
});
