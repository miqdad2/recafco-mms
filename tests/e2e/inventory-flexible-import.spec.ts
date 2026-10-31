import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DATA_ENTRY, E2E_ORDERED_BY_MARKER, FIXTURE_ASSET_CODE, FIXTURE_WORKER_NAME, installCriticalPopupHandler, login } from "./helpers";

/**
 * Flexible Excel import in the real page: the five-column layout with
 * Category, category decisions, a mapping that needs confirmation, and the
 * imported materials in Job Card selection, a General Materials Request,
 * Edit Material and the print report. It writes data, so it runs only when
 * DATABASE_URL (the one the app under test uses) names a disposable *_test
 * database. Needs E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
 */

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();
test.skip(!dbName.endsWith("_test"), "Needs a disposable *_test database (DATABASE_URL).");
test.describe.configure({ mode: "serial" });

const RUN = `${Date.now()}`.slice(-6);
const CODE = `FXE${RUN}`;
const NEW_CATEGORY = `FXE Crane ${RUN}`;
const FILTER = `FXE ${RUN} Hydraulic Filter`;
const HOSE = `FXE ${RUN} Hose`;

const prisma = new PrismaClient();
test.afterAll(() => prisma.$disconnect());

async function workbook(rows: (string | number)[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const r of rows) ws.addRow(r);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "fx-e2e-")), "materials.xlsx");
  writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
  return file;
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(process.env.E2E_ADMIN_EMAIL ?? "");
  await page.locator('input[name="password"]').fill(process.env.E2E_ADMIN_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function open(page: Page, file: string) {
  await page.goto("/store/offline-inventory/import-materials");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("#material-master-file").setInputFiles(file);
  await expect(page.getByRole("heading", { name: /Sheet and columns/ })).toBeVisible({ timeout: 30_000 });
}

test("Five-column file: Category detected, new category decided, then imported", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await open(
    page,
    await workbook([
      ["Serial Number", "Item Code", "Category", "Material Description", "Unit", "Supplier Notes X"],
      [1, `${CODE}A`, "Mechanical Materials", FILTER, "Nos", "ignored"],
      [2, `${CODE}B`, NEW_CATEGORY, HOSE, "Packet", "ignored"],
    ])
  );

  await expect(page.locator("#map-itemCode")).toHaveValue("2");
  await expect(page.locator("#map-category")).toHaveValue("3");
  await expect(page.locator("#map-description")).toHaveValue("4");
  await expect(page.locator("#map-unit")).toHaveValue("5");
  await expect(page.locator("#map-partNumber")).toHaveValue("");
  await expect(page.getByText(/Ignored columns: F/)).toBeVisible();

  // Unknown category holds its row back until someone decides.
  await expect(page.getByRole("heading", { name: /Categories — New \/ Needs Review/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Unknown categories/ })).toContainText("1");
  await expect(page.getByRole("button", { name: /Valid new materials/ })).toContainText("1");

  await page.getByRole("combobox", { name: new RegExp(`Decision for category ${NEW_CATEGORY}`) }).selectOption({ label: "Create as a new category" });
  await expect(page.getByText("Options changed")).toBeVisible();
  await page.getByRole("button", { name: "Preview again" }).first().click();
  await expect(page.getByRole("button", { name: /Valid new materials/ })).toContainText("2", { timeout: 20_000 });
  await expect(page.locator("tbody tr", { hasText: HOSE })).toContainText("New");

  await page.getByRole("checkbox", { name: /Register the 2 ready materials/ }).check();
  await page.getByRole("button", { name: /^Import 2 materials/ }).click();
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30_000 });

  await page.goto("/store/offline-inventory");
  await page.getByRole("tab", { name: /All Materials/ }).click();
  await page.locator("#sb-search").fill(CODE);
  await expect(page.locator("tbody tr", { hasText: `${CODE}B` })).toContainText(NEW_CATEGORY);
  await expect(page.locator("tbody tr", { hasText: `${CODE}A` })).toContainText("Mechanical Materials");
  await expect(page.locator("#sb-category")).toContainText(NEW_CATEGORY);
});

