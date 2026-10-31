import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DATA_ENTRY,
  E2E_ORDERED_BY_MARKER,
  FIXTURE_ASSET_CODE,
  FIXTURE_WORKER_NAME,
  extractJobCardNumber,
  getJobCardMovements,
  getOfflineInventoryBalance,
  installCriticalPopupHandler,
  login,
} from "./helpers";

/**
 * Custom units from the Material Master import, followed through the real
 * screens: edit, receive, issue, Job Card selection, Process Materials,
 * General Materials Request and the print report. It writes data, so it runs
 * only when DATABASE_URL (the one the app under test uses) names a disposable
 * *_test database. Needs E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
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
const PACKET = `CUE2E ${RUN} Packet Item`;
const SET4 = `CUE2E ${RUN} Set Item`;
const LITRE = `CUE2E ${RUN} Litre Item`;
const CODE = `CUE${RUN}`;

const prisma = new PrismaClient();
test.afterAll(() => prisma.$disconnect());

async function adminSignIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(process.env.E2E_ADMIN_EMAIL ?? "");
  await page.locator('input[name="password"]').fill(process.env.E2E_ADMIN_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

test("Super Admin: import custom units, edit, receive, issue, request, print", async ({ page }) => {
  test.setTimeout(180_000);
  await adminSignIn(page);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow([1, `${CODE}A`, PACKET, "Packet"]);
  ws.addRow([2, `${CODE}B`, SET4, "Set of 4"]);
  ws.addRow([3, `${CODE}C`, LITRE, "Litre"]);
  ws.addRow([4, `${CODE}D`, `CUE2E ${RUN} Bad`, "<Nos>"]);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "cu-e2e-")), "units.xlsx");
  writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));

  await page.goto("/store/offline-inventory/import-materials");
  await expect(page.getByText("All valid units are accepted. Units are saved exactly as entered in Excel. No automatic conversion is applied.")).toBeVisible();
  await expect(page.getByText("Supported units")).toHaveCount(0);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("#material-master-file").setInputFiles(file);
  await expect(page.getByRole("button", { name: /Valid new materials/ })).toContainText("3", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Invalid units/ })).toContainText("1");
  await page.getByRole("checkbox", { name: /Register the 3 ready materials/ }).check();
  await page.getByRole("button", { name: /^Import 3 materials/ }).click();
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30_000 });

  await page.goto("/store/offline-inventory");
  await page.getByRole("tab", { name: /All Materials/ }).click();
  await page.locator("#sb-search").fill(CODE);
  const row = page.locator("tbody tr", { hasText: `${CODE}A` });
  await expect(row).toContainText("Packet");

  // Editing an imported material keeps its unit.
  await row.getByRole("button", { name: "View" }).click();
  const details = page.getByRole("dialog");
  await details.getByRole("button", { name: "Edit" }).first().click();
  await details.locator("#item-code-input").fill(`${CODE}A1`);
  await details.getByRole("button", { name: "Save" }).click();
  await expect(details.getByText(`${CODE}A1`)).toBeVisible({ timeout: 15_000 });
  await details.getByRole("button", { name: "Close" }).last().click();

  // Receiving: the custom unit is offered and stays selected.
  await page.goto("/store/offline-inventory/receive");
  await page.locator("#r-material").selectOption({ label: await page.locator("#r-material option", { hasText: PACKET }).first().innerText() });
  await expect(page.locator("#r-unit")).toHaveValue("Packet");
  await page.locator("#r-qty").fill("10");
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/success=material-received/, { timeout: 20_000 });
  expect(await getOfflineInventoryBalance(PACKET, "Packet")).toBe(10);

  // Issuing: read-only unit, balance goes down by the same number.
  await page.goto("/store/offline-inventory/issue");
  await page.locator("#i-material").selectOption({ label: await page.locator("#i-material option", { hasText: PACKET }).first().innerText() });
  await expect(page.locator("#i-unit")).toHaveValue("Packet");
  await page.locator("#i-qty").fill("3");
  await page.locator("#i-to").fill("E2E custom unit");
  await page.locator('form button[type="submit"]').first().click();
  await expect.poll(() => getOfflineInventoryBalance(PACKET, "Packet"), { timeout: 20_000 }).toBe(7);

  const moves = await prisma.offline_inventory_movements.findMany({ where: { manual_material_name: PACKET, deleted_at: null }, orderBy: { created_at: "asc" } });
  expect(moves.map((m) => [m.movement_type, Number(m.quantity), m.unit])).toEqual([
    ["OPENING_STOCK", 0, "Packet"],
    ["RECEIVED", 10, "Packet"],
    ["ISSUED", 3, "Packet"],
  ]);

  // General Materials Request: search, select, unit taken from Inventory.
  await page.goto("/store/parts-requests/new");
  await page.locator('input[name="material_name_0"]').fill(LITRE);
  await page.getByRole("option", { name: new RegExp(LITRE) }).first().click();
  await page.locator('input[name="quantity_0"]').fill("2");
  await page.locator('input[name="purpose"]').fill("E2E custom unit");
  await page.locator('form button[type="submit"]').first().click();
  await expect
    .poll(() => prisma.general_inventory_request_items.findFirst({ where: { material_name: LITRE }, select: { unit: true, request_unit: true } }), { timeout: 20_000 })
    .toEqual({ unit: "Litre", request_unit: "Litre" });

  // Reports and printing.
  await page.goto("/reports/offline-inventory/print");
  await expect(page.locator("body")).toContainText(PACKET, { timeout: 20_000 });
  await expect(page.locator("body")).toContainText("Packet");
});

test("Job Card: custom-unit materials selected, requested, received and issued", async ({ browser }) => {
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
  await wizard.locator('input[name="operator_complaint"], textarea[name="operator_complaint"]').fill(`E2E custom units ${RUN}`);
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.locator('input[name="worker_type"][value="Mechanical"]').check({ force: true });
  await wizard.getByLabel(/Assign work(ers)? now/).check();
  await wizard.getByRole("button", { name: "Internal Team" }).click();
  await wizard.getByRole("combobox", { name: "Find a helper" }).fill(FIXTURE_WORKER_NAME);
  await wizard.getByRole("option", { name: new RegExp(FIXTURE_WORKER_NAME, "i") }).first().click();
  await wizard.getByLabel(`Expected hours for ${FIXTURE_WORKER_NAME}`).fill("1");
  await wizard.getByRole("button", { name: "Next" }).click();

  await wizard.locator('input[name="req_part_description_0"]').fill(PACKET);
  await wizard.getByRole("option", { name: new RegExp(PACKET) }).first().click();
  await wizard.locator('input[name="req_part_quantity_0"]').fill("2");
  await wizard.getByRole("button", { name: "Add Material" }).click();
  await wizard.locator('input[name="req_part_description_1"]').fill(SET4);
  await wizard.getByRole("option", { name: new RegExp(SET4) }).first().click();
  await wizard.locator('input[name="req_part_quantity_1"]').fill("1");

  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("button", { name: "Create Job Card", exact: true }).click();
  await expect(page.getByText("Job Card Created Successfully")).toBeVisible({ timeout: 20_000 });
  const jobCardNumber = extractJobCardNumber((await page.locator("body").innerText()) ?? "");
  await page.getByRole("link", { name: "Open in Daily Activity" }).click();

  await page.waitForURL(/\/maintenance\/daily-activity/, { timeout: 15_000 });
  await page.getByRole("button", { name: new RegExp(jobCardNumber.replace(/\//g, "\\/")) }).first().click();
  const panel = page.locator("#daily-activity-panel");
  await panel.getByRole("button", { name: "Process Materials" }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Process Materials" });
  await expect(dialog.getByText(PACKET)).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Confirm & Process Materials" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  const required = await prisma.workOrderRequiredPart.findMany({
    where: { work_orders: { work_order_number: jobCardNumber } },
    select: { description: true, unit_of_measure: true },
    orderBy: { description: "asc" },
  });
  expect(required).toEqual([
    { description: PACKET, unit_of_measure: "Packet" },
    { description: SET4, unit_of_measure: "Set of 4" },
  ]);
  const requestItems = await prisma.parts_request_items.findMany({
    where: { parts_requests: { work_orders: { work_order_number: jobCardNumber } } },
    select: { description: true, unit: true },
    orderBy: { description: "asc" },
  });
  expect(requestItems).toEqual([
    { description: PACKET, unit: "Packet" },
    { description: SET4, unit: "Set of 4" },
  ]);

  // No conversion: 7 Packet - 2 issued; the Set of 4 line received then issued.
  expect(await getOfflineInventoryBalance(PACKET, "Packet")).toBe(5);
  expect(await getOfflineInventoryBalance(SET4, "Set of 4")).toBe(0);
  const moves = await getJobCardMovements(jobCardNumber);
  expect(moves.filter((m) => m.name === PACKET).map((m) => [m.type, m.quantity])).toEqual([["ISSUED", 2]]);
  expect(moves.filter((m) => m.name === SET4).map((m) => m.type).sort()).toEqual(["ISSUED", "RECEIVED"]);
});
