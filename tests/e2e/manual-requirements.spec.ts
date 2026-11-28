import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  DATA_ENTRY,
  E2E_ORDERED_BY_MARKER,
  E2E_PREFIX,
  RUN_ID,
  FIXTURE_ASSET_CODE,
  login,
  extractJobCardNumber,
  installCriticalPopupHandler,
  seedOpeningStock,
  getOfflineInventoryBalance,
  getJobCardMovements,
} from "./helpers";

/**
 * RECAFCO MMS — Required Materials with manual materials / outside services.
 * A mixed Job Card (one Inventory material + one typed outside repair) on
 * desktop, and a manual-only Job Card at phone width. The manual line must
 * keep its own description / quantity / unit, never touch stock, never enter
 * the Materials Request, and show on the detail page and the print view.
 * Local app + DISPOSABLE local database only.
 */

const INVENTORY_NAME = `E2E-MMS-Gasket-${RUN_ID}`;
const SERVICE_DESC = `${E2E_PREFIX} Starter Motor Repairing`;
const MOBILE_DESC = `${E2E_PREFIX} Radiator Repair`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedOpeningStock(INVENTORY_NAME, 20, "PCS");
});

async function openStep4(page: Page, complaint: string) {
  await page.goto("/dashboard?new_job_card=1");
  const wizard = page.locator('div[role="dialog"][aria-labelledby="new-job-card-heading"]');
  await expect(wizard).toBeVisible();
  await wizard.getByLabel("Search assets, vehicles, and machines").fill(FIXTURE_ASSET_CODE);
  await wizard.getByRole("button", { name: new RegExp(FIXTURE_ASSET_CODE) }).first().click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.locator('input[name="ordered_by"]').fill(E2E_ORDERED_BY_MARKER);
  await wizard.locator('input[name="operator_complaint"], textarea[name="operator_complaint"]').fill(complaint);
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.locator('input[name="worker_type"][value="Mechanical"]').check({ force: true });
  await wizard.getByRole("button", { name: "Next" }).click();
  await expect(wizard.locator('input[name="req_part_description_0"]')).toBeVisible();
  return wizard;
}

async function requiredRows(jobCardNumber: string) {
  const prisma = new PrismaClient();
  try {
    const wo = await prisma.work_orders.findFirstOrThrow({ where: { work_order_number: jobCardNumber }, select: { id: true } });
    const rows = await prisma.workOrderRequiredPart.findMany({ where: { work_order_id: wo.id }, orderBy: { created_at: "asc" } });
    const requestItems = await prisma.parts_request_items.findMany({ where: { parts_requests: { work_order_id: wo.id } }, select: { description: true } });
    const settingsForService = await prisma.inventory_material_settings.count({ where: { manual_material_name: { contains: E2E_PREFIX } } });
    return { id: wo.id, rows, requestItems, settingsForService };
  } finally {
    await prisma.$disconnect();
  }
}

