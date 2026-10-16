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

/** The page's own text node holding `words`, and where they start in it. */
function pageText(words: string): { node: Text; at: number } {
  const root = document.querySelector("[data-section]")?.closest("article");
  if (!root) {
    throw new Error("no page");
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node.textContent ?? "").indexOf(words);
    if (at >= 0) {
      return { node: node as Text, at };
    }
  }
  throw new Error(`no page text holding "${words}"`);
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
    // The selection went with the send, and the button with it: focus
    // waits on the column's heading.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Threads" })).toHaveFocus();
    });
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
  });

  it("lets go of the page passage when text in a thread is selected", async () => {
    serve([thread("t-00000001")]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    await screen.findByText("Still true?");
    select(textNode("Deploys run "), textNode(" night."), 6);
    expect(screen.getByRole("button", { name: "Comment" })).toBeVisible();
    const words = textNode("Still true?");
    select(words, words, 5);
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    expect(
      screen.getByText("Select text in the page to comment on it."),
    ).toBeVisible();
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
      screen.getByRole("switch", { name: "Show resolved threads" }),
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
      screen.getByRole("switch", { name: "Show resolved threads" }),
    );
    expect(await screen.findByText("Resolved: Done.")).toBeVisible();
    for (const name of ["Comment", "Answer", "Resolve", "Reopen"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("shows a hint until something is selected, then the Comment button in its place", async () => {
    serve([]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const hint = await screen.findByText(
      "Select text in the page to comment on it.",
    );
    expect(hint).toBeVisible();
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    select(textNode("Deploys run"), textNode("Deploys run"), 6);
    const button = screen.getByRole("button", { name: "Comment" });
    expect(button).toBeVisible();
    expect(
      screen.queryByText("Select text in the page to comment on it."),
    ).toBeNull();
    // A collapse on the page takes the button back to the hint.
    const caret = textNode("Deploys run");
    select(caret, caret, 0);
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    expect(
      screen.getByText("Select text in the page to comment on it."),
    ).toBeVisible();
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
    await userEvent.click(
      within(card).getByRole("button", { name: "Resolve" }),
    );
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
      screen.getByRole("switch", { name: "Show resolved threads" }),
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
        screen.getByRole("button", { name: "Resolve" }),
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
    await userEvent.click(within(card).getByRole("button", { name: "Answer" }));
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
    // The form closes once the answer landed, and focus goes back to the
    // button that opened it.
    await waitFor(() => {
      expect(
        within(card).queryByRole("textbox", { name: "Your answer" }),
      ).toBeNull();
    });
    expect(within(card).getByRole("button", { name: "Answer" })).toHaveFocus();
  });

  it("shows an open thread with two quiet buttons and no form", async () => {
    serve([thread("t-00000001")]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    expect(within(card).getByRole("button", { name: "Answer" })).toBeVisible();
    expect(within(card).getByRole("button", { name: "Resolve" })).toBeVisible();
    expect(within(card).queryByRole("textbox")).toBeNull();
    expect(within(card).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("opens only the pressed form, with focus in its field", async () => {
    serve([thread("t-00000001")]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    await userEvent.click(
      within(card).getByRole("button", { name: "Resolve" }),
    );
    expect(
      within(card).getByRole("textbox", { name: "Outcome" }),
    ).toHaveFocus();
    expect(
      within(card).queryByRole("textbox", { name: "Your answer" }),
    ).toBeNull();
    expect(within(card).getAllByRole("textbox")).toHaveLength(1);
    expect(within(card).getByRole("button", { name: "Resolve" })).toBeVisible();
    expect(within(card).getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("closes the form on Cancel and returns focus to the button that opened it", async () => {
    serve([thread("t-00000001")]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    await userEvent.click(within(card).getByRole("button", { name: "Answer" }));
    await userEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(within(card).queryByRole("textbox")).toBeNull();
    expect(within(card).getByRole("button", { name: "Answer" })).toHaveFocus();
    await userEvent.click(
      within(card).getByRole("button", { name: "Resolve" }),
    );
    await userEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(within(card).getByRole("button", { name: "Resolve" })).toHaveFocus();
  });

  it("opens one form at a time in a card and leaves other cards alone", async () => {
    serve([
      thread("t-00000001"),
      thread("t-00000002", {
        anchor: {
          section: "7f3a9c2e",
          quote: null,
          occurrence: 1,
          state: "found",
        },
      }),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const cards = await screen.findAllByRole("article", {
      name: "Thread on Night deploys",
    });
    expect(cards).toHaveLength(2);
    await userEvent.click(
      within(cards[0] as HTMLElement).getByRole("button", { name: "Answer" }),
    );
    // Within a card the opened form replaces the row, so Resolve is not
    // offered beside an open Answer form.
    expect(
      within(cards[0] as HTMLElement).queryByRole("button", {
        name: "Resolve",
      }),
    ).toBeNull();
    expect(
      within(cards[1] as HTMLElement).getByRole("button", { name: "Resolve" }),
    ).toBeVisible();
  });

  it("keeps the form open with the server's text when a send fails", async () => {
    serve([thread("t-00000001")], {
      "/domains/eng/reflection/threads/t-00000001/resolve": () => {
        throw new ApiProblem(
          409,
          "Conflict",
          "Someone else resolved this thread.",
        );
      },
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    await userEvent.click(
      within(card).getByRole("button", { name: "Resolve" }),
    );
    await userEvent.type(
      within(card).getByRole("textbox", { name: "Outcome" }),
      "Done.",
    );
    await userEvent.click(
      within(card).getByRole("button", { name: "Resolve" }),
    );
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "Someone else resolved this thread.",
    );
    expect(within(card).getByRole("textbox", { name: "Outcome" })).toHaveValue(
      "Done.",
    );
  });

  it("puts the Comment button under the Threads header and keeps the selection on press", async () => {
    serve([]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const heading = await screen.findByRole("heading", { name: "Threads" });
    await screen.findByText("Deploys run");
    select(textNode("Deploys run"), textNode("Deploys run"), 6);
    const button = screen.getByRole("button", { name: "Comment" });
    expect(button.previousElementSibling).toBe(heading.parentElement);
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).not.toBe("");
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
      await screen.findByRole("switch", { name: "Show resolved threads" }),
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
      await screen.findByRole("switch", { name: "Show resolved threads" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the index is busy",
    );
  });

  it("shows resolved threads behind a switch, named for screen readers in full", async () => {
    serve([thread("t-00000001")], {
      "/domains/eng/reflection/threads": () => ({
        threads: [
          thread("t-00000002", {
            status: "resolved",
            entries: [
              {
                at: "2026-09-30T10:00:00Z",
                kind: "resolve",
                author: { name: "vera", agent: false },
                text: "Done.",
              },
            ],
          }),
        ],
      }),
    });
    renderApp("/d/eng/reflection/guides/deploying.md");
    const toggle = await screen.findByRole("switch", {
      name: "Show resolved threads",
    });
    expect(toggle).toHaveTextContent("Show resolved");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("1 open")).toBeVisible();
    expect(screen.queryByText("Resolved: Done.")).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText("Resolved: Done.")).toBeVisible();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("Resolved: Done.")).toBeNull();
  });

  it("draws a thread as quote, avatar, name and time, quiet actions and who it waits on", async () => {
    serve([
      thread("t-00000001"),
      thread("t-00000002", {
        waiting_on: "people",
        anchor: {
          section: "7f3a9c2e",
          quote: null,
          occurrence: 1,
          state: "found",
        },
        entries: [
          {
            at: "2026-09-30T10:00:00Z",
            kind: "comment",
            author: { name: "scribe", agent: true },
            text: "Checked.",
          },
        ],
      }),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const [first, second] = (await screen.findAllByRole("article", {
      name: "Thread on Night deploys",
    })) as [HTMLElement, HTMLElement];
    expect(first.querySelector("blockquote")).toHaveTextContent(
      "Deploys run at night",
    );
    const avatar = first.querySelector("[data-avatar]");
    expect(avatar).toHaveTextContent("V");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(within(first).getByText("vera")).toHaveClass("font-semibold");
    expect(within(first).getByText("Still true?")).toBeVisible();
    // Quiet text actions, not boxed buttons.
    for (const name of ["Answer", "Resolve"]) {
      const button = within(first).getByRole("button", { name });
      expect(button).toHaveClass("text-link");
      expect(button).not.toHaveClass("border");
    }
    expect(within(first).getByText("Waiting for the agent")).toBeVisible();
    expect(within(second).getByText("Waiting for people")).toBeVisible();
    expect(second.querySelector("[data-avatar]")).toHaveTextContent("S");
    expect(within(second).getByText("(agent)")).toBeVisible();
    // Threads are parted by hairlines, not drawn as boxes.
    expect(first).not.toHaveClass("border");
    expect(first.parentElement).toHaveClass("border-t");
  });

  it("gives the picked thread the wash and paints its quote as the active one", async () => {
    serve([
      thread("t-00000001"),
      thread("t-00000002", {
        anchor: {
          section: "7f3a9c2e",
          quote: "after the batch",
          occurrence: 1,
          state: "found",
        },
      }),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const [first, second] = (await screen.findAllByRole("article", {
      name: "Thread on Night deploys",
    })) as [HTMLElement, HTMLElement];
    await waitFor(() => {
      expect(registry.get(QUOTE_HIGHLIGHT)?.ranges ?? []).toHaveLength(2);
    });
    expect(first.parentElement).not.toHaveAttribute("data-picked");
    await userEvent.click(within(second).getByText("Still true?"));
    expect(second.parentElement).toHaveAttribute("data-picked");
    expect(second.parentElement).toHaveClass("bg-accent-50");
    expect(second.querySelector("blockquote")).toHaveClass("border-accent-400");
    expect(first.parentElement).not.toHaveAttribute("data-picked");
    await waitFor(() => {
      expect(
        (registry.get(ACTIVE_HIGHLIGHT)?.ranges ?? []).map((r) => r.toString()),
      ).toEqual(["after the batch"]);
    });
    // The pick stays when the pointer leaves the column.
    fireEvent.mouseLeave(second.parentElement as HTMLElement);
    expect(second.parentElement).toHaveAttribute("data-picked");
  });

  it("picks a thread from a tap on its quote in the text", async () => {
    serve([thread("t-00000001")]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const card = await screen.findByRole("article", {
      name: "Thread on Night deploys",
    });
    await waitFor(() => {
      expect(registry.get(QUOTE_HIGHLIGHT)?.ranges ?? []).toHaveLength(1);
    });
    const { node: words, at } = pageText("Deploys run at night, after");
    const spot = vi.fn(() => {
      const range = document.createRange();
      range.setStart(words, at + 3);
      range.collapse(true);
      return range;
    });
    const doc = document as unknown as { caretRangeFromPoint?: unknown };
    doc.caretRangeFromPoint = spot;
    try {
      fireEvent.click(words.parentElement as HTMLElement);
      expect(card.parentElement).toHaveAttribute("data-picked");
      await waitFor(() => {
        expect(registry.get(ACTIVE_HIGHLIGHT)?.ranges ?? []).toHaveLength(1);
      });
      // A tap on text with no quote lets the pick go.
      spot.mockImplementation(() => {
        const range = document.createRange();
        range.setStart(words, words.length - 1);
        range.collapse(true);
        return range;
      });
      fireEvent.click(words.parentElement as HTMLElement);
      expect(card.parentElement).not.toHaveAttribute("data-picked");
    } finally {
      delete doc.caretRangeFromPoint;
    }
  });

  it("anchors the same with a sources count at the heading, which is no part of the text", async () => {
    const opened = vi.fn((_path: string, _init?: RequestInit) =>
      thread("t-00000001"),
    );
    serve(
      [
        thread("t-00000009", {
          anchor: {
            section: "7f3a9c2e",
            quote: "Night deploys",
            occurrence: 1,
            state: "found",
          },
        }),
      ],
      {
        "/domains/eng/reflection/threads": (path, init) => opened(path, init),
        "/domains/eng/reflections/guides/deploying.md": () => ({
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
              sources: [
                {
                  permalink: "runbooks/deploy",
                  title: "Deploy",
                  state: "changed",
                },
              ],
            },
          ],
          threads: [
            thread("t-00000009", {
              anchor: {
                section: "7f3a9c2e",
                quote: "Night deploys",
                occurrence: 1,
                state: "found",
              },
            }),
          ],
        }),
      },
    );
    renderApp("/d/eng/reflection/guides/deploying.md");
    const control = await screen.findByRole("button", {
      name: "Sources for Night deploys",
    });
    expect(control).toHaveTextContent("1 source");
    // The heading keeps its own name, and its quote paints its own words.
    expect(
      screen.getByRole("heading", { name: "Night deploys", level: 2 }),
    ).toBeVisible();
    await waitFor(() => {
      expect(
        (registry.get(QUOTE_HIGHLIGHT)?.ranges ?? []).map((r) => r.toString()),
      ).toEqual(["Night deploys"]);
    });
    // A selection from the heading's words over the control reads as the
    // heading alone.
    const label = textNode("1 source");
    select(textNode("Night deploys"), label, label.length);
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Your comment" }),
      "Which night?",
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
    expect(bodyOf(opened.mock.calls[0]?.[1])).toMatchObject({
      section: "7f3a9c2e",
      quote: "Night deploys",
      occurrence: 1,
    });
    // And the body still anchors at its own offsets.
    select(textNode("Deploys run "), textNode(" night."), 6);
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(screen.getByText("Deploys run **at** night")).toBeVisible();
  });
});

describe("threads on a narrow screen", () => {
  // jsdom has no media queries at all; one is lent for these tests.
  const media = window as unknown as { matchMedia?: unknown };
  beforeEach(() => {
    // Wide enough for the sidebar, too narrow for the threads column.
    media.matchMedia = (query: string) => ({
      matches: !query.includes("80rem"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
  });
  afterEach(() => {
    delete media.matchMedia;
  });

  it("opens the threads from a pill as a sheet, and Escape gives focus back", async () => {
    serve([thread("t-00000001"), thread("t-00000002")]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    const pill = await screen.findByRole("button", { name: "Show 2 threads" });
    expect(pill).toHaveTextContent("2 threads");
    expect(screen.queryByRole("complementary", { name: "Threads" })).toBeNull();
    expect(screen.queryByRole("article", { name: /^Thread/ })).toBeNull();
    await userEvent.click(pill);
    const sheet = await screen.findByRole("dialog", { name: "Threads" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(
      within(sheet).getAllByRole("article", {
        name: "Thread on Night deploys",
      }),
    ).toHaveLength(2);
    expect(
      within(sheet).getByRole("heading", { name: "Threads" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Threads" })).toBeNull();
    });
    expect(pill).toHaveFocus();
  });

  it("opens the sheet at the thread whose quote was tapped", async () => {
    serve([
      thread("t-00000001", {
        anchor: {
          section: "7f3a9c2e",
          quote: "after the batch",
          occurrence: 1,
          state: "found",
        },
      }),
      thread("t-00000002"),
    ]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    await screen.findByRole("button", { name: "Show 2 threads" });
    await waitFor(() => {
      expect(registry.get(QUOTE_HIGHLIGHT)?.ranges ?? []).toHaveLength(2);
    });
    const { node: words, at } = pageText("after the batch");
    const doc = document as unknown as { caretRangeFromPoint?: unknown };
    doc.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(words, at + 2);
      range.collapse(true);
      return range;
    };
    try {
      fireEvent.click(words.parentElement as HTMLElement);
    } finally {
      delete doc.caretRangeFromPoint;
    }
    const sheet = await screen.findByRole("dialog", { name: "Threads" });
    const picked = sheet.querySelector("#t-00000001") as HTMLElement;
    await waitFor(() => {
      expect(picked).toHaveFocus();
    });
    expect(picked.parentElement).toHaveAttribute("data-picked");
  });

  it("keeps an answer in progress when the sheet is shut and opened again", async () => {
    serve([thread("t-00000001")]);
    renderApp("/d/eng/reflection/guides/deploying.md");
    await userEvent.click(
      await screen.findByRole("button", { name: "Show 1 thread" }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Threads" });
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Answer" }),
    );
    await userEvent.type(
      within(sheet).getByRole("textbox", { name: "Your answer" }),
      "Half a th",
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Close the threads" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Threads" })).toBeNull();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Show 1 thread" }),
    );
    const again = await screen.findByRole("dialog", { name: "Threads" });
    expect(
      within(again).getByRole("textbox", { name: "Your answer" }),
    ).toHaveValue("Half a th");
  });

  it("opens the sheet at a thread a link names", async () => {
    serve([thread("t-00000001")]);
    renderApp("/d/eng/reflection/guides/deploying.md#t-00000001");
    const sheet = await screen.findByRole("dialog", { name: "Threads" });
    const card = within(sheet).getByRole("article", {
      name: "Thread on Night deploys",
    });
    await waitFor(() => {
      expect(card).toHaveFocus();
    });
  });
});