test("Uncertain mapping: blocked until corrected and confirmed; bad mapping keeps the screen", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await open(page, await workbook([[1, `${CODE}C`, "Filters", `FXE ${RUN} Headerless`, "Nos"]]));

  await expect(page.getByText("Needs confirmation")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import \d/ })).toBeDisabled();

  // Same column twice is refused and the mapping stays on screen.
  await page.locator("#map-category").selectOption("2");
  await page.getByRole("button", { name: "Preview again" }).first().click();
  await expect(page.getByText(/cannot use the same column/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#map-category")).toBeVisible();

  await page.locator("#map-category").selectOption("3");
  await page.locator("#map-description").selectOption("4");
  await page.locator("#map-unit").selectOption("5");
  await page.getByRole("button", { name: "Preview again" }).first().click();
  await expect(page.getByText("Needs confirmation")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole("combobox", { name: /Decision for category Filters/ })).toBeVisible();
  await page.getByRole("combobox", { name: /Decision for category Filters/ }).selectOption({ label: "Use existing: Mechanical Materials" });
  await page.getByRole("button", { name: "Preview again" }).first().click();
  await expect(page.getByRole("button", { name: /Valid new materials/ })).toContainText("1", { timeout: 20_000 });
  await page.getByRole("checkbox", { name: /Register the 1 ready material/ }).check();
  await page.getByRole("button", { name: /^Import 1 material/ }).click();
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30_000 });
  expect(await prisma.inventory_material_settings.findFirst({ where: { item_code: `${CODE}C` }, select: { category: true, unit: true } })).toEqual({ category: "Mechanical Materials", unit: "Nos" });
});

test("Imported materials: Job Card selection, General Request, Edit Material, print", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await installCriticalPopupHandler(page);
  await login(page, DATA_ENTRY.email, DATA_ENTRY.password);

  const wizard = page.locator('div[role="dialog"][aria-labelledby="new-job-card-heading"]');
  await page.goto("/dashboard?new_job_card=1");
  await expect(wizard).toBeVisible();
  await wizard.getByLabel("Search assets, vehicles, and machines").fill(FIXTURE_ASSET_CODE);
  await wizard.getByRole("button", { name: new RegExp(FIXTURE_ASSET_CODE) }).first().click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.locator('input[name="ordered_by"]').fill(E2E_ORDERED_BY_MARKER);
  await wizard.locator('input[name="operator_complaint"], textarea[name="operator_complaint"]').fill(`E2E flexible import ${RUN}`);
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.locator('input[name="worker_type"][value="Mechanical"]').check({ force: true });
  await wizard.getByLabel(/Assign work(ers)? now/).check();
  await wizard.getByRole("button", { name: "Internal Team" }).click();
  await wizard.getByRole("combobox", { name: "Find a helper" }).fill(FIXTURE_WORKER_NAME);
  await wizard.getByRole("option", { name: new RegExp(FIXTURE_WORKER_NAME, "i") }).first().click();
  await wizard.getByLabel(`Expected hours for ${FIXTURE_WORKER_NAME}`).fill("1");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.locator('input[name="req_part_description_0"]').fill(`${CODE}A`);
  await wizard.getByRole("option", { name: new RegExp(FILTER) }).first().click();
  await wizard.locator('input[name="req_part_quantity_0"]').fill("1");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("button", { name: "Create Job Card", exact: true }).click();
  await expect(page.getByText("Job Card Created Successfully")).toBeVisible({ timeout: 20_000 });

  // Data Entry edits an imported material; import stays out of reach.
  await page.goto("/store/offline-inventory");
  await expect(page.getByRole("link", { name: "Import from Excel" })).toHaveCount(0);
  await page.getByRole("tab", { name: /All Materials/ }).click();
  await page.locator("#sb-search").fill(`${CODE}B`);
  await page.locator("tbody tr", { hasText: `${CODE}B` }).getByRole("button", { name: "View" }).click();
  await page.getByRole("button", { name: "Edit Material" }).click();
  await expect(page.locator("#me-category")).toHaveValue(NEW_CATEGORY);
  await page.locator("#me-location").fill("Yard 1");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Material Updated Successfully")).toBeVisible({ timeout: 15_000 });

  await page.goto("/store/parts-requests/new");
  await page.locator('input[name="material_name_0"]').fill(HOSE);
  await page.getByRole("option", { name: new RegExp(HOSE) }).first().click();
  await page.locator('input[name="quantity_0"]').fill("2");
  await page.locator('input[name="purpose"]').fill("E2E flexible import");
  await page.locator('form button[type="submit"]').first().click();
  await expect
    .poll(() => prisma.general_inventory_request_items.findFirst({ where: { material_name: HOSE }, select: { unit: true } }), { timeout: 20_000 })
    .toEqual({ unit: "Packet" });

  await page.goto("/reports/offline-inventory/print");
  await expect(page.locator("body")).toContainText(HOSE, { timeout: 20_000 });
  await expect(page.locator("body")).toContainText(NEW_CATEGORY);
});
