import { test, expect } from "@playwright/test";
import {
  DATA_ENTRY,
  MANAGER,
  E2E_ORDERED_BY_MARKER,
  E2E_PREFIX,
  RUN_ID,
  FIXTURE_ASSET_CODE,
  FIXTURE_WORKER_NAME,
  login,
  extractJobCardNumber,
  installCriticalPopupHandler,
  seedOpeningStock,
  getOfflineInventoryBalance,
  getJobCardMovements,
} from "./helpers";

/**
 * RECAFCO MMS — mixed required-materials scenario on the current,
 * register-first workflow. One line has enough Offline Inventory stock (must
 * be issued directly, never received); the other is a registered material
 * with no stock (must be received first, then issued). Both are processed by
 * the single "Process Materials" action that replaced the separate Receive /
 * Issue dialogs. Covers the original bug too: the Job Card must never read
 * as "Materials Completed" while one line still needs receiving.
 *
 * Uses freshly-seeded, uniquely-named fixtures so the stock assertions are
 * deterministic regardless of what other E2E runs have done.
 */

const EXISTING_MATERIAL_NAME = `E2E-MMS-Filter-${RUN_ID}`;
const NEW_MATERIAL_NAME = `E2E-MMS-Oil-${RUN_ID}`;
const EXISTING_STOCK_QTY = 110;
const REQUIRED_EXISTING_QTY = 5;
const REQUIRED_NEW_QTY = 1;
const NEW_MATERIAL_UNIT = "LITER";
const TOTAL_REQUIRED = REQUIRED_EXISTING_QTY + REQUIRED_NEW_QTY;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedOpeningStock(EXISTING_MATERIAL_NAME, EXISTING_STOCK_QTY, "PCS");
  // Registered in Inventory with no stock — the same zero-quantity opening
  // entry Inventory's "Add New Material" (register only) writes.
  await seedOpeningStock(NEW_MATERIAL_NAME, 0, NEW_MATERIAL_UNIT);
});

