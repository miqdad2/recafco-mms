import { readFileSync } from "node:fs";

import { test, expect, type Page } from "@playwright/test";
import { DATA_ENTRY, MANAGER, login, installCriticalPopupHandler } from "./helpers";

/**
 * Daily Activity "Needs My Action". Needs a DISPOSABLE database seeded by
 * scripts/e2e-daily-activity-needs-action-seed.ts (it creates and changes
 * Job Cards) and an app pointed at it, e.g.
 *
 *   DATABASE_URL=<test db> npx next start -p 3100
 *   E2E_BASE_URL=http://localhost:3100 E2E_FIXTURES=<seed json> npx playwright test daily-activity-needs-action
 *
 * Skipped when E2E_FIXTURES is not set.
 */

type Fixtures = {
  none: string;
  workersOnly: string;
  materialsOnly: string;
  working: string;
  paused: string;
  ready: string;
  waiting: string;
  returned: string;
};
const fixturesFile = process.env.E2E_FIXTURES;
const fx: Fixtures | null = fixturesFile ? (JSON.parse(readFileSync(fixturesFile, "utf8")) as Fixtures) : null;
test.skip(!fx, "E2E_FIXTURES not set — needs the disposable seeded database.");

const PAGE = "/maintenance/daily-activity";
const rows = (page: Page) => page.locator("button[aria-pressed]");
const row = (page: Page, number: string) => rows(page).filter({ hasText: number });
const chip = (page: Page, name: string | RegExp) => page.getByRole("link", { name }).and(page.locator("[class*='rounded-full']"));
const panel = (page: Page) => page.locator("#daily-activity-panel");
const summaryValue = async (page: Page, label: string) =>
  Number((await page.getByRole("link", { name: new RegExp(label) }).first().innerText()).match(/\d+/)?.[0]);

async function trackConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe("Daily Activity — Needs My Action (Data Entry)", () => {
  test.beforeEach(async ({ page }) => {
    await installCriticalPopupHandler(page);
    await login(page, DATA_ENTRY.email, DATA_ENTRY.password);
  });

  test("1/10/11/17. plain visit defaults to Needs My Action, ranked, capped list with matching count", async ({ page }) => {
    const errors = await trackConsoleErrors(page);
    await page.goto(PAGE);
    const needs = chip(page, /Needs My Action/);
    await expect(needs).toHaveAttribute("aria-current", "true");
    const count = Number(await needs.locator("span").innerText());
    expect(count).toBeGreaterThan(50);
    await expect(rows(page)).toHaveCount(50);
    await expect(page.getByText(`Showing the first 50 of ${count} matching Job Cards.`)).toBeVisible();

    // Ready to Close first; Waiting for Approval is not here.
    await expect(rows(page).first()).toContainText(/Request closure|Check the return remarks/);
    await expect(row(page, fx!.ready)).toContainText("Request closure");
    await expect(row(page, fx!.waiting)).toHaveCount(0);

    // Summary cards do not change with the default filter.
    const openHere = await summaryValue(page, "Open Job Cards");
    await chip(page, "All Active").click();
    await expect(page).toHaveURL(/status=all/);
    expect(await summaryValue(page, "Open Job Cards")).toBe(openHere);
    expect(errors).toEqual([]);
  });

  test("3/5/6/7/8/9/12. one Next Action line per state", async ({ page }) => {
    const expected: Array<[string, string]> = [
      [fx!.none, "Add workers and materials, or confirm not required"],
      [fx!.workersOnly, "Add materials or confirm not required"],
      [fx!.materialsOnly, "Assign workers or confirm not required"],
      [fx!.working, "Finish worker time when the work is done"],
      [fx!.paused, "Resume or finish paused work"],
      [fx!.returned, "Check the return remarks, then request closure"],
    ];
    for (const [number, message] of expected) {
      await page.goto(`${PAGE}?q=${encodeURIComponent(number)}`);
      await expect(row(page, number)).toContainText(message);
    }
    await expect(panel(page)).toContainText("Closure returned for correction");
    await expect(panel(page)).toContainText("Please add the inspection photo");
  });

  test("4/11. creation-popup link selects that Job Card even outside Needs My Action", async ({ page }) => {
    await page.goto(`${PAGE}?q=${encodeURIComponent(fx!.waiting)}`);
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(fx!.waiting).replace(/[/]/g, "%2F")}`));
    await expect(chip(page, /Needs My Action/)).not.toHaveAttribute("aria-current", "true");
    await expect(panel(page).getByRole("link", { name: fx!.waiting })).toBeVisible();
    await expect(panel(page)).toContainText("Waiting for Manager approval");
    await expect(row(page, fx!.waiting).locator("text=/confirm not required|Request closure/")).toHaveCount(0);
  });

  test("14. searching from Needs My Action looks across All Active", async ({ page }) => {
    await page.goto(PAGE);
    await page.getByPlaceholder(/Search Job Card/).fill(fx!.waiting);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/status=all/);
    await expect(panel(page).getByRole("link", { name: fx!.waiting })).toBeVisible();
  });

  test("Not Required from the panel resolves the action (real click)", async ({ page }) => {
    await page.goto(`${PAGE}?q=${encodeURIComponent(fx!.workersOnly)}`);
    const nextAction = panel(page);
    await nextAction.getByRole("button", { name: "Not Required" }).click();
    await nextAction.getByRole("button", { name: "Confirm" }).click();
    await expect(row(page, fx!.workersOnly)).toContainText("Request closure", { timeout: 15_000 });
    await expect(nextAction).toContainText("No Materials Required");
  });

  test("15/16/20. filters, Reset and browser back", async ({ page }) => {
    await page.goto(PAGE);
    await chip(page, "Waiting for Approval").click();
    await expect(page).toHaveURL(/status=waiting-approval/);
    await expect(row(page, fx!.waiting)).toHaveCount(1);
    await page.goBack();
    await expect(chip(page, /Needs My Action/)).toHaveAttribute("aria-current", "true");

    await page.locator("select[name=team]").selectOption("Mechanical");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/team=Mechanical/);
    await page.getByRole("link", { name: "Reset", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${PAGE}$`));
    await expect(chip(page, /Needs My Action/)).toHaveAttribute("aria-current", "true");
  });

  test("19. phone and tablet width: no horizontal scroll, filter reachable", async ({ page }) => {
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(PAGE);
      await expect(chip(page, /Needs My Action/)).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("Daily Activity — Manager", () => {
  test("2/18. Manager keeps All Active; their Needs My Action holds closure reviews", async ({ page }) => {
    await installCriticalPopupHandler(page);
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto(PAGE);
    await expect(chip(page, "All Active")).toHaveAttribute("aria-current", "true");
    await expect(row(page, fx!.waiting)).toHaveCount(1);
    await page.goto(`${PAGE}?status=needs-action&q=${encodeURIComponent(fx!.waiting)}`);
    await expect(row(page, fx!.waiting)).toContainText("Review closure request");
  });
});