test("Desktop: a mixed Inventory + manual Job Card saves both kinds; the manual line never touches stock", async ({ page }) => {
  test.setTimeout(180_000);
  await installCriticalPopupHandler(page);
  await login(page, DATA_ENTRY.email, DATA_ENTRY.password);
  const wizard = await openStep4(page, `E2E mixed manual test ${E2E_PREFIX}`);

  // Row 1 — Inventory, exactly as before.
  await wizard.locator('input[name="req_part_description_0"]').fill(INVENTORY_NAME);
  await wizard.getByRole("listbox", { name: "Inventory materials" }).getByRole("option", { name: new RegExp(INVENTORY_NAME) }).first().click();
  await wizard.locator('input[name="req_part_quantity_0"]').fill("2");

  // Row 2 — manual outside service.
  await wizard.getByRole("button", { name: "Add Material" }).click();
  await wizard.locator('input[name="req_part_entry_type_1"]').locator("xpath=ancestor::td[1]").getByRole("button", { name: "Use manual entry" }).click();
  await wizard.locator('input[name="req_part_description_1"]').fill(SERVICE_DESC);
  await wizard.locator('input[name="req_part_quantity_1"]').fill("1");

  // A manual line needs a unit.
  await wizard.getByRole("button", { name: "Next" }).click();
  await expect(wizard.getByText(/Choose the unit for/)).toBeVisible();
  await wizard.getByLabel("Unit for material 2").selectOption("JOB");

  // Same table: no new column, the manual row shows "—" for Part No. / Available Stock.
  await expect(wizard.locator("thead th")).toHaveText(["#", "Material Name / Description", "Part No. / Code", "Qty", "Unit", "Available Stock", "Notes"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await wizard.getByRole("button", { name: "Next" }).click(); // -> attachments
  await wizard.getByRole("button", { name: "Next" }).click(); // -> review
  await expect(wizard.getByText(SERVICE_DESC)).toBeVisible();
  await expect(wizard.getByText("· Manual entry").first()).toBeVisible();
  await wizard.getByRole("button", { name: "Create Job Card", exact: true }).click();
  await expect(page.getByText("Job Card Created Successfully")).toBeVisible({ timeout: 20_000 });
  const jobCardNumber = extractJobCardNumber((await page.locator("body").innerText()) ?? "");
  expect(jobCardNumber).toBeTruthy();

  // Stored apart: the manual line has no Inventory identity; only the Inventory line went to the Materials Request.
  const saved = await requiredRows(jobCardNumber);
  expect(saved.rows.map((r) => [r.entry_type, r.description, Number(r.quantity_required), r.unit_of_measure])).toEqual([
    ["inventory", INVENTORY_NAME, 2, "PCS"],
    ["manual", SERVICE_DESC, 1, "JOB"],
  ]);
  expect(saved.rows[1].inventory_material_key).toBeNull();
  expect(saved.rows[1].part_id).toBeNull();
  expect(saved.requestItems.map((i) => i.description)).toEqual([INVENTORY_NAME]);
  expect(saved.settingsForService).toBe(0);

  // Job Card detail: manual line listed with its own quantity and unit, no stock action.
  await page.goto(`/maintenance/work-orders/${saved.id}?tab=materials`);
  const serviceRow = page.locator("#parts table tbody tr").filter({ hasText: SERVICE_DESC });
  await expect(serviceRow).toContainText("1 JOB");
  await expect(serviceRow).toContainText("Manual entry");
  await expect(serviceRow.getByRole("link")).toHaveCount(0);

  // Printed Job Card: shown as requested, not as used material.
  await page.goto(`/maintenance/work-orders/${saved.id}/print`);
  const printRow = page.locator("table tr").filter({ hasText: SERVICE_DESC });
  await expect(printRow).toContainText("(requested — manual entry)");
  await expect(printRow).toContainText("JOB");

  // Stock: still 20 PCS of the Inventory material, nothing for the service.
  expect(await getOfflineInventoryBalance(INVENTORY_NAME, "PCS")).toBe(20);
  expect((await getJobCardMovements(jobCardNumber)).length).toBe(0);
});

test.describe("Phone width", () => {
  test("Mobile: a manual-only Job Card can be entered without horizontal scrolling", async ({ page }) => {
    test.setTimeout(180_000);
    await installCriticalPopupHandler(page);
    // The shared login helper waits for a desktop-only header line, so sign
    // in first, then switch to phone width.
    await login(page, DATA_ENTRY.email, DATA_ENTRY.password);
    await page.setViewportSize({ width: 390, height: 844 });
    const wizard = await openStep4(page, `E2E mobile manual test ${E2E_PREFIX}`);
    await wizard.getByRole("button", { name: "Use manual entry" }).first().click();
    await wizard.locator('input[name="req_part_description_0"]').fill(MOBILE_DESC);
    await wizard.locator('input[name="req_part_quantity_0"]').fill("1.5");
    await wizard.getByLabel("Unit for material 1").selectOption("SERVICE");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await wizard.getByRole("button", { name: "Next" }).click();
    await wizard.getByRole("button", { name: "Next" }).click();
    await expect(wizard.getByText(MOBILE_DESC)).toBeVisible();
    await wizard.getByRole("button", { name: "Create Job Card", exact: true }).click();
    await expect(page.getByText("Job Card Created Successfully")).toBeVisible({ timeout: 20_000 });
    const jobCardNumber = extractJobCardNumber((await page.locator("body").innerText()) ?? "");
    const saved = await requiredRows(jobCardNumber);
    expect(saved.rows.map((r) => [r.entry_type, Number(r.quantity_required), r.unit_of_measure])).toEqual([["manual", 1.5, "SERVICE"]]);
    expect(saved.requestItems).toEqual([]);
  });
});
