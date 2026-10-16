/**
 * The Linked from block: the titles of the engrams that point here, the
 * relation each points with, when it asks the server at all, and how a long
 * list is capped and opened.
 *
 * The transport is mocked the way every other screen test here mocks it, so
 * the paths are part of what is pinned.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblem, api } from "../api/client";
import { LinkedFrom } from "./LinkedFrom";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn() };
});

const apiMock = vi.mocked(api);

/** One page of references, in the engine's own shape. */
function referencePage(
  page: number,
  total: number,
  rows: [title: string, rel: string][],
) {
  return {
    total,
    page,
    limit: 20,
    count: rows.length,
    types: [
      { rel: "relates_to", count: 3 },
      { rel: "links_to", count: 1 },
    ],
    hits: rows.map(([title, rel]) => ({
      domain: "eng",
      permalink: `notes/${title.toLowerCase().replace(/ /g, "-")}`,
      title,
      path: `notes/${title.toLowerCase()}.md`,
      rel,
      status: "current",
    })),
  };
}

function mount(inboundCount = 4) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LinkedFrom
          domain="eng"
          permalink="alpha"
          inboundCount={inboundCount}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Every path asked for, in order. */
function requested(): string[] {
  return apiMock.mock.calls.map((call) => String(call[0]));
}

describe("LinkedFrom", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("names each engram that links here, with the relation on its row", async () => {
    apiMock.mockResolvedValue(
      referencePage(1, 4, [
        ["Gamma", "links_to"],
        ["Rollback", "relates_to"],
        ["Beta", "relates_to"],
      ]),
    );

    mount(3);

    const block = await screen.findByRole("region", { name: "Linked from" });
    const rows = await within(block).findAllByRole("listitem");
    // Grouped by relation, most used first, then by title.
    expect(rows.map((row) => row.textContent)).toEqual([
      "Betarelates_to",
      "Rollbackrelates_to",
      "Gammalinks_to",
    ]);
    expect(within(block).getByRole("link", { name: "Beta" })).toHaveAttribute(
      "href",
      "/d/eng/e/notes/beta",
    );
    expect(requested()).toEqual(["/domains/eng/inbound/alpha?page=1&limit=20"]);
  });

  it("asks for nothing at all when the detail payload counted no references", async () => {
    mount(0);

    expect(
      await screen.findByText("Nothing links here yet."),
    ).toBeInTheDocument();
    expect(requested()).toEqual([]);
  });

  it("says so when the page holds none although the count was not zero", async () => {
    apiMock.mockResolvedValue(referencePage(1, 0, []));

    mount(2);

    expect(
      await screen.findByText("Nothing links here yet."),
    ).toBeInTheDocument();
  });

  it("caps a long list and opens the rest on Show all", async () => {
    const titles = ["A", "B", "C", "D", "E", "F", "G"].map(
      (t) => [`Note ${t}`, "relates_to"] as [string, string],
    );
    apiMock.mockResolvedValue(referencePage(1, 7, titles));

    mount(7);

    const block = await screen.findByRole("region", { name: "Linked from" });
    expect(await within(block).findAllByRole("listitem")).toHaveLength(5);
    await userEvent.click(
      within(block).getByRole("button", { name: "Show all 7" }),
    );
    expect(within(block).getAllByRole("listitem")).toHaveLength(7);
    expect(
      within(block).queryByRole("button", { name: /Show all/ }),
    ).toBeNull();
    // The whole list was in the first page: no second request.
    expect(requested()).toHaveLength(1);
  });

  it("asks for the next page when more than one page points here", async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("page=2")
          ? referencePage(2, 21, [["Last", "relates_to"]])
          : {
              ...referencePage(
                1,
                21,
                Array.from(
                  { length: 20 },
                  (_, i) =>
                    [`Note ${String(i).padStart(2, "0")}`, "relates_to"] as [
                      string,
                      string,
                    ],
                ),
              ),
            },
      ),
    );

    mount(21);

    const block = await screen.findByRole("region", { name: "Linked from" });
    await userEvent.click(
      await within(block).findByRole("button", { name: "Show all 21" }),
    );
    await userEvent.click(
      within(block).getByRole("button", { name: "Show more" }),
    );
    expect(
      await within(block).findByRole("link", { name: "Last" }),
    ).toBeVisible();
    expect(requested()).toContain("/domains/eng/inbound/alpha?page=2&limit=20");
  });

  it("is reachable by keyboard", async () => {
    apiMock.mockResolvedValue(
      referencePage(1, 7, [
        ["A", "relates_to"],
        ["B", "relates_to"],
        ["C", "relates_to"],
        ["D", "relates_to"],
        ["E", "relates_to"],
        ["F", "relates_to"],
        ["G", "relates_to"],
      ]),
    );

    mount(7);

    const block = await screen.findByRole("region", { name: "Linked from" });
    await within(block).findAllByRole("listitem");
    await userEvent.tab();
    expect(within(block).getByRole("link", { name: "A" })).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(
      within(block).getByRole("button", { name: "Show all 7" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(within(block).getAllByRole("listitem")).toHaveLength(7);
  });

  it("says what the server said when the list could not be read", async () => {
    apiMock.mockRejectedValue(
      new ApiProblem(403, "forbidden", "this account may not read eng"),
    );

    mount();

    const block = await screen.findByRole("region", { name: "Linked from" });
    expect(await within(block).findByRole("alert")).toHaveTextContent(
      "this account may not read eng",
    );
  });
});
