import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { api } from "../api/client";
import { TEXT_NAME } from "../collab/provider";
import type { CollabSession } from "../collab/useCollabSession";
import { useCollabSession } from "../collab/useCollabSession";
import { readDraft, writeDraft } from "../editor/drafts";
import {
  answersFor,
  meResponse,
  renderApp,
  soloCollabSession,
  userFixture,
} from "../test/harness";

vi.setConfig({ testTimeout: 15000 });
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});
vi.mock("../collab/useCollabSession", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../collab/useCollabSession")>();
  return { ...actual, useCollabSession: vi.fn() };
});
const apiMock = vi.mocked(api);
const sessionMock = vi.mocked(useCollabSession);

const PAGE = "# A\n\n## One\n<!-- r:aaaa1111 -->\n\nFirst.\n";

function room(text: string): CollabSession {
  const doc = new Y.Doc();
  const ytext = doc.getText(TEXT_NAME);
  ytext.insert(0, text);
  return {
    ...soloCollabSession(),
    mode: "collab",
    status: "connected",
    ytext,
    awareness: new Awareness(doc),
    epoch: "e1",
    // What the hook reports after the greeting: the inner path.
    permalink: "guides/a.md",
  };
}

function serve(right: string) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () =>
        meResponse({ user: userFixture({ name: "ann", role: "viewer" }) }),
      "/domains": () => ({ behavior: [], domains: [] }),
      "/reflection/domains": () => ({ domains: [] }),
      "/domains/eng/reflection": () => ({
        domain: "eng",
        enabled: true,
        state: "on",
        home: "local",
        home_url: null,
        right,
        engrams_visible: false,
        pending_engrams: [],
      }),
      "/domains/eng/reflection/tree": () => ({
        domain: "eng",
        pact: { path: "PACT.md", title: "PACT", exists: true, open_threads: 0 },
        nodes: [],
      }),
    }),
  );
}

beforeEach(() => {
  apiMock.mockReset();
  sessionMock.mockReset();
  localStorage.clear();
});

