/**
 * The Linked from block: the titles of the engrams that point here, the
 * relation each points with, when it asks the server at all, and how a long
 * list is capped and opened.
 *
 * The transport is mocked the way every other screen test here mocks it, so
 * the paths are part of what is pinned.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
      referencePage(1, 3, [
        ["Beta", "relates_to"],
        ["Gamma", "links_to"],
        ["Rollback", "relates_to"],
      ]),
    );

    mount(3);

    const block = await screen.findByRole("region", { name: "Linked from" });
    const rows = await within(block).findAllByRole("listitem");
    // The server's order, which is by title: no regrouping by relation.
    expect(rows.map((row) => row.textContent)).toEqual([
      "Betarelates_to",
      "Gammalinks_to",
      "Rollbackrelates_to",
    ]);
    expect(within(block).getByRole("link", { name: "Beta" })).toHaveAttribute(
      "href",
      "/d/eng/e/notes/beta",
    );
    // The relation counts, compactly, when there is more than one relation.
    expect(block).toHaveTextContent("relates_to 3 · links_to 1");
    expect(requested()).toEqual(["/domains/eng/inbound/alpha?page=1&limit=20"]);
  });

  it("fades a retired engram", async () => {
    const page = referencePage(1, 2, [
      ["Old", "relates_to"],
      ["New", "relates_to"],
    ]);
    page.hits[0] = { ...page.hits[0], status: "archived" } as never;
    apiMock.mockResolvedValue(page);

    mount(2);

    expect(await screen.findByRole("link", { name: "Old" })).toHaveClass(
      "opacity-60",
    );
    expect(screen.getByRole("link", { name: "New" })).not.toHaveClass(
      "opacity-60",
    );
  });

  it("counts what exists after repeats are dropped", async () => {
    const rows: [string, string][] = [
      ["A", "relates_to"],
      ["A", "relates_to"],
      ["B", "relates_to"],
      ["C", "relates_to"],
      ["D", "relates_to"],
      ["E", "relates_to"],
      ["F", "relates_to"],
    ];
    apiMock.mockResolvedValue(referencePage(1, 7, rows));

    mount(7);

    expect(
      await screen.findByRole("button", { name: "Show all 6" }),
    ).toBeVisible();
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

  it("filters on the server once many engrams point here, listing every match", async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("q=roll")
          ? referencePage(
              1,
              7,
              ["A", "B", "C", "D", "E", "F", "G"].map(
                (t) => [`Roll ${t}`, "relates_to"] as [string, string],
              ),
            )
          : referencePage(
              1,
              40,
              Array.from(
                { length: 20 },
                (_, i) =>
                  [`Note ${String(i)}`, "relates_to"] as [string, string],
              ),
            ),
      ),
    );

    mount(40);

    const block = await screen.findByRole("region", { name: "Linked from" });
    const field = within(block).getByRole("searchbox", {
      name: "Filter linked engrams",
    });
    await within(block).findAllByRole("listitem");
    await userEvent.type(field, "roll");

    // Every match, past the five-row cap, and the text went to the server.
    await waitFor(() => {
      expect(within(block).getAllByRole("listitem")).toHaveLength(7);
    });
    expect(requested()).toContain(
      "/domains/eng/inbound/alpha?page=1&limit=20&q=roll",
    );
  });

  it("says No match. when the filter finds nothing", async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes("q=zzz")
          ? referencePage(1, 0, [])
          : referencePage(1, 40, [["A", "relates_to"]]),
      ),
    );

    mount(40);

    const field = await screen.findByRole("searchbox", {
      name: "Filter linked engrams",
    });
    await userEvent.type(field, "zzz");

    expect(await screen.findByText("No match.")).toBeVisible();
    // The field stays, so the reader can change the text.
    expect(field).toBeVisible();
  });

  it("sends no filter once the engram is not filterable", async () => {
    apiMock.mockResolvedValue(referencePage(1, 40, [["A", "relates_to"]]));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (permalink: string, count: number) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LinkedFrom
            key={`eng/${permalink}`}
            domain="eng"
            permalink={permalink}
            inboundCount={count}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree("alpha", 40));
    await userEvent.type(
      await screen.findByRole("searchbox", { name: "Filter linked engrams" }),
      "zz",
    );
    await waitFor(() => {
      expect(requested()).toContain(
        "/domains/eng/inbound/alpha?page=1&limit=20&q=zz",
      );
    });

    // The route component stays mounted across engrams: the next one gets a
    // fresh block, with no typed text and no filter field to carry it.
    apiMock.mockClear();
    apiMock.mockResolvedValue(referencePage(1, 2, [["B", "relates_to"]]));
    rerender(tree("beta", 2));

    await screen.findByRole("link", { name: "B" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(requested()).toEqual(["/domains/eng/inbound/beta?page=1&limit=20"]);
  });

  it("starts a keyed block closed again on the next engram", async () => {
    const rows = ["A", "B", "C", "D", "E", "F", "G"].map(
      (t) => [`Note ${t}`, "relates_to"] as [string, string],
    );
    apiMock.mockResolvedValue(referencePage(1, 7, rows));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (permalink: string) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LinkedFrom
            key={`eng/${permalink}`}
            domain="eng"
            permalink={permalink}
            inboundCount={7}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree("alpha"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Show all 7" }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(7);

    rerender(tree("beta"));

    await screen.findByRole("button", { name: "Show all 7" });
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("offers no filter for a short list", async () => {
    apiMock.mockResolvedValue(referencePage(1, 3, [["A", "relates_to"]]));

    mount(3);

    await screen.findByRole("link", { name: "A" });
    expect(screen.queryByRole("searchbox")).toBeNull();
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
