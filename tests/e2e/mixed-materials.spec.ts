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
} from "./helpers";

/**
 * RECAFCO MMS — Unit 10G.14, Task 12: mixed required-materials scenario.
 * One line has enough existing Offline Inventory stock (should go straight
 * to Issue Material, never Receive), the other is a brand-new/unavailable
 * material (should require Receive Materials first). Covers the exact bug
 * this unit fixed: the Receive Materials modal previously listed BOTH lines
 * regardless of whether a line already had enough stock.
 *
 * Uses freshly-seeded, uniquely-named fixtures (not the shared "engine
 * filter"/"engine oil" materials other specs use) so this test's stock
 * assertions are deterministic regardless of what other E2E runs have done.
 */

const EXISTING_MATERIAL_NAME = `E2E-MMS-Filter-${RUN_ID}`;
const NEW_MATERIAL_NAME = `E2E-MMS-Oil-${RUN_ID}`;
const EXISTING_STOCK_QTY = 110;
const REQUIRED_EXISTING_QTY = 5;
const REQUIRED_NEW_QTY = 1;
const NEW_MATERIAL_UNIT = "liter";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedOpeningStock(EXISTING_MATERIAL_NAME, EXISTING_STOCK_QTY, "PCS");
});

test("Mixed materials: existing stock issues directly, new material requires receive first", async ({ browser }) => {
  test.setTimeout(180_000);

  const dataEntryPage = await browser.newPage();
  await installCriticalPopupHandler(dataEntryPage);
  await login(dataEntryPage, DATA_ENTRY.email, DATA_ENTRY.password);

  const wizard = dataEntryPage.locator('div[role="dialog"][aria-labelledby="new-job-card-heading"]');
  let jobCardNumber = "";

  await test.step("Create Job Card with both an existing-stock and a new material", async () => {
    await dataEntryPage.goto("/dashboard?new_job_card=1");
    await expect(wizard).toBeVisible();

    await wizard.getByPlaceholder(/Search asset code, name, plate number/i).fill(FIXTURE_ASSET_CODE);
    await wizard.getByRole("button", { name: new RegExp(FIXTURE_ASSET_CODE) }).first().click();
    await wizard.getByRole("button", { name: "Next" }).click();

    await wizard.locator('input[name="ordered_by"]').fill(E2E_ORDERED_BY_MARKER);
    await wizard
      .locator('input[name="operator_complaint"], textarea[name="operator_complaint"]')
      .fill(`E2E mixed materials test ${E2E_PREFIX}`);
    await wizard.getByRole("button", { name: "Next" }).click();

    await wizard.locator('input[name="worker_type"][value="Mechanical"]').check({ force: true });
    const jobCardEstHours = wizard.locator('input[name="estimated_labor_hours"]');
    if (await jobCardEstHours.count()) await jobCardEstHours.fill("1");
    await wizard.getByLabel("Assign work now").check();
    await wizard.getByRole("button", { name: "Internal Team" }).click();
    const helperSearch = wizard.getByPlaceholder(/Search helpers \/ labor/i);
    await helperSearch.fill(FIXTURE_WORKER_NAME);
    await wizard.getByRole("button", { name: new RegExp(FIXTURE_WORKER_NAME, "i") }).first().click();
    const workerEstHours = wizard.getByLabel("Estimated hours");
    if (await workerEstHours.count()) await workerEstHours.fill("1");
    await wizard.getByRole("button", { name: "Next" }).click();

    // Required Materials — row 0: the existing-stock material (select the
    // Offline Inventory suggestion so it's linked by identity, not just text).
    await wizard.locator('input[name="req_part_description_0"]').fill(EXISTING_MATERIAL_NAME);
    const suggestion = wizard.getByRole("button", { name: new RegExp(EXISTING_MATERIAL_NAME) }).first();
    await expect(suggestion).toBeVisible({ timeout: 10_000 });
    await suggestion.click();
    await wizard.locator('input[name="req_part_quantity_0"]').fill(String(REQUIRED_EXISTING_QTY));

    // Row 1: a brand-new material, never seen before — typed manually
    // (never selecting a suggestion), unit overridden to "liter".
    await wizard.getByRole("button", { name: "Add Row" }).click();
    await wizard.locator('input[name="req_part_description_1"]').fill(NEW_MATERIAL_NAME);
    await wizard.locator('input[name="req_part_uom_1"]').fill(NEW_MATERIAL_UNIT);
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

  await test.step("Daily Activity: correct per-line status for each material", async () => {
    await dataEntryPage.waitForURL(/\/maintenance\/daily-activity/, { timeout: 15_000 });
    const row = dataEntryPage.getByRole("button", { name: new RegExp(jobCardNumber.replace(/\//g, "\\/")) }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    await expect(panel().getByText(EXISTING_MATERIAL_NAME)).toBeVisible();
    await expect(panel().getByText(NEW_MATERIAL_NAME)).toBeVisible();

    const panelText = (await panel().innerText()) ?? "";
    expect(panelText).toMatch(/Ready to Issue/);
    expect(panelText).toMatch(/Needs Receiving/);
    // The bug this unit fixes: the whole Job Card must never read as if
    // everything is already received/completed while one line still needs
    // receiving.
    await expect(panel().getByText("Materials Completed")).toHaveCount(0);
  });

  await test.step("Issue Material modal lists only the existing-stock material", async () => {
    const issueBtn = panel().getByRole("button", { name: /Issue (Material|Available)/ });
    await expect(issueBtn).toBeVisible({ timeout: 10_000 });
    await issueBtn.click();

    const issueDialog = dataEntryPage.getByRole("dialog").filter({ hasText: "Issue Material to Job Card" });
    await expect(issueDialog).toBeVisible({ timeout: 10_000 });
    await expect(issueDialog.getByText(EXISTING_MATERIAL_NAME)).toBeVisible();
    await expect(issueDialog.getByText(NEW_MATERIAL_NAME)).toHaveCount(0);

    await issueDialog.getByRole("button", { name: "Issue Material", exact: true }).click();
    await expect(dataEntryPage.getByText("Material Issued")).toBeVisible({ timeout: 10_000 });
    await expect(issueDialog).toBeHidden({ timeout: 10_000 });
  });

  await test.step("Inventory decreased by the issued amount; new material still needs receiving", async () => {
    const balance = await getOfflineInventoryBalance(EXISTING_MATERIAL_NAME, "PCS");
    expect(balance).toBe(EXISTING_STOCK_QTY - REQUIRED_EXISTING_QTY);

    const panelText = (await panel().innerText()) ?? "";
    expect(panelText).toMatch(/Needs Receiving/);
    expect(panelText).not.toMatch(/Materials Completed/);
  });

  await test.step("Receive Materials modal lists only the new material", async () => {
    const receiveBtn = panel().getByRole("button", { name: "Receive Materials" });
    await expect(receiveBtn).toBeVisible({ timeout: 10_000 });
    await receiveBtn.click();

    const receiveDialog = dataEntryPage.locator('div[role="dialog"][aria-labelledby="send-materials-heading"]');
    await expect(receiveDialog).toBeVisible({ timeout: 10_000 });
    await expect(receiveDialog.getByText(NEW_MATERIAL_NAME)).toBeVisible();
    await expect(receiveDialog.getByText(EXISTING_MATERIAL_NAME)).toHaveCount(0);

    await receiveDialog.getByRole("button", { name: "Receive Materials", exact: true }).click();
    await expect(dataEntryPage.getByText("Material Received")).toBeVisible({ timeout: 10_000 });
    await expect(receiveDialog).toBeHidden({ timeout: 10_000 });
  });

  await test.step("New material becomes Ready to Issue, then gets issued", async () => {
    const panelText = (await panel().innerText()) ?? "";
    expect(panelText).toMatch(/Ready to Issue/);

    const issueBtn = panel().getByRole("button", { name: /Issue (Material|Available)/ });
    await expect(issueBtn).toBeVisible({ timeout: 10_000 });
    await issueBtn.click();

    const issueDialog = dataEntryPage.getByRole("dialog").filter({ hasText: "Issue Material to Job Card" });
    await expect(issueDialog).toBeVisible({ timeout: 10_000 });
    await expect(issueDialog.getByText(NEW_MATERIAL_NAME)).toBeVisible();
    await issueDialog.getByRole("button", { name: "Issue Material", exact: true }).click();
    await expect(dataEntryPage.getByText("Material Issued")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("Both materials now completed", async () => {
    await expect(panel().getByText("Materials Completed").first()).toBeVisible({ timeout: 10_000 });
    await expect(panel().getByRole("button", { name: "Receive Materials" })).toHaveCount(0);
    await expect(panel().getByRole("button", { name: /Issue (Material|Available)/ })).toHaveCount(0);
  });

  await test.step("Request closure", async () => {
    await expect(panel().getByText("Ready", { exact: true })).toBeVisible({ timeout: 10_000 });
    await panel().getByRole("button", { name: "Request Closure" }).click();
    const closureDialog = dataEntryPage.getByRole("dialog").filter({ hasText: "Request Job Card Closure" });
    await expect(closureDialog).toBeVisible({ timeout: 10_000 });
    await closureDialog.getByRole("button", { name: "Request Closure", exact: true }).click();
    await expect(dataEntryPage.getByText("Closure Request Sent")).toBeVisible({ timeout: 15_000 });
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
    await expect(reviewModal.getByText("Materials Completed", { exact: true })).toBeVisible();
    await expect(reviewModal.getByText(EXISTING_MATERIAL_NAME, { exact: false })).toBeVisible();
    await expect(reviewModal.getByText(NEW_MATERIAL_NAME, { exact: false })).toBeVisible();

    await managerPage.close();
  });
});