describe("the reflection editor", () => {
  it("opens the live room with the ids hidden and Done back to the page", async () => {
    serve("edit");
    sessionMock.mockReturnValue(room(PAGE));
    renderApp("/d/eng/reflection-edit/guides/a.md");
    const editor = await screen.findByRole("textbox", { name: "Page source" });
    expect(editor.textContent).toContain("First.");
    expect(editor.textContent).not.toContain("r:aaaa1111");
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute(
      "href",
      "/d/eng/reflection/guides/a.md",
    );
    expect(sessionMock.mock.calls[0]?.[0]).toMatchObject({
      domain: "eng",
      permalink: "reflection:guides/a.md",
      room: { url: "/api/v1/collab-reflection/eng/guides/a.md" },
    });
  });

  it("kept text from an earlier session is offered back", async () => {
    serve("edit");
    const session = room(PAGE);
    sessionMock.mockReturnValue(session);
    writeDraft("ann", "eng", "reflection:guides/a.md", {
      content: "typed offline\n",
      baseChecksum: "c0",
      savedAt: "2026-09-30T10:00:00Z",
    });
    renderApp("/d/eng/reflection-edit/guides/a.md");
    expect(
      await screen.findByText("Text from an earlier session was kept."),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Put it back" }));
    expect(session.ytext?.toJSON()).toBe("typed offline\n");
    expect(readDraft("ann", "eng", "reflection:guides/a.md")).toBeNull();
    expect(
      screen.queryByText("Text from an earlier session was kept."),
    ).toBeNull();
  });

  it("offers nothing back when the kept text is what the room already holds", async () => {
    serve("edit");
    sessionMock.mockReturnValue(room(PAGE));
    writeDraft("ann", "eng", "reflection:guides/a.md", {
      content: PAGE,
      baseChecksum: "c0",
      savedAt: "",
    });
    renderApp("/d/eng/reflection-edit/guides/a.md");
    await screen.findByRole("textbox", { name: "Page source" });
    expect(
      screen.queryByText("Text from an earlier session was kept."),
    ).toBeNull();
  });

  it("offers nothing back when the kept text differs only by the ids a save added", async () => {
    serve("edit");
    sessionMock.mockReturnValue(room(PAGE));
    writeDraft("ann", "eng", "reflection:guides/a.md", {
      content: "# A\n\n## One\n\nFirst.\n",
      baseChecksum: "",
      savedAt: "",
    });
    renderApp("/d/eng/reflection-edit/guides/a.md");
    await screen.findByRole("textbox", { name: "Page source" });
    expect(
      screen.queryByText("Text from an earlier session was kept."),
    ).toBeNull();
  });

  it("keeps the text as a draft when the room refuses a save", async () => {
    serve("edit");
    const session = {
      ...room(`${PAGE}typed\n`),
      saveState: "failed" as const,
      saveDetail:
        "the Reflection of 'eng' is not on here any more, so this room's text is not saved; this tab keeps a copy, and if the page closes the server keeps one too",
    };
    sessionMock.mockReturnValue(session);
    renderApp("/d/eng/reflection-edit/guides/a.md");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the Reflection of 'eng' is not on here any more",
    );
    expect(readDraft("ann", "eng", "reflection:guides/a.md")?.content).toBe(
      `${PAGE}typed\n`,
    );
    // Typing after the refusal still reaches the draft.
    act(() => {
      (session.ytext as Y.Text).insert(
        (session.ytext as Y.Text).length,
        "more\n",
      );
    });
    expect(readDraft("ann", "eng", "reflection:guides/a.md")?.content).toBe(
      `${PAGE}typed\nmore\n`,
    );
  });

  it("says deleted only when the page was deleted", async () => {
    serve("edit");
    sessionMock.mockReturnValue({
      ...room(PAGE),
      closed: true,
      closedReason: "internal",
    });
    renderApp("/d/eng/reflection-edit/guides/a.md");
    expect(
      await screen.findByText(
        "The session ended; your text is kept as a draft",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/was deleted/)).toBeNull();
  });

  it("says the text was saved when the Reflection was switched off", async () => {
    serve("edit");
    sessionMock.mockReturnValue({
      ...room(PAGE),
      closed: true,
      closedReason: "switched_off",
    });
    renderApp("/d/eng/reflection-edit/guides/a.md");
    expect(
      await screen.findByText(
        "The Reflection was switched off. Your text was saved first.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/session ended|was deleted/)).toBeNull();
  });

  it("claims no save when the switch-off's last save was refused", async () => {
    serve("edit");
    sessionMock.mockReturnValue({
      ...room(PAGE),
      saveState: "failed",
      saveDetail: "the page could not be written",
      closed: true,
      closedReason: "switched_off",
    });
    renderApp("/d/eng/reflection-edit/guides/a.md");
    expect(
      await screen.findByText(
        "The session ended; your text is kept as a draft",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/saved first/)).toBeNull();
    expect(readDraft("ann", "eng", "reflection:guides/a.md")?.content).toBe(
      PAGE,
    );
  });

  it("says a failed room is failed and offers a retry, with no second save path", async () => {
    serve("edit");
    sessionMock.mockReturnValue(soloCollabSession());
    renderApp("/d/eng/reflection-edit/guides/a.md");
    expect(
      await screen.findByText("Live editing is not available right now."),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(sessionMock.mock.calls.length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("sends a contributor back from PACT.md, which only curators edit", async () => {
    serve("edit");
    sessionMock.mockReturnValue(room(PAGE));
    renderApp("/d/eng/reflection-edit/PACT.md");
    expect(
      await screen.findByText("You can comment on this page, but not edit it."),
    ).toBeVisible();
    expect(sessionMock).not.toHaveBeenCalled();
  });

  it("sends a reader who may only comment back to the page", async () => {
    serve("read");
    sessionMock.mockReturnValue(room(PAGE));
    renderApp("/d/eng/reflection-edit/guides/a.md");
    expect(
      await screen.findByText("You can comment on this page, but not edit it."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to the page" }),
    ).toHaveAttribute("href", "/d/eng/reflection/guides/a.md");
    expect(sessionMock).not.toHaveBeenCalled();
  });
});
