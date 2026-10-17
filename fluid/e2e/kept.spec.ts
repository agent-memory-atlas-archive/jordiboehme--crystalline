/**
 * Kept texts against a real daemon: the one `run-smoke.sh` leaves in the
 * state folder for `harbor-signal-log.md`, as a co-editing room leaves its
 * text when its last save could not land.
 *
 * What only this can prove is that the server's listing, its rights and its
 * delete meet the screens: the settings list it and show it, the editor of
 * that engram offers it, and a drop there is gone from the settings too. The
 * component tests cover Use it; here the journey drops the text, so the
 * fixture engram stays as every other journey expects it.
 *
 * One test, because the journey is one-way: a dropped text is gone.
 */

import { expect, test } from "@playwright/test";

const USER = process.env.FLUID_E2E_USER ?? "smoke";
const PASSWORD = process.env.FLUID_E2E_PASSWORD ?? "smoke-password";
const BASE_PATH = process.env.FLUID_E2E_BASE_PATH ?? "";
const DOMAIN = process.env.FLUID_E2E_DOMAIN ?? "fluid-smoke";

test("a kept text is listed, shown, offered in its editor and dropped", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page).toHaveURL((url) => url.pathname === `${BASE_PATH}/login`);
  await page.getByLabel("Name", { exact: true }).fill(USER);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 }),
  ).toBeVisible();

  await page.goto(`d/${DOMAIN}/settings`);
  const section = page.getByRole("region", { name: "Kept texts" });
  await expect(section).toContainText("harbor-signal-log.md");
  await expect(section).toContainText("Engram text");
  await section
    .getByRole("button", {
      name: "Show the kept text for harbor-signal-log.md",
    })
    .click();
  const dialog = page.getByRole("dialog", { name: "Kept text" });
  await expect(dialog.getByLabel("The kept text")).toContainText(
    "Typed in a room that could not save.",
  );
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  await page.goto(`d/${DOMAIN}/edit/harbor-signal-log`);
  const notice = page.getByRole("note", { name: "Kept text" });
  await expect(notice).toContainText(
    "The server kept unsaved text for this page.",
  );
  await notice.getByRole("button", { name: "Drop the kept text" }).click();
  await notice.getByRole("button", { name: "Drop it" }).click();
  await expect(notice).toBeHidden();

  await page.goto(`d/${DOMAIN}/settings`);
  await expect(page.getByRole("region", { name: "Kept texts" })).toContainText(
    "No kept texts.",
  );
});
