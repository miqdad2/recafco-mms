import { expect, test, type Page } from "@playwright/test";
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
  MANAGER,
  extractJobCardNumber,
  getOfflineInventoryBalance,
  installCriticalPopupHandler,
  login,
} from "./helpers";

/**
 * Edit Material in the real popup. It writes data, so it runs only when
 * DATABASE_URL (the one the app under test uses) names a disposable *_test
 * database. Needs E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD, and
 * E2E_TECH_EMAIL / E2E_TECH_PASSWORD for the role check.
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
const CODE = `MEE${RUN}`;
const FIRST = `MEE ${RUN} First`;
const RENAMED = `MEE ${RUN} Renamed`;
const USED = `MEE ${RUN} Used`;

const prisma = new PrismaClient();
test.afterAll(() => prisma.$disconnect());

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function openDetails(page: Page, code: string) {
  await page.goto("/store/offline-inventory");
  await page.getByRole("tab", { name: /All Materials/ }).click();
  await page.locator("#sb-search").fill(code);
  await page.locator("tbody tr", { hasText: code }).getByRole("button", { name: "View" }).click();
  await expect(page.getByRole("dialog").getByText("Material Details")).toBeVisible();
}

test("Super Admin: footer actions, unsaved check, edit everything, double click, refresh", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, process.env.E2E_ADMIN_EMAIL ?? "", process.env.E2E_ADMIN_PASSWORD ?? "");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow([1, `${CODE}A`, FIRST, "Nos"]);
  ws.addRow([2, `${CODE}B`, USED, "Packet"]);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "me-e2e-")), "m.xlsx");
  writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
  await page.goto("/store/offline-inventory/import-materials");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("#material-master-file").setInputFiles(file);
  await page.getByRole("checkbox", { name: /Register the 2 ready materials/ }).check({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Import 2 materials/ }).click();
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30_000 });

  await openDetails(page, `${CODE}A`);
  await expect(page.getByRole("link", { name: "View Full History" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete Material" })).toBeVisible();
  await page.getByRole("button", { name: "Edit Material" }).click();

  const name = page.locator("#me-name");
  await expect(name).toHaveValue(FIRST);
  await expect(page.locator("#me-unit")).toHaveValue("Nos");
  await expect(page.locator("#me-code")).toHaveValue(`${CODE}A`);
  await expect(page.locator("#me-category")).toHaveValue("Other");

  // Unsaved changes are confirmed; Escape must not close the popup behind.
  await name.fill(RENAMED);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Discard changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue Editing" }).click();
  await expect(name).toHaveValue(RENAMED);

  // Field errors appear beside the field and keep the form open.
  await page.locator("#me-unit").fill("Nos|Set");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.locator("#me-unit-error")).toBeVisible();

  await page.locator("#me-unit").fill("Set of 4");
  await page.locator("#me-code").fill(`${CODE}A2`);
  await page.locator("#me-category").fill("Hardware / Fasteners");
  await page.locator("#me-part").fill("PN-1");
  await page.locator("#me-ss").fill("SS-1");
  await page.locator("#me-location").fill("Rack 7");
  await page.locator("#me-notes").fill("Real note");
  await page.locator("#me-min").fill("4");
  await page.locator("#me-reorder").fill("8");
  await page.getByRole("button", { name: "Save Changes" }).dblclick();

  await expect(page.getByText("Material Updated Successfully")).toBeVisible({ timeout: 15_000 });
  // The popup stays on the same material under its new name.
  const details = page.getByRole("dialog").filter({ hasText: "Material Details" });
  await expect(details.getByRole("heading", { name: RENAMED })).toBeVisible({ timeout: 15_000 });
  await expect(details).toContainText("Rack 7");
  await expect(details).toContainText("Real note");
  await expect(details).toContainText("Set of 4");
  await details.getByRole("button", { name: "Close" }).last().click();

  await page.locator("#sb-search").fill(`${CODE}A2`);
  const row = page.locator("tbody tr", { hasText: `${CODE}A2` });
  await expect(row).toContainText(RENAMED);
  await expect(row).toContainText("Hardware / Fasteners");
  await expect(row).toContainText("PN-1");

  const audit = await prisma.audit_logs.count({ where: { action: "offline_inventory.material_edited", summary: { contains: RENAMED } } });
  expect(audit, "double click saved once").toBe(1);
  expect(await prisma.offline_inventory_movements.count({ where: { manual_material_name: RENAMED, unit: "Set of 4", quantity: 0, deleted_at: null } })).toBe(1);
});

test("Data Entry: edits, no Delete, no cost; a Job Card locks identity but keeps working", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await installCriticalPopupHandler(page);
  await login(page, DATA_ENTRY.email, DATA_ENTRY.password);

  await openDetails(page, `${CODE}B`);
  await expect(page.getByRole("button", { name: "Delete Material" })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Material" }).click();
  await expect(page.locator("#me-name")).toBeEnabled();
  const form = page.getByRole("dialog").filter({ hasText: "Edit Material" });
  await expect(form).not.toContainText(/Unit Cost|Stock Value|KWD/);
  await page.locator("#me-location").fill("Bay 2");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Material Updated Successfully")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("dialog").filter({ hasText: "Material Details" }).getByRole("button", { name: "Close" }).last().click();

  const wizard = page.locator('div[role="dialog"][aria-labelledby="new-job-card-heading"]');
  await page.goto("/dashboard?new_job_card=1");
  await expect(wizard).toBeVisible();
  await wizard.getByLabel("Search assets, vehicles, and machines").fill(FIXTURE_ASSET_CODE);
  await wizard.getByRole("button", { name: new RegExp(FIXTURE_ASSET_CODE) }).first().click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.locator('input[name="ordered_by"]').fill(E2E_ORDERED_BY_MARKER);
  await wizard.locator('input[name="operator_complaint"], textarea[name="operator_complaint"]').fill(`E2E edit material ${RUN}`);
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.locator('input[name="worker_type"][value="Mechanical"]').check({ force: true });
  await wizard.getByLabel(/Assign work(ers)? now/).check();
  await wizard.getByRole("button", { name: "Internal Team" }).click();
  await wizard.getByRole("combobox", { name: "Find a helper" }).fill(FIXTURE_WORKER_NAME);
  await wizard.getByRole("option", { name: new RegExp(FIXTURE_WORKER_NAME, "i") }).first().click();
  await wizard.getByLabel(`Expected hours for ${FIXTURE_WORKER_NAME}`).fill("1");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.locator('input[name="req_part_description_0"]').fill(USED);
  await wizard.getByRole("option", { name: new RegExp(USED) }).first().click();
  await wizard.locator('input[name="req_part_quantity_0"]').fill("2");
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("button", { name: "Create Job Card", exact: true }).click();
  await expect(page.getByText("Job Card Created Successfully")).toBeVisible({ timeout: 20_000 });
  const jobCardNumber = extractJobCardNumber((await page.locator("body").innerText()) ?? "");

  // On a Job Card: identity locked, other fields still editable.
  await openDetails(page, `${CODE}B`);
  await page.getByRole("button", { name: "Edit Material" }).click();
  await expect(page.locator("#me-name")).toBeDisabled();
  await expect(page.locator("#me-unit")).toBeDisabled();
  await expect(page.getByText(/used on a Job Card or Materials Request/).first()).toBeVisible();
  await page.locator("#me-category").fill("Mechanical Materials");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Material Updated Successfully")).toBeVisible({ timeout: 15_000 });

  // The Job Card still finds its material after the edit.
  await page.goto("/maintenance/daily-activity");
  await page.getByRole("button", { name: new RegExp(jobCardNumber.replace(/\//g, "\\/")) }).first().click();
  const panel = page.locator("#daily-activity-panel");
  await panel.getByRole("button", { name: "Process Materials" }).first().click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Process Materials" });
  await expect(dialog.getByText(USED)).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Confirm & Process Materials" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  expect(await getOfflineInventoryBalance(USED, "Packet")).toBe(0);
  const issued = await prisma.offline_inventory_movements.findMany({ where: { manual_material_name: USED, movement_type: "ISSUED" } });
  expect(issued.map((m) => [Number(m.quantity), m.unit])).toEqual([[2, "Packet"]]);
});

test("Other roles: Technician cannot open Inventory Control; Manager sees no Edit or Delete", async ({ browser }) => {
  const tech = await browser.newPage();
  await signIn(tech, process.env.E2E_TECH_EMAIL ?? "", process.env.E2E_TECH_PASSWORD ?? "");
  await tech.goto("/store/offline-inventory");
  await expect(tech.getByRole("button", { name: "Edit Material" })).toHaveCount(0);
  await expect(tech.getByRole("tab", { name: /All Materials/ })).toHaveCount(0);
  await tech.close();

  const page = await browser.newPage();
  await installCriticalPopupHandler(page);
  await login(page, MANAGER.email, MANAGER.password);
  await openDetails(page, `${CODE}B`);
  await expect(page.getByRole("button", { name: "Edit Material" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Material" })).toHaveCount(0);
});
