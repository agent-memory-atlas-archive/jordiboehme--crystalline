/**
 * The Reflection against a real daemon: two accounts, both modes, the live
 * room, a comment on a selected passage and the files a page shows. What
 * only a browser can prove is that a selection in rendered markdown becomes
 * a thread the server anchors, that a person at knowledge none has the
 * Reflection as their whole world, that the members card sets both axes and
 * that an image a page links to loads, follows a move and can be attached
 * from the live editor.
 *
 * The cast `run-smoke.sh` seeds: the admin owns `smoke-pages`, a private
 * domain with its Reflection on; the contributor is an account at knowledge
 * none, invited into it at knowledge none with Reflection contributor.
 *
 * The journeys run in file order (the suite runs one worker) and build on
 * each other: the file move runs before any live room is open on the page
 * (a move refuses while a linking page is open in a room), and the review
 * journey sees the thread the contributor opened.
 *
 * Run it the way the whole suite runs (`bash fluid/e2e/run-smoke.sh
 * e2e/reflection.spec.ts`).
 */

import { readFileSync } from "node:fs";

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const USER = process.env.FLUID_E2E_USER ?? "smoke";
const PASSWORD = process.env.FLUID_E2E_PASSWORD ?? "smoke-password";
const CONTRIBUTOR = process.env.FLUID_E2E_CONTRIBUTOR ?? "contrib";
const CONTRIBUTOR_PASSWORD =
  process.env.FLUID_E2E_CONTRIBUTOR_PASSWORD ?? "contrib-password";
const DOMAIN = process.env.FLUID_E2E_REFLECTION_DOMAIN ?? "smoke-pages";
// `run-smoke.sh` exports it; empty unless the daemon serves under a prefix.
const BASE_PATH = process.env.FLUID_E2E_BASE_PATH ?? "";

/** The fixture's image, the bytes the attach journey uploads under a new name. */
const FLOW_PNG = new URL(
  "./fixtures/reflection-domain/reflections/assets/flow.png",
  import.meta.url,
);

const WELCOME = `d/${DOMAIN}/reflection/guides/welcome.md`;

async function signIn(
  page: Page,
  name: string,
  password: string,
): Promise<void> {
  await page.goto("./");
  await expect(page).toHaveURL((url) => url.pathname === `${BASE_PATH}/login`);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 }),
  ).toBeVisible();
}