test("Mixed materials: existing stock issues directly, registered material without stock is received first", async ({ browser }) => {
  test.setTimeout(180_000);

  const dataEntryPage = await browser.newPage();
  await installCriticalPopupHandler(dataEntryPage);
  await login(dataEntryPage, DATA_ENTRY.email, DATA_ENTRY.password);

  const wizard = dataEntryPage.locator('div[role="dialog"][aria-labelledby="new-job-card-heading"]');
  let jobCardNumber = "";

  await test.step("Create Job Card with an existing-stock and a no-stock registered material", async () => {
    await dataEntryPage.goto("/dashboard?new_job_card=1");
    await expect(wizard).toBeVisible();

    await wizard.getByLabel("Search assets, vehicles, and machines").fill(FIXTURE_ASSET_CODE);
    await wizard.getByRole("button", { name: new RegExp(FIXTURE_ASSET_CODE) }).first().click();
    await wizard.getByRole("button", { name: "Next" }).click();

    await wizard.locator('input[name="ordered_by"]').fill(E2E_ORDERED_BY_MARKER);
    await wizard
      .locator('input[name="operator_complaint"], textarea[name="operator_complaint"]')
      .fill(`E2E mixed materials test ${E2E_PREFIX}`);
    await wizard.getByRole("button", { name: "Next" }).click();

    await wizard.locator('input[name="worker_type"][value="Mechanical"]').check({ force: true });
    await wizard.getByLabel(/Assign work(ers)? now/).check();
    await wizard.getByRole("button", { name: "Internal Team" }).click();
    await wizard.getByRole("combobox", { name: "Find a helper" }).fill(FIXTURE_WORKER_NAME);
    await wizard.getByRole("option", { name: new RegExp(FIXTURE_WORKER_NAME, "i") }).first().click();
    await wizard.getByLabel(`Expected hours for ${FIXTURE_WORKER_NAME}`).fill("1");
    await wizard.getByRole("button", { name: "Next" }).click();

    // Required Materials — both lines are picked from Inventory (the wizard
    // only accepts registered materials).
    await wizard.locator('input[name="req_part_description_0"]').fill(EXISTING_MATERIAL_NAME);
    await wizard.getByRole("option", { name: new RegExp(EXISTING_MATERIAL_NAME) }).first().click();
    await wizard.locator('input[name="req_part_quantity_0"]').fill(String(REQUIRED_EXISTING_QTY));

    await wizard.getByRole("button", { name: "Add Material" }).click();
    await wizard.locator('input[name="req_part_description_1"]').fill(NEW_MATERIAL_NAME);
    await wizard.getByRole("option", { name: new RegExp(NEW_MATERIAL_NAME) }).first().click();
    await wizard.locator('input[name="req_part_quantity_1"]').fill(String(REQUIRED_NEW_QTY));

    await wizard.getByRole("button", { name: "Next" }).click(); // -> attachments
    await wizard.getByRole("button", { name: "Next" }).click(); // -> review
    await wizard.getByRole("button", { name: "Create Job Card", exact: true }).click();

    await expect(dataEntryPage.getByText("Job Card Created Successfully")).toBeVisible({ timeout: 20_000 });
    jobCardNumber = extractJobCardNumber((await dataEntryPage.locator("body").innerText()) ?? "");
    expect(jobCardNumber).toBeTruthy();
    await dataEntryPage.getByRole("link", { name: "Open in Daily Activity" }).click();
  });

  const panel = () => dataEntryPage.locator("#daily-activity-panel");
  const processDialog = dataEntryPage.getByRole("dialog").filter({ hasText: "Process Materials" });
  // A Process Materials group: its "<title> (<count>)" heading's container,
  // which also holds the lines listed under it.
  const group = (title: string) => processDialog.getByText(new RegExp(title + " \\(\\d+\\)")).locator("xpath=..");

  await test.step("Daily Activity: per-line status, materials pending, closure not offered yet", async () => {
    await dataEntryPage.waitForURL(/\/maintenance\/daily-activity/, { timeout: 15_000 });
    const row = dataEntryPage.getByRole("button", { name: new RegExp(jobCardNumber.replace(/\//g, "\\/")) }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // Quantities (5 PCS + 1 LITER), then each line with its own status.
    await expect(panel().getByText(`Required ${TOTAL_REQUIRED} items · Issued 0 · Remaining ${TOTAL_REQUIRED}`).first()).toBeVisible();
    await expect(panel().getByRole("listitem").filter({ hasText: EXISTING_MATERIAL_NAME })).toContainText("Ready to Issue");
    await expect(panel().getByRole("listitem").filter({ hasText: NEW_MATERIAL_NAME })).toContainText("Needs Receiving");
    // The whole Job Card must never read as completed while a line still
    // needs receiving.
    await expect(panel().getByText("Materials Completed")).toHaveCount(0);
    await expect(panel().getByRole("button", { name: "Request Closure" })).toHaveCount(0);
  });

  await test.step("Process Materials lists the stocked line as Ready to Issue and the other as Need Receiving", async () => {
    await panel().getByRole("button", { name: "Process Materials" }).first().click();
    await expect(processDialog).toBeVisible({ timeout: 10_000 });
    await expect(group("Ready to Issue").getByText(EXISTING_MATERIAL_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(group("Ready to Issue").getByText(NEW_MATERIAL_NAME)).toHaveCount(0);
    await expect(group("Need Receiving").getByText(NEW_MATERIAL_NAME)).toBeVisible();
    await expect(group("Need Receiving").getByText(EXISTING_MATERIAL_NAME)).toHaveCount(0);

    await processDialog.getByRole("button", { name: "Confirm & Process Materials" }).click();
    await expect(processDialog).toBeHidden({ timeout: 15_000 });
  });

  await test.step("Stock movements: stocked line issued only; new line received then issued; balances exact", async () => {
    const moves = await getJobCardMovements(jobCardNumber);
    const of = (name: string, type: string) => moves.filter((m) => m.name === name && m.type === type).map((m) => m.quantity);
    expect(of(EXISTING_MATERIAL_NAME, "RECEIVED")).toEqual([]);
    expect(of(EXISTING_MATERIAL_NAME, "ISSUED")).toEqual([REQUIRED_EXISTING_QTY]);
    expect(of(NEW_MATERIAL_NAME, "RECEIVED")).toEqual([REQUIRED_NEW_QTY]);
    expect(of(NEW_MATERIAL_NAME, "ISSUED")).toEqual([REQUIRED_NEW_QTY]);
    expect(await getOfflineInventoryBalance(EXISTING_MATERIAL_NAME, "PCS")).toBe(EXISTING_STOCK_QTY - REQUIRED_EXISTING_QTY);
    expect(await getOfflineInventoryBalance(NEW_MATERIAL_NAME, NEW_MATERIAL_UNIT)).toBe(0);
  });

  await test.step("Both materials now completed", async () => {
    await expect(panel().getByText("Materials Completed").first()).toBeVisible({ timeout: 10_000 });
    await expect(panel().getByText(`Required ${TOTAL_REQUIRED} items · Issued ${TOTAL_REQUIRED} · Remaining 0`).first()).toBeVisible();
    await expect(panel().getByRole("button", { name: "Process Materials" })).toHaveCount(0);
    // Materials alone are not enough: the assigned worker has not finished.
    await expect(panel().getByRole("button", { name: "Request Closure" })).toHaveCount(0);
  });

  await test.step("Worker finishes; Request Closure becomes available and is sent", async () => {
    await panel().getByRole("button", { name: "Start", exact: true }).click();
    await expect(panel().getByText("Live").first()).toBeVisible({ timeout: 10_000 });
    await panel().getByRole("button", { name: "Finish Work" }).click();
    await expect(panel().getByText("Finished", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    await expect(panel().getByText("Ready for closure request.")).toBeVisible({ timeout: 10_000 });
    await panel().getByRole("button", { name: "Request Closure" }).first().click();
    const closureDialog = dataEntryPage.getByRole("dialog").filter({ hasText: "Request Job Card Closure" });
    await expect(closureDialog).toBeVisible({ timeout: 10_000 });
    await closureDialog.getByRole("button", { name: "Request Closure", exact: true }).click();
    await expect(dataEntryPage.getByText("Closure request submitted.").first()).toBeVisible({ timeout: 15_000 });
  });

  await test.step("Manager: Closure Review shows both materials fully issued", async () => {
    const managerPage = await browser.newPage();
    await installCriticalPopupHandler(managerPage);
    await login(managerPage, MANAGER.email, MANAGER.password);

    const kpi = managerPage.getByRole("link", { name: /Closure Requests/ }).first();
    await expect(kpi).toBeVisible({ timeout: 15_000 });
    await kpi.click();
    await managerPage.waitForURL(/closureRequests=1/);

    const closureRequestsModal = managerPage.getByRole("dialog").filter({ hasText: "Closure Requests" });
    await expect(closureRequestsModal).toBeVisible({ timeout: 10_000 });
    const row = closureRequestsModal.locator("div.border-b.py-3").filter({ hasText: jobCardNumber });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: "Review Closure" }).click();

    const reviewModal = managerPage.getByRole("dialog").filter({ hasText: "Closure Review" });
    await expect(reviewModal).toBeVisible({ timeout: 10_000 });
    await expect(reviewModal.getByText("Materials Completed", { exact: true }).first()).toBeVisible();
    for (const name of [EXISTING_MATERIAL_NAME, NEW_MATERIAL_NAME]) {
      const line = reviewModal.getByRole("row").filter({ hasText: name });
      await expect(line).toBeVisible();
      await expect(line.getByText("Fully Issued")).toBeVisible();
    }

    await managerPage.close();
  });
});
