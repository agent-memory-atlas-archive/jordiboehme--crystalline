import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./client";
import {
  moveReflection,
  openThread,
  readDoc,
  readQueue,
  readThread,
  readTree,
  saveReflection,
  searchReflections,
  stepThread,
} from "./reflection";
import {
  reflectionEditRoute,
  reflectionPageRoute,
  reflectionReviewRoute,
} from "../paths";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, api: vi.fn() };
});
const apiMock = vi.mocked(api);

const THREAD = {
  id: "t-3f9a2c1b",
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
      author: { name: "jordi", agent: false },
      text: "Still true?",
    },
  ],
};

beforeEach(() => {
  apiMock.mockReset();
});

describe("readers", () => {
  it("reads a tree, folders and pages, and the pact apart from them", () => {
    const tree = readTree({
      domain: "eng",
      pact: {
        path: "PACT.md",
        title: "How we write",
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
              sections: 4,
            },
          ],
        },
        { kind: "mystery", path: "x" },
      ],
    });
    expect(tree.pact).toEqual({
      path: "PACT.md",
      title: "How we write",
      exists: true,
      openThreads: 1,
    });
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]).toMatchObject({ kind: "folder", path: "guides" });
  });

  it("keeps absent sources absent, never empty", () => {
    const doc = readDoc({
      domain: "eng",
      path: "guides/deploying.md",
      title: "Deploying",
      markdown: "# Deploying\n",
      checksum: "abc",
      sections: [
        { id: "7f3a9c2e", heading: "Night deploys", line: 3, changed: false },
        {
          id: "0b1c2d3e",
          heading: "Other",
          line: 9,
          changed: true,
          sources: [
            {
              permalink: "runbooks/deploy",
              title: "Deploy runbook",
              state: "changed",
            },
          ],
        },
      ],
      threads: [THREAD],
    });
    expect(doc.sections[0]?.sources).toBeNull();
    expect(doc.sections[1]?.sources).toEqual([
      {
        permalink: "runbooks/deploy",
        title: "Deploy runbook",
        state: "changed",
      },
    ]);
    expect(doc.threads[0]?.waitingOn).toBe("agent");
    expect(doc.livePresent).toEqual([]);
  });

  it("reads an unknown anchor state as text_changed, which never paints", () => {
    expect(
      readThread({ ...THREAD, anchor: { ...THREAD.anchor, state: "odd" } })
        ?.anchor.state,
    ).toBe("text_changed");
  });

  it("reads a queue and keeps an unreflected item's count without its engrams", () => {
    const queue = readQueue({
      total: 2,
      kinds: { feedback: 1, update: 1, review: 0 },
      queue: [
        {
          n: 1,
          kind: "feedback",
          what: "changed",
          path: "a.md",
          section: "7f3a9c2e",
          heading: "A",
          age_secs: 10,
          changed_by: ["ann"],
          diff: "@@\n-x\n+y\n",
        },
        {
          n: 2,
          kind: "update",
          what: "unreflected",
          path: "",
          age_secs: 5,
          count: 12,
        },
      ],
      guidance: "Work the oldest first.",
    });
    expect(queue.items[0]).toMatchObject({
      kind: "feedback",
      changedBy: ["ann"],
      sources: null,
    });
    expect(queue.items[1]).toMatchObject({
      what: "unreflected",
      count: 12,
      engrams: [],
    });
  });
});

describe("calls", () => {
  it("saves with the checksum it read and asks for a create when told", async () => {
    apiMock.mockResolvedValue({
      checksum: "new",
      created: true,
      ids_assigned: [],
    });
    await saveReflection("eng", "guides/new page.md", "# New\n", {
      create: true,
    });
    expect(apiMock).toHaveBeenCalledWith(
      "/domains/eng/reflections/guides/new%20page.md",
      {
        method: "PUT",
        body: JSON.stringify({ markdown: "# New\n", create: true }),
      },
    );
  });

  it("opens a thread with its quote and occurrence, and steps it by action", async () => {
    apiMock.mockResolvedValue(THREAD);
    await openThread("eng", {
      path: "guides/deploying.md",
      section: "7f3a9c2e",
      quote: "Deploys run at night",
      occurrence: 2,
      text: "Still true?",
    });
    expect(apiMock).toHaveBeenLastCalledWith(
      "/domains/eng/reflection/threads",
      {
        method: "POST",
        body: JSON.stringify({
          path: "guides/deploying.md",
          section: "7f3a9c2e",
          quote: "Deploys run at night",
          occurrence: 2,
          text: "Still true?",
        }),
      },
    );
    await stepThread("eng", "t-3f9a2c1b", "resolve", {
      path: "guides/deploying.md",
      outcome: "Yes.",
    });
    expect(apiMock).toHaveBeenLastCalledWith(
      "/domains/eng/reflection/threads/t-3f9a2c1b/resolve",
      {
        method: "POST",
        body: JSON.stringify({ path: "guides/deploying.md", outcome: "Yes." }),
      },
    );
  });

  it("searches with the mode asked for and reads which mode ran", async () => {
    apiMock.mockResolvedValue({
      domain: "eng",
      query: "night",
      mode: "text",
      total: 21,
      page: 2,
      limit: 20,
      count: 1,
      hits: [
        {
          path: "guides/deploying.md",
          title: "Deploying",
          section: "_top",
          heading: "",
          snippet: "Short intro.",
        },
      ],
    });
    const found = await searchReflections("eng", {
      query: "night",
      mode: "semantic",
      page: 2,
    });
    expect(apiMock).toHaveBeenCalledWith(
      "/domains/eng/reflection/search?q=night&limit=20&search_type=semantic&page=2",
    );
    expect(found).toMatchObject({
      mode: "text",
      total: 21,
      page: 2,
      limit: 20,
    });
    expect(found.hits[0]).toEqual({
      path: "guides/deploying.md",
      title: "Deploying",
      section: "_top",
      heading: "",
      snippet: "Short intro.",
    });
    // The default mode and the first page are left out of the address.
    await searchReflections("eng", { query: "night" });
    expect(apiMock).toHaveBeenLastCalledWith(
      "/domains/eng/reflection/search?q=night&limit=20",
    );
  });

  it("reads the pages a move could not relink", async () => {
    apiMock.mockResolvedValue({
      from: "a.md",
      to: "b.md",
      links_rewritten: 1,
      threads_moved: true,
      links_failed: [{ path: "c.md", reason: "it is open in a room" }],
    });
    expect(await moveReflection("eng", "a.md", "b.md")).toEqual({
      to: "b.md",
      linksFailed: [{ path: "c.md", reason: "it is open in a room" }],
    });
  });
});

it("builds the Reflection addresses with the path's slashes kept", () => {
  expect(reflectionPageRoute("eng", "guides/new page.md")).toBe(
    "/d/eng/reflection/guides/new%20page.md",
  );
  expect(reflectionEditRoute("eng", "PACT.md")).toBe(
    "/d/eng/reflection-edit/PACT.md",
  );
  expect(reflectionReviewRoute("eng")).toBe("/d/eng/reflection/review");
});
