/**
 * The domain's policy switches: one row per MANIFEST key the server's registry
 * knows, with what the frontmatter declares beside what holds.
 *
 * Mounted through the domain screen rather than in isolation, the way the two
 * cards beside it are: what a caller may change here is read off the members
 * payload and the capability probe, and a card rendered with hand-made props
 * would pass while nothing on the screen could reach it.
 *
 * The rows are never a list kept in this app. The fixture is the registry's
 * own wire shape, so a key added in core reaches the card without a line here
 * changing - which is the rule this card exists to keep.
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblem, api } from "../api/client";
import type { Answer } from "../test/harness";
import {
  answersFor,
  defaultPolicyRows,
  domainsResponse,
  manifestSectionsResponse,
  meResponse,
  policyRow,
  renderApp,
  userFixture,
} from "../test/harness";

vi.setConfig({ testTimeout: 15000 });

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn(), setCsrfToken: vi.fn() };
});

const apiMock = vi.mocked(api);

const MANIFEST = ["# eng", "", "## When to Use", "", "- Route here.", ""].join(
  "\n",
);

/** What one row declares, for a manifest fixture that changes a single key. */
interface Declaration {
  declared: string | null;
  effective: string;
}

/**
 * The manifest payload, with the named rows declared as given and every other
 * row at the registry's own default.
 */
function manifestWith(overrides: Record<string, Declaration>) {
  return {
    domain: "eng",
    markdown: MANIFEST,
    checksum: "abc",
    sections: manifestSectionsResponse({
      policies: defaultPolicyRows().map((row) => ({
        ...row,
        ...(overrides[row.key] ?? {}),
      })),
    }),
  };
}

/** The sync status, which is where the branch a direct share commits to comes from. */
function syncResponse(overrides: Record<string, unknown> = {}) {
  return {
    domain: "eng",
    mode: "github",
    repo: "acme/knowledge",
    branch: "main",
    last_checked: "2026-09-22T08:00:00Z",
    local_changes: 0,
    open_proposals: [],
    declined_proposals: [],
    conflicts: [],
    behind: false,
    probe_error: null,
    connection: { connected: true, user: "octo", token_store: "keychain" },
    ...overrides,
  };
}

function serve(routes: Record<string, Answer> = {}) {
  apiMock.mockImplementation(
    answersFor({
      "/auth/me": () => meResponse({ user: userFixture({ role: "admin" }) }),
      "/domains": domainsResponse,
      "/domains/eng/manifest": () => manifestWith({}),
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
      "/vocabulary": () => ({
        domain: "eng",
        tags: [],
        categories: [],
        relation_types: [],
      }),
      "/domains/eng/members": () => ({
        owner: null,
        visibility: "shared",
        members: [],
      }),
      "/domains/eng/sync": () => syncResponse(),
      ...routes,
    }),
  );
}

/** The body of the request the app sent to `path` with `method`, parsed. */
function sentBody(path: string, method: string): unknown {
  const call = apiMock.mock.calls.find(
    ([sent, init]) => sent === path && init?.method === method,
  );
  if (!call) {
    throw new Error(`no ${method} to ${path}`);
  }
  const body = call[1]?.body;
  if (typeof body !== "string") {
    throw new Error(`the ${method} to ${path} carried no JSON body`);
  }
  return JSON.parse(body) as unknown;
}

/** The card itself, once the manifest read behind it has landed. */
async function policiesCard(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "Domain policies" });
}

beforeEach(() => {
  apiMock.mockReset();
});

