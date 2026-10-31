import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Inventory Control Item Code / Material Master import / Super Admin
 * delete — browser checks. It imports and deletes materials, so it runs
 * only when DATABASE_URL (the same one the app under test was started
 * with) names a disposable *_test database:
 *
 *   DATABASE_URL=.../recafco_mm_item_code_test E2E_BASE_URL=http://localhost:3100 \
 *   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... E2E_USER_EMAIL=... E2E_USER_PASSWORD=... \
 *   npx playwright test tests/e2e/inventory-material-master.spec.ts
 */

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();

test.skip(!dbName.endsWith("_test"), "Needs a disposable *_test database (DATABASE_URL).");

const ADMIN = { email: process.env.E2E_ADMIN_EMAIL ?? "", password: process.env.E2E_ADMIN_PASSWORD ?? "" };
const USER = { email: process.env.E2E_USER_EMAIL ?? "", password: process.env.E2E_USER_PASSWORD ?? "" };
const RUN = `${Date.now()}`.slice(-6);
const CODE_A = `E2E${RUN}A`;
const CODE_B = `E2E${RUN}B`;

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function writeMasterFile(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Material Master");
  ws.addRow([1, CODE_A, `E2E ${RUN} FILTER: HYDRAULIC FILTER PART NO.: 123-8189`, "Nos"]);
  ws.addRow([2, CODE_B, `E2E ${RUN} FILTER: HYDRAULIC OIL FILTER WITH O-RING`, "Nos"]);
  ws.addRow([3, `E2E${RUN}C`, `E2E ${RUN} BAD UNIT`, "<Nos>"]);
  const dir = mkdtempSync(path.join(tmpdir(), "mm-e2e-"));
  const file = path.join(dir, "material-master.xlsx");
  writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
  return file;
}

async function searchInventory(page: Page, text: string) {
  await page.getByRole("tab", { name: /All Materials/ }).click();
  await page.locator("#sb-search").fill(text);
}

test.describe("Inventory Control — Super Admin material master", () => {
  test("Super Admin: Item Code column, import, search, single and bulk delete", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/store/offline-inventory");
    await expect(page.getByRole("link", { name: "Import from Excel" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add New Material" })).toBeVisible();
    await expect(page.getByRole("link", { name: "View Movement History" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Print Report" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import Opening Stock" })).toBeVisible();
    await page.getByRole("tab", { name: /All Materials/ }).click();
    const headers = page.locator("thead th");
    await expect(headers.nth(1)).toHaveText(/Material/i);
    await expect(headers.nth(2)).toHaveText(/Item Code/i);
    await expect(page.getByRole("checkbox", { name: "Select all materials on this page" })).toBeVisible();

    // Import from Excel (headerless Maintenance Department layout).
    await page.getByRole("link", { name: "Import from Excel" }).click();
    await page.waitForURL(/import-materials/);
    await page.locator("#material-master-file").setInputFiles(await writeMasterFile());
    await expect(page.getByText("No header row detected")).toBeVisible({ timeout: 30_000 });
    const validCard = page.getByRole("button", { name: /Valid new materials/ });
    await expect(validCard).toContainText("2");
    await expect(page.getByRole("button", { name: /Invalid units/ })).toContainText("1");
    const importButton = page.getByRole("button", { name: /^Import 2 materials/ });
    await expect(importButton).toBeDisabled();
    await page.getByRole("checkbox", { name: /Register the 2 ready materials/ }).check();
    await importButton.click();
    await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("2 materials registered with zero stock")).toBeVisible();

    // Imported material in the existing table, found by Item Code.
    await page.goto("/store/offline-inventory");
    await searchInventory(page, CODE_A);
    const rowA = page.locator("tbody tr", { hasText: CODE_A });
    await expect(rowA).toHaveCount(1);
    await expect(rowA).toContainText("Nos");
    await expect(rowA).toContainText("Out of Stock");

    // Individual delete via the row action → review → confirm.
    await rowA.getByRole("button", { name: /^Delete / }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Material" });
    await expect(dialog.getByText("Permanently delete").first()).toBeVisible();
    const confirm = dialog.getByRole("button", { name: /Confirm: Delete 1/ });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await confirm.click();
    await expect(page.getByRole("dialog", { name: "Delete Result" }).getByText("Deleted", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).last().click();
    await expect(page.locator("tbody tr", { hasText: CODE_A })).toHaveCount(0);

    // Row selection shows Delete Selected (N).
    await searchInventory(page, `E2E ${RUN}`);
    await page.locator("tbody tr", { hasText: CODE_B }).getByRole("checkbox").check();
    await expect(page.getByRole("button", { name: "Delete Selected (1)" })).toBeVisible();
    // Changing the filter clears the selection.
    await page.locator("#sb-search").fill("");
    await expect(page.getByRole("button", { name: /Delete Selected/ })).toHaveCount(0);

    // Header checkbox selects exactly the rows on this page.
    const pageRows = await page.locator("tbody tr").count();
    await page.getByRole("checkbox", { name: "Select all materials on this page" }).check();
    await expect(page.getByRole("button", { name: `Delete Selected (${pageRows})` })).toBeVisible();
    await page.getByRole("button", { name: "Delete Selected" }).click();
    const bulk = page.getByRole("dialog", { name: /Delete Selected Materials/ });
    await expect(bulk.getByText("Selected", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(bulk.getByText("Blocked", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    // Cancel: nothing is removed just because rows were ticked.
    await bulk.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.getByRole("button", { name: /Delete Selected/ })).toHaveCount(0);

    await page.goto("/store/offline-inventory/archived");
    await expect(page.getByRole("heading", { name: "Archived Materials" })).toBeVisible();
  });

  test("Other role: no import, selection or delete; admin pages refused", async ({ page }) => {
    await signIn(page, USER);
    await page.goto("/store/offline-inventory");
    await expect(page.getByRole("heading", { name: "Inventory Control" })).toBeVisible();
    await page.getByRole("tab", { name: /All Materials/ }).click();
    await expect(page.locator("thead th").nth(1)).toHaveText(/Item Code/i);
    await expect(page.getByRole("link", { name: "Import from Excel" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Select all materials/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "View" }).first()).toBeVisible();

    await page.goto("/store/offline-inventory/import-materials");
    await expect(page).toHaveURL(/permission-denied/);
    await page.goto("/store/offline-inventory/archived");
    await expect(page).toHaveURL(/permission-denied/);
  });

  test("Phone width: no page-level horizontal scroll, table scrolls inside", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, ADMIN);
    await page.goto("/store/offline-inventory");
    await page.getByRole("tab", { name: /All Materials/ }).click();
    await expect(page.locator("thead th").nth(2)).toHaveText(/Item Code/i);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
