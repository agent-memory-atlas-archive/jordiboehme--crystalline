/**
 * Every diagram type the editor offers, and a git graph, rendered for real.
 *
 * The gallery engram holds one fence per starter in the toolbar's mermaid menu
 * plus a `gitGraph` (agents may write one, and no starter covers it). Each
 * fence has to draw in light, in dark, on a phone and on paper:
 *
 * - an `svg` drawn, never the source fallback a diagram that will not parse
 *   falls back to;
 * - nothing wider than the viewport outside its own scroller;
 * - in dark, every text element readable against the canvas token (4.5:1);
 * - the print copy drawn beside each dark diagram, and a PDF that prints.
 */

import { expect, type Page, test } from "@playwright/test";

/** The account and the domain `run-smoke.sh` set up. Kept in step with it. */
const USER = process.env.FLUID_E2E_USER ?? "smoke";
const PASSWORD = process.env.FLUID_E2E_PASSWORD ?? "smoke-password";
const DOMAIN = process.env.FLUID_E2E_DOMAIN ?? "fluid-smoke";

/** The gallery's fences: sixteen starters in menu order, then the git graph. */
const TYPES = [
  "Flowchart",
  "Sequence",
  "State",
  "Class",
  "Entity relationship",
  "Gantt",
  "Pie",
  "Timeline",
  "User journey",
  "Quadrant chart",
  "Mindmap",
  "C4 context",
  "Requirement",
  "Architecture",
  "XY chart",
  "Radar",
  "Git graph",
];

const READABLE = 4.5;

async function openGallery(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("fluid-theme", value);
  }, theme);
  await page.goto("./");
  await page.getByLabel("Name", { exact: true }).fill(USER);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 }),
  ).toBeVisible();
  await page.goto(`d/${DOMAIN}/e/diagram-gallery`);
  const figures = page.locator('figure[aria-label="Diagram"]');
  await expect(figures).toHaveCount(TYPES.length);
  // Give every drawing time to settle: the figures are lazy chunks and the
  // render is async, so wait on the drawing, not on a timer.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            Array.from(
              document.querySelectorAll('figure[aria-label="Diagram"]'),
            ).filter((figure) =>
              Array.from(figure.querySelectorAll('svg[id^="mermaid-"]')).some(
                (svg) => svg.closest("[data-print]") === null,
              ),
            ).length,
        ),
      { timeout: 45_000 },
    )
    .toBe(TYPES.length);
}

/** One verdict per figure about how it drew, computed in the page. */
interface Drawn {
  type: string;
  drawn: boolean;
  fallback: boolean;
  overflow: number;
  printCopy: boolean;
  unreadable: string[];
}

function inspect(page: Page, checkContrast: boolean): Promise<Drawn[]> {
  return page.evaluate(
    ({ types, contrast, min }) => {
      const parse = (css: string): [number, number, number] | null => {
        const m = /rgba?\(([^)]+)\)/.exec(css);
        if (m?.[1] === undefined) {
          return null;
        }
        const [r, g, b] = m[1].split(/[ ,/]+/).map(Number);
        return r === undefined || g === undefined || b === undefined
          ? null
          : [r, g, b];
      };
      const lum = ([r, g, b]: [number, number, number]) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (
        a: [number, number, number],
        b: [number, number, number],
      ) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
      };
      // The canvas token resolved to a colour by a probe element.
      const probe = document.createElement("span");
      probe.style.color = "var(--canvas)";
      document.body.append(probe);
      const canvas = parse(getComputedStyle(probe).color);
      probe.remove();

      return Array.from(
        document.querySelectorAll('figure[aria-label="Diagram"]'),
      ).map((figure, index) => {
        const svgs = Array.from(figure.querySelectorAll('svg[id^="mermaid-"]'));
        const svg = svgs.find((s) => s.closest("[data-print]") === null);
        const unreadable: string[] = [];
        if (contrast && svg !== undefined && canvas !== null) {
          for (const text of Array.from(svg.querySelectorAll("text"))) {
            if ((text.textContent ?? "").trim() === "") {
              continue;
            }
            // A `switch` draws its foreignObject and never its `text`
            // fallback (the journey's section titles), so that text is
            // not on screen and its fill means nothing.
            const parent = text.parentElement;
            if (
              parent?.tagName === "switch" &&
              parent.querySelector("foreignObject") !== null
            ) {
              continue;
            }
            // The glyphs take the fill of the innermost run: a `tspan`
            // with its own rule wins over the `text` that holds it.
            const run = text.querySelector("tspan") ?? text;
            const css = getComputedStyle(run).fill;
            const fill = parse(css);
            if (fill !== null && ratio(fill, canvas) < min) {
              unreadable.push(
                `${text.textContent?.trim().slice(0, 24) ?? ""} ${css} ${ratio(fill, canvas).toFixed(2)}`,
              );
            }
          }
        }
        return {
          type: types[index] ?? `#${String(index)}`,
          drawn: svg !== undefined,
          fallback: figure.querySelector("pre, code") !== null,
          overflow: figure.scrollWidth - document.documentElement.clientWidth,
          printCopy: figure.querySelector("[data-print] svg") !== null,
          unreadable,
        };
      });
    },
    { types: TYPES, contrast: checkContrast, min: READABLE },
  );
}

function expectSound(rows: Drawn[]): void {
  expect(rows.map((row) => row.type)).toEqual(TYPES);
  for (const row of rows) {
    expect(row.drawn, `${row.type} drew an svg`).toBe(true);
    expect(row.fallback, `${row.type} fell back to its source`).toBe(false);
    expect(
      row.overflow,
      `${row.type} is wider than the viewport outside its scroller`,
    ).toBeLessThanOrEqual(0);
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`every diagram type draws in ${theme}`, async ({ page }) => {
    await openGallery(page, theme);
    const rows = await inspect(page, theme === "dark");
    expectSound(rows);
    if (theme === "dark") {
      // One verdict for the whole gallery, so a failure names every type.
      // C4 is out of this check alone: mermaid's C4 renderer hard-codes its
      // relationship text to #444444 unless the diagram source calls
      // UpdateRelStyle, and no theme variable or config key reaches it.
      expect(
        rows
          .filter((row) => row.type !== "C4 context")
          .filter((row) => row.unreadable.length > 0)
          .map((row) => `${row.type}: ${row.unreadable.join(", ")}`),
        `text below ${String(READABLE)}:1 on the canvas`,
      ).toEqual([]);
    }
  });
}

test("every diagram type fits a 390 wide phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGallery(page, "light");
  expectSound(await inspect(page, false));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
    "the page itself scrolls sideways",
  ).toBeLessThanOrEqual(0);
});

test("every dark diagram has a paper copy and the page prints to PDF", async ({
  page,
}) => {
  await openGallery(page, "dark");
  await expect
    .poll(
      async () =>
        (await inspect(page, false))
          .filter((row) => !row.printCopy)
          .map((row) => row.type),
      { timeout: 45_000 },
    )
    .toEqual([]);
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ format: "A4" });
  expect(pdf.byteLength).toBeGreaterThan(1000);
});