describe("the domain policies card", () => {
  it("draws one row per registry key with its name, declared and effective values and the default marked", async () => {
    serve();

    renderApp("/d/eng/settings");
    const card = await policiesCard();

    expect(
      within(card).getByText(/^Every switch this MANIFEST can set/),
    ).toBeVisible();
    const sharing = within(card).getByRole("group", { name: /^sharing/ });
    // Nothing in the frontmatter says anything about this key, which is a
    // different sentence from the value it is read as.
    expect(within(sharing).getByText("not declared")).toBeVisible();
    const select = within(card).getByRole("combobox", { name: "sharing" });
    expect(select).toHaveValue("proposal");
    expect(
      within(select).getByRole("option", { name: "proposal (default)" }),
    ).toBeVisible();
    // Every key the registry sent, not the one this feature is about.
    expect(
      within(card).getByRole("combobox", { name: "generated_indexes" }),
    ).toHaveValue("local");
  });

  it("names an unrecognized declaration and what it is read as", async () => {
    serve({
      "/domains/eng/manifest": () =>
        manifestWith({
          sharing: { declared: "dirct", effective: "proposal" },
        }),
    });

    renderApp("/d/eng/settings");
    const card = await policiesCard();

    // A typo in the frontmatter is not an error the server refuses over, so
    // the card says what the domain is actually doing about it.
    expect(
      within(card).getByText("read as proposal; dirct is not a known value"),
    ).toBeVisible();
  });

  it("draws each key as a group with its meaning, its current value and one control", async () => {
    serve();

    renderApp("/d/eng/settings");
    const card = await policiesCard();

    const groups = within(card).getAllByRole("group");
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      // The key names the group, and the sentence beside it says what the
      // key does, so a reader never has to know the key to read the page.
      expect(group.textContent ?? "").toMatch(/In the MANIFEST: /);
    }
    const sharing = within(card).getByRole("group", { name: /^sharing/ });
    expect(
      within(sharing).getByRole("combobox", { name: "sharing" }),
    ).toHaveValue("proposal");
    expect(within(sharing).getAllByRole("option").length).toBeGreaterThan(1);
    // A free-text key has a value and no select.
    const home = within(card).getByRole("group", { name: /^reflection_home/ });
    expect(within(home).queryByRole("combobox")).toBeNull();
    expect(card.querySelector("table")).toBeNull();
  });

  it("renders a text-kind row as read-only text, never a select", async () => {
    serve();

    renderApp("/d/eng/settings");
    const card = await policiesCard();

    const domainName = within(card).getByRole("group", {
      name: /^domain_name/,
    });
    expect(within(domainName).getByText("eng")).toBeVisible();
    expect(within(domainName).queryByRole("combobox")).toBeNull();
    expect(
      within(card).queryByRole("combobox", { name: "domain_name" }),
    ).toBeNull();
  });

  it("draws reflection as a select and reflection_home as read-only text with no 'Change name'", async () => {
    serve();

    renderApp("/d/eng/settings");
    const card = await policiesCard();

    const reflection = within(card).getByRole("combobox", {
      name: "reflection",
    });
    expect(reflection).toHaveValue("off");
    expect(
      within(reflection).getByRole("option", { name: "off (default)" }),
    ).toBeVisible();
    expect(
      within(reflection).getByRole("option", { name: "on" }),
    ).toBeVisible();

    // The server fills the home in when Reflection is switched on; nobody
    // types it, and it is not a name to change through a rename.
    const home = within(card).getByRole("group", { name: /^reflection_home/ });
    expect(within(home).queryByRole("combobox")).toBeNull();
    expect(
      within(home).queryByRole("button", { name: "Change name" }),
    ).toBeNull();
    expect(within(home).getByText("not set")).toBeVisible();
  });

  it("opens the rename dialog from a 'Change name' button beside domain_name, for the owner", async () => {
    serve();

    renderApp("/d/eng/settings");
    const card = await policiesCard();
    const domainName = within(card).getByRole("group", {
      name: /^domain_name/,
    });

    await userEvent.click(
      within(domainName).getByRole("button", { name: "Change name" }),
    );

    // The one dialog the page already owns, not a second one this card
    // mounts for itself: same title, same fields, as the header's own
    // "Rename domain" opens.
    const dialog = await screen.findByRole("dialog", { name: "Rename domain" });
    expect(within(dialog).getByLabelText("New name")).toBeVisible();
  });

  it("renames exactly the domain whose card 'Change name' belongs to", async () => {
    const renamed = vi.fn(() => ({
      domain: "engineering",
      previous: "eng",
      local_only: false,
      manifest_written: true,
      manifest_draft: false,
      rewritten: [],
      left_behind: [],
      aliases: ["eng"],
      shadows: [],
    }));
    serve({
      // A second domain beside it, so a dialog opened for the wrong one
      // would show in the path it posts to.
      "/domains": () => {
        const listed = domainsResponse();
        return {
          ...listed,
          domains: [
            ...listed.domains,
            { ...listed.domains[0], name: "ops", when_to_use: [] },
          ],
        };
      },
      "/domains/eng/rename": (_path, init) => {
        if (init?.method !== "POST") {
          throw new ApiProblem(404, "not found", "no stub for GET");
        }
        return renamed();
      },
    });

    renderApp("/d/eng/settings");
    const card = await policiesCard();
    const domainName = within(card).getByRole("group", {
      name: /^domain_name/,
    });
    await userEvent.click(
      within(domainName).getByRole("button", { name: "Change name" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Rename domain" });
    await userEvent.type(
      within(dialog).getByLabelText("New name"),
      "engineering",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Rename" }),
    );

    await waitFor(() => {
      expect(renamed).toHaveBeenCalledTimes(1);
    });
    const renames = apiMock.mock.calls
      .map(([path]) => path)
      .filter((path) => String(path).endsWith("/rename"));
    expect(renames).toEqual(["/domains/eng/rename"]);
  });

  it("withholds 'Change name' from a caller with neither the owner nor the admin right", async () => {
    serve({
      "/auth/me": () => meResponse({ user: userFixture({ role: "editor" }) }),
      "/domains/eng/members": () => ({
        owner: "somebody-else",
        visibility: "shared",
        members: [],
      }),
    });

    renderApp("/d/eng/settings");
    const card = await policiesCard();
    const domainName = within(card).getByRole("group", {
      name: /^domain_name/,
    });

    expect(
      within(domainName).queryByRole("button", { name: "Change name" }),
    ).toBeNull();
  });

  it("disables 'Change name' with the read-only reason on a read-only instance", async () => {
    serve({
      "/auth/me": () =>
        meResponse({ user: userFixture({ role: "admin" }), read_only: true }),
    });

    renderApp("/d/eng/settings");
    const card = await policiesCard();
    const domainName = within(card).getByRole("group", {
      name: /^domain_name/,
    });
    const button = within(domainName).getByRole("button", {
      name: "Change name",
    });

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(
      "This instance is read only, so nothing here can be changed.",
    );
  });

  it("disables 'Change name' with the renaming reason while a rename runs", async () => {
    serve({
      "/domains": () => ({
        ...domainsResponse(),
        domains: domainsResponse().domains.map((entry) => ({
          ...entry,
          renaming: true,
        })),
      }),
    });

    renderApp("/d/eng/settings");
    const card = await policiesCard();
    const domainName = within(card).getByRole("group", {
      name: /^domain_name/,
    });
    const button = await within(domainName).findByRole("button", {
      name: "Change name",
    });

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-disabled", "true");
    });
    expect(button).toHaveAccessibleDescription(
      "A rename of this domain is already running.",
    );
  });

  it("says nothing about a declaration the registry knows, whatever holds", async () => {
    serve({
      "/domains/eng/manifest": () =>
        manifestWith({
          sharing: { declared: "direct", effective: "proposal" },
        }),
    });

    renderApp("/d/eng/settings");
    const card = await policiesCard();

    // A known word is a known word: whether it is also what holds is the
    // server's business, and saying "not a known value" about it would be a
    // lie the caller cannot check.
    expect(within(card).queryByText(/is not a known value/)).toBeNull();
  });

  it("posts a generated_indexes change at once and takes the answer into the manifest query", async () => {
    const patched = vi.fn(() =>
      manifestWith({
        generated_indexes: { declared: "shared", effective: "shared" },
      }),
    );
    serve({
      "/domains/eng/manifest": (_path, init) =>
        init?.method === "PATCH" ? patched() : manifestWith({}),
    });

    renderApp("/d/eng/settings");
    const card = await policiesCard();

    await userEvent.selectOptions(
      within(card).getByRole("combobox", { name: "generated_indexes" }),
      "shared",
    );
    await waitFor(() => {
      expect(patched).toHaveBeenCalledTimes(1);
    });
    // One key, the one that moved: the body is a patch rather than a document.
    expect(sentBody("/domains/eng/manifest", "PATCH")).toEqual({
      generated_indexes: "shared",
    });
    // The answer carries the manifest as it now reads, so the declared cell
    // moves without a second read of the route.
    expect(
      await within(card).findByText("shared", { selector: "span" }),
    ).toBeVisible();
  });

  it("arms an inline confirmation for sharing: direct, posts on confirm and hands the focus back either way", async () => {
    const patched = vi.fn(() =>
      manifestWith({ sharing: { declared: "direct", effective: "direct" } }),
    );
    serve({
      "/domains/eng/sync": () => syncResponse({ branch: "main" }),
      "/domains/eng/manifest": (_path, init) =>
        init?.method === "PATCH" ? patched() : manifestWith({}),
    });

    renderApp("/d/eng/settings");
    const card = await policiesCard();
    const select = within(card).getByRole("combobox", { name: "sharing" });

    await userEvent.selectOptions(select, "direct");
    // The one key that asks first: the select shows the choice, and nothing
    // has been written yet.
    expect(patched).not.toHaveBeenCalled();
    expect(
      within(card).getByText(
        "Direct sharing removes the review step: every share on this domain commits straight to main, for everybody, until the policy is changed back. Turn it on?",
      ),
    ).toBeVisible();

    await userEvent.click(within(card).getByRole("button", { name: "Keep" }));
    // Back where it was, with the control that asked the question focused.
    expect(select).toHaveValue("proposal");
    expect(select).toHaveFocus();

    await userEvent.selectOptions(select, "direct");
    // The press itself is what is watched rather than the resting
    // `document.activeElement`: this path takes the confirm button out and
    // then disables the select while the write is in flight, and jsdom lands
    // the focus back on the select either way, so only the call the handler
    // makes tells the two apart. A browser does not: there the focus falls to
    // the document unless the handler hands it back.
    const handedBack = vi.spyOn(select, "focus");
    await userEvent.click(
      within(card).getByRole("button", { name: "Turn on direct sharing" }),
    );
    await waitFor(() => {
      expect(patched).toHaveBeenCalledTimes(1);
    });
    expect(sentBody("/domains/eng/manifest", "PATCH")).toEqual({
      sharing: "direct",
    });
    expect(handedBack).toHaveBeenCalled();
  });

  it("says when the write landed in a draft, and shows a refusal and reverts", async () => {
    serve({
      "/domains/eng/manifest": (_path, init) =>
        init?.method === "PATCH"
          ? {
              ...manifestWith({
                generated_indexes: { declared: "shared", effective: "shared" },
              }),
              draft: true,
            }
          : manifestWith({}),
    });

    const first = renderApp("/d/eng/settings");
    let card = await policiesCard();
    await userEvent.selectOptions(
      within(card).getByRole("combobox", { name: "generated_indexes" }),
      "shared",
    );

    // A reviewing domain takes this write into the caller's own draft, and
    // the domain's policy is what the draft changes when it lands.
    expect(
      await within(card).findByText(
        "Saved to your draft. The domain's policy changes when the draft is shared and lands.",
      ),
    ).toBeVisible();
    first.unmount();

    serve({
      "/domains/eng/manifest": (_path, init) => {
        if (init?.method === "PATCH") {
          throw new ApiProblem(
            403,
            "forbidden",
            "only the owner of 'eng' or an instance admin may change `generated_indexes`",
          );
        }
        return manifestWith({});
      },
    });

    renderApp("/d/eng/settings");
    card = await policiesCard();
    const select = within(card).getByRole("combobox", {
      name: "generated_indexes",
    });
    await userEvent.selectOptions(select, "shared");

    // The server's own words, and the row back where the server left it.
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "only the owner of 'eng'",
    );
    expect(select).toHaveValue("local");
  });

  it("disables every select on a read-only instance with the reason, and draws none without the owner right", async () => {
    serve({
      "/auth/me": () =>
        meResponse({ user: userFixture({ role: "admin" }), read_only: true }),
    });

    const first = renderApp("/d/eng/settings");
    let card = await policiesCard();
    const select = within(card).getByRole("combobox", { name: "sharing" });

    // A door that will not open is still shown as the door, with the reason
    // beside it, because this side can prove the refusal.
    expect(select).toBeDisabled();
    expect(select).toHaveAccessibleDescription(
      "This instance is read only, so nothing here can be changed.",
    );
    first.unmount();

    serve({
      "/auth/me": () => meResponse({ user: userFixture({ role: "editor" }) }),
    });

    renderApp("/d/eng/settings");
    card = await policiesCard();

    // A right this side only derived is not shown as a shut door: an account
    // that neither owns the domain nor administers the instance reads the
    // policies and is offered nothing.
    expect(within(card).queryByRole("combobox")).toBeNull();
    expect(within(card).getByRole("group", { name: /^sharing/ })).toBeVisible();
  });

  it("on a locked domain only the read_only row can change, and the others say why", async () => {
    serve({
      "/domains/eng/manifest": () =>
        manifestWith({ read_only: { declared: "on", effective: "on" } }),
    });
    renderApp("/d/eng/settings");
    const card = await policiesCard();
    expect(
      within(card).getByRole("combobox", { name: "read_only" }),
    ).toBeEnabled();
    const sharing = within(card).getByRole("combobox", { name: "sharing" });
    expect(sharing).toBeDisabled();
    expect(sharing).toHaveAccessibleDescription(
      "'eng' is read-only; its owner switches read_only off in the domain policies",
    );
    // A machine-local rename still works (decision D6), so the button stays.
    expect(
      within(card).getByRole("button", { name: "Change name" }),
    ).toBeEnabled();
  });

  it("asks before it turns read_only on, and posts on confirm", async () => {
    serve();
    renderApp("/d/eng/settings");
    const card = await policiesCard();
    await userEvent.selectOptions(
      within(card).getByRole("combobox", { name: "read_only" }),
      "on",
    );
    expect(
      within(card).getByText(
        /refuses every change to this domain through Crystalline/,
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(card).getByRole("button", { name: "Turn on read-only" }),
    );
    await waitFor(() => {
      expect(sentBody("/domains/eng/manifest", "PATCH")).toEqual({
        read_only: "on",
      });
    });
  });

  it("offers an editor who does not own the domain no read_only switch, on or off", async () => {
    serve({
      "/auth/me": () => meResponse({ user: userFixture({ role: "editor" }) }),
      "/domains/eng/members": () => ({
        owner: "somebody-else",
        visibility: "shared",
        members: [],
      }),
    });
    renderApp("/d/eng/settings");
    const card = await policiesCard();
    // Switching it on is the owner's, like switching it off (decision D10):
    // the row is read, never offered.
    expect(
      within(card).getByRole("group", { name: /^read_only/ }),
    ).toBeVisible();
    expect(
      within(card).queryByRole("combobox", { name: "read_only" }),
    ).toBeNull();
  });
  it("brings the mode switch up once the reflection policy is switched on", async () => {
    let on = false;
    serve({
      "/domains/eng/manifest": (_path, init) => {
        if (init?.method === "PATCH") {
          on = true;
        }
        return {
          ...manifestWith({}),
          sections: manifestSectionsResponse({
            // The harness already carries a `reflection` row (0.26.0): swap
            // it, never add a second row with the same key.
            policies: defaultPolicyRows().map((row) =>
              row.key === "reflection"
                ? policyRow(
                    "reflection",
                    on ? "on" : null,
                    on ? "on" : "off",
                    ["off", "on"],
                    "off",
                    row.meaning,
                  )
                : row,
            ),
          }),
        };
      },
      "/domains/eng/reflection": () => ({
        domain: "eng",
        enabled: on,
        state: on ? "on" : "off",
        home: "local",
        home_url: null,
        right: "curate",
        engrams_visible: true,
        pending_engrams: [],
      }),
      "/reflection/domains": () => ({ domains: [] }),
    });

    renderApp("/d/eng/settings");
    const card = await policiesCard();
    expect(
      screen.queryByRole("navigation", { name: "Domain view" }),
    ).toBeNull();
    await userEvent.selectOptions(
      within(card).getByRole("combobox", { name: "reflection" }),
      "on",
    );
    // Ruling (Step 7, approved 2026-10-14): the switch-on asks first.
    expect(
      within(card).getByText(/pages for people under reflections\//),
    ).toBeInTheDocument();
    await userEvent.click(
      within(card).getByRole("button", { name: "Turn on the Reflection" }),
    );
    expect(
      await screen.findByRole("navigation", { name: "Domain view" }),
    ).toBeVisible();
  });

  it("shows the note a switch-off answers with", async () => {
    serve({
      "/domains/eng/manifest": (_path, init) =>
        init?.method === "PATCH"
          ? {
              ...manifestWith({}),
              note: "Reflection is off. Share changes now offers the files in reflections/ as engram changes.",
            }
          : {
              ...manifestWith({}),
              sections: manifestSectionsResponse({
                policies: defaultPolicyRows().map((row) =>
                  row.key === "reflection"
                    ? policyRow(
                        "reflection",
                        "on",
                        "on",
                        ["off", "on"],
                        "off",
                        row.meaning,
                      )
                    : row,
                ),
              }),
            },
      "/domains/eng/reflection": () => ({
        domain: "eng",
        enabled: true,
        state: "on",
        home: "here",
        home_url: null,
        right: "curate",
        engrams_visible: true,
        member: false,
        pending_engrams: [],
      }),
      "/reflection/domains": () => ({ domains: [] }),
    });
    renderApp("/d/eng/settings");
    const card = await policiesCard();
    await userEvent.selectOptions(
      within(card).getByRole("combobox", { name: "reflection" }),
      "off",
    );
    expect(
      await within(card).findByText(
        /offers the files in reflections\/ as engram changes/,
      ),
    ).toBeVisible();
  });
});

describe("the trigger webhook under its row", () => {
  const LOOP = {
    last_run: null,
    running: null,
    left_for_person: 0,
    judgment_waiting: 0,
    delivery: null,
  };
  const webhookOn = () =>
    manifestWith({
      evolve_trigger: { declared: "webhook", effective: "webhook" },
    });
  const serveDelivery = (delivery: Record<string, unknown>) =>
    serve({
      "/domains/eng/manifest": webhookOn,
      "/domains/eng/automation": () => ({
        reflect: LOOP,
        evolve: { ...LOOP, delivery },
      }),
    });

  it("says no webhook URL is set when nothing is configured and nothing failed", async () => {
    serveDelivery({ configured: false, last_sent: null, last_error: null });
    renderApp("/d/eng/settings");
    const card = await policiesCard();
    const row = within(card).getByRole("group", { name: /^evolve_trigger/ });
    expect(
      await within(row).findByText("No webhook URL is set on this instance."),
    ).toBeVisible();
  });

  it("says when the last webhook was taken", async () => {
    serveDelivery({
      configured: true,
      last_sent: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      last_error: null,
    });
    renderApp("/d/eng/settings");
    const card = await policiesCard();
    const row = within(card).getByRole("group", { name: /^evolve_trigger/ });
    expect(
      await within(row).findByText("Last sent 3 hours ago."),
    ).toBeVisible();
  });

  it("shows a failure even when the instance is not configured", async () => {
    serveDelivery({
      configured: false,
      last_sent: null,
      last_error:
        "no webhook secret is set on this instance, so nothing is sent",
    });
    renderApp("/d/eng/settings");
    const card = await policiesCard();
    const row = within(card).getByRole("group", { name: /^evolve_trigger/ });
    expect(
      await within(row).findByText(
        "Last delivery failed: no webhook secret is set on this instance, so nothing is sent.",
      ),
    ).toBeVisible();
  });

  it("asks and says nothing while no trigger is on", async () => {
    serve();
    renderApp("/d/eng/settings");
    await policiesCard();
    expect(
      apiMock.mock.calls.some(([path]) => path === "/domains/eng/automation"),
    ).toBe(false);
    expect(
      screen.queryByText(/Last sent|Last delivery failed|No webhook URL/),
    ).toBeNull();
  });
});
