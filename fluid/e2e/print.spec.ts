/**
 * A page on paper is one full-width column, whatever the window's width.
 *
 * Safari evaluates the width media queries against the window while it
 * prints, so a wide window keeps the side column's grid track even though
 * the column itself is hidden on paper, and the text prints in what is left.
 * Emulating print media at a wide viewport is that situation exactly: the
 * text column must still fill the page. Runs in Chromium and WebKit.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** The account and the domains `run-smoke.sh` set up. Kept in step with it. */
const USER = process.env.FLUID_E2E_USER ?? "smoke";
const PASSWORD = process.env.FLUID_E2E_PASSWORD ?? "smoke-password";
const DOMAIN = process.env.FLUID_E2E_DOMAIN ?? "fluid-smoke";
const PAGES = process.env.FLUID_E2E_REFLECTION_DOMAIN ?? "smoke-pages";

const SCREENS = [
  { name: "an engram", path: `d/${DOMAIN}/e/berth-assignment-flow` },
  {
    name: "a Reflection page",
    path: `d/${PAGES}/reflection/guides/welcome.md`,
  },
  // PACT.md draws through the same Reflection page; the fixture domain has
  // none until a journey writes it.
];

async function signIn(page: Page): Promise<void> {
  await page.goto("./");
  await page.getByLabel("Name", { exact: true }).fill(USER);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 }),
  ).toBeVisible();
}

for (const width of [1440, 390]) {
  test(`prints every page type as one full-width column from a ${String(width)} px window`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    for (const screen of SCREENS) {
      await page.emulateMedia({ media: "screen" });
      await page.goto(screen.path);
      const article = page.locator("main article").first();
      await expect(
        article,
        `${screen.name} at ${String(width)} px`,
      ).toBeVisible();
      await page.emulateMedia({ media: "print" });
      const share = await article.evaluate((element) => {
        const main = element.closest("main");
        return main === null
          ? 0
          : element.getBoundingClientRect().width / main.clientWidth;
      });
      expect(share, `${screen.name} at ${String(width)} px`).toBeGreaterThan(
        0.95,
      );
    }
  });
}