/** An image that loaded: the browser decoded it, so it has a width. */
async function expectLoaded(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

test("the owner switches modes and reads a page", async ({ page }) => {
  await signIn(page, USER, PASSWORD);
  await page.goto(`d/${DOMAIN}`);
  const modes = page.getByRole("navigation", { name: "Domain view" });
  await expect(
    modes.getByRole("link", { name: "Engrams", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await modes.getByRole("link", { name: "Reflection", exact: true }).click();
  const tree = page.getByRole("navigation", {
    name: `Reflection of ${DOMAIN}`,
  });
  await tree.getByRole("button", { name: "Expand guides" }).click();
  await tree.getByRole("link", { name: "Welcome" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText("r:c5a0e001");
  await page.getByRole("button", { name: "Sources for Night deploys" }).click();
  await expect(page.getByText("missing", { exact: true })).toBeVisible();
});

test("a curator moves a file and the page follows", async ({ page }) => {
  await signIn(page, USER, PASSWORD);
  await page.goto(WELCOME);
  await expectLoaded(page.getByRole("img", { name: "Flow" }));

  await page
    .getByRole("region", { name: "Attachments" })
    .getByRole("button", { name: "Move flow.png", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Move flow.png" });
  await dialog
    .getByRole("textbox", { name: "New path" })
    .fill("diagrams/flow.png");
  await dialog.getByRole("button", { name: "Move file" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "Moved. 1 link updated.",
  );
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);

  // The page link was rewritten on disk, and the image loads from there.
  const image = page.getByRole("img", { name: "Flow" });
  await expect(image).toHaveAttribute("src", /diagrams\/flow\.png/);
  await expectLoaded(image);
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${BASE_PATH}/api/v1/domains/${DOMAIN}/reflections/guides/welcome.md`,
      );
      return ((await response.json()) as { markdown: string }).markdown;
    })
    .toContain("../assets/diagrams/flow.png");
});

test("a knowledge-none contributor reads a reflection's image", async ({
  page,
}) => {
  await signIn(page, CONTRIBUTOR, CONTRIBUTOR_PASSWORD);
  await page.goto(WELCOME);
  await expectLoaded(page.getByRole("img", { name: "Flow" }));
  const files = page.getByRole("region", { name: "Attachments" });
  await expect(files).toContainText("flow.png");
  await expect(
    files.getByRole("button", { name: "Remove flow.png" }),
  ).toHaveCount(0);
});

test("a contributor lands in the Reflection, comments on a passage and edits live", async ({
  page,
}) => {
  await signIn(page, CONTRIBUTOR, CONTRIBUTOR_PASSWORD);
  await expect(
    page
      .getByRole("region", { name: "Reflection", exact: true })
      .getByRole("link", { name: DOMAIN }),
  ).toBeVisible();
  // An engram address of the domain: nothing is said about engrams, and the
  // domain's own address leads into the Reflection.
  await page.goto(`d/${DOMAIN}`);
  await expect(page).toHaveURL(
    (url) => url.pathname === `${BASE_PATH}/d/${DOMAIN}/reflection`,
  );
  await expect(
    page.getByRole("navigation", { name: "Domain view" }),
  ).toHaveCount(0);

  await page.goto(WELCOME);
  const passage = page.getByText(
    "Deploys run at night, after the batch window.",
  );
  await expect(passage).toBeVisible();
  // No source engram reaches a contributor: not as a control, not in the page.
  await expect(page.getByRole("button", { name: /^Sources for/ })).toHaveCount(
    0,
  );
  expect(await page.content()).not.toContain("notes/smoke-source");
  // Select "Deploys run at night" the way a drag would leave it. The
  // paragraph's first child is the stamped span, whose first child is the
  // text node.
  await passage.evaluate((el) => {
    const text = el.firstChild?.firstChild ?? el.firstChild;
    if (text === null || text === undefined) {
      return;
    }
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, "Deploys run at night".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  const threads = page.getByRole("complementary", { name: "Threads" });
  await threads.getByRole("button", { name: "Comment", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Your comment" })
    .fill("Is this still true?");
  await page
    .getByRole("form", { name: "New comment" })
    .getByRole("button", { name: "Comment", exact: true })
    .click();
  const card = page.getByRole("article", { name: "Thread on Night deploys" });
  await expect(card).toContainText("Deploys run at night");
  await expect(card).toContainText("Is this still true?");

  // PACT.md is written by curators: the contributor reads it and gets no
  // Edit, and proposes a change through a comment instead.
  await page.goto(`d/${DOMAIN}/reflection/PACT.md`);
  await expect(
    page.getByRole("heading", {
      name: "How we write about smoke pages",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit", exact: true }),
  ).toHaveCount(0);

  // The live room: typed text lands in the file, and the ids stay hidden.
  await page.goto(WELCOME);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Page source" });
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Deploys run at night");
  await expect(editor).not.toContainText("r:c5a0e001");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ArrowRight");
  await editor.pressSequentially("\nWritten in the smoke.");
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${BASE_PATH}/api/v1/domains/${DOMAIN}/reflections/guides/welcome.md`,
      );
      return ((await response.json()) as { markdown: string }).markdown;
    })
    .toContain("Written in the smoke.");
  await page.getByRole("link", { name: "Done", exact: true }).click();
  await expect(page.getByText("Written in the smoke.")).toBeVisible();
});

test("a contributor attaches a file in the live editor", async ({ page }) => {
  await signIn(page, CONTRIBUTOR, CONTRIBUTOR_PASSWORD);
  await page.goto(WELCOME);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Page source" });
  await expect(editor).toContainText("Written in the smoke.");
  const attach = page.getByRole("button", { name: "Attach a file" });
  await expect(attach).toBeEnabled();
  const chooser = page.waitForEvent("filechooser");
  await attach.click();
  await (
    await chooser
  ).setFiles({
    name: "sketch.png",
    mimeType: "image/png",
    buffer: readFileSync(FLOW_PNG),
  });
  await expect(editor).toContainText(/\.\.\/assets\/\S*sketch\.png/);
  await page.getByRole("link", { name: "Done", exact: true }).click();
  await expectLoaded(page.getByRole("img", { name: "sketch.png" }));
});

test("the members card and the users screen set both axes side by side", async ({
  page,
}) => {
  await signIn(page, USER, PASSWORD);
  await page.goto(`d/${DOMAIN}`);
  await expect(
    page.getByRole("combobox", { name: `Level for ${CONTRIBUTOR}` }),
  ).toHaveValue("none");
  await expect(
    page.getByRole("combobox", { name: `Reflection for ${CONTRIBUTOR}` }),
  ).toHaveValue("contributor");
  await page.goto("users");
  await expect(
    page.getByRole("combobox", { name: `Role for ${CONTRIBUTOR}` }),
  ).toHaveValue("none");
  // The smoke's own admin curates: the cell says so and offers no choice.
  await expect(
    page.getByRole("combobox", { name: `Reflection for ${USER}` }),
  ).toHaveCount(0);
});

test("the review screen lists the open thread as waiting for the agent", async ({
  page,
}) => {
  await signIn(page, USER, PASSWORD);
  await page.goto(`d/${DOMAIN}/reflection/review`);
  const agent = page.getByRole("region", { name: "Waiting for the agent" });
  await expect(agent.getByText("Is this still true?")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Reflect queue" }),
  ).toBeVisible();

  // After the move, the comment, the live edit and the upload, the tree
  // still holds every page: the pact and the one guide, and no file of the
  // assets folder shows up as a page.
  const tree = page.getByRole("navigation", {
    name: `Reflection of ${DOMAIN}`,
  });
  await expect(
    tree.getByRole("link", { name: "How we write about smoke pages" }),
  ).toBeVisible();
  await tree.getByRole("button", { name: "Expand guides" }).click();
  await expect(tree.getByRole("link", { name: "Welcome" })).toBeVisible();
  await expect(tree.getByRole("button", { name: /^Expand / })).toHaveCount(0);
  await expect(tree.getByRole("listitem")).toHaveCount(3);
});
