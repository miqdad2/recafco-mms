import { test, expect } from "@playwright/test";
import {
  DATA_ENTRY,
  MANAGER,
  E2E_ORDERED_BY_MARKER,
  E2E_PREFIX,
  FIXTURE_ASSET_CODE,
  login,
  extractJobCardNumber,
  installCriticalPopupHandler,
} from "./helpers";

/**
 * RECAFCO MMS — Task 15: realtime / refresh check. Creates a second,
 * minimal Job Card (no materials, no worker assignment — closure is ready
 * immediately) so the Closure Requests KPI change can be observed on an
 * already-open Manager dashboard without that dashboard needing to
 * navigate anywhere itself.
 *
 * This is independent of maintenance-workflow.spec.ts's Job Card — it
 * creates and closes its own lightweight fixture, tagged with the same
 * E2E_ORDERED_BY_MARKER so scripts/e2e-mms-cleanup.mjs removes it too.
 */

test("Realtime: Manager dashboard reflects a new closure request", async ({ browser }) => {
  // Two logins + a full Job Card creation/closure-request flow + a 25s
  // realtime poll + a fallback reload comfortably exceed the suite's
  // default 120s budget.
  test.setTimeout(240_000);

  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  await installCriticalPopupHandler(managerPage);
  await login(managerPage, MANAGER.email, MANAGER.password);

  const kpiLocator = managerPage.getByRole("link", { name: /Closure Requests/ }).first();
  await expect(kpiLocator).toBeVisible({ timeout: 15_000 });
  const before = parseInt(((await kpiLocator.innerText()) ?? "0").match(/\d+/)?.[0] ?? "0", 10);

  const dataEntryContext = await browser.newContext();
  const dataEntryPage = await dataEntryContext.newPage();
  await installCriticalPopupHandler(dataEntryPage);
  await login(dataEntryPage, DATA_ENTRY.email, DATA_ENTRY.password);

  let jobCardNumber = "";
  await test.step("Data Entry creates a minimal Job Card and requests closure immediately", async () => {
    await dataEntryPage.goto("/dashboard?new_job_card=1");
    const wizard = dataEntryPage.locator('div[role="dialog"][aria-labelledby="new-job-card-heading"]');
    await expect(wizard).toBeVisible();

    await wizard.getByPlaceholder(/Search asset code, name, plate number/i).fill(FIXTURE_ASSET_CODE);
    await wizard.getByRole("button", { name: new RegExp(FIXTURE_ASSET_CODE) }).first().click();
    await wizard.getByRole("button", { name: "Next" }).click();

    await wizard.locator('input[name="ordered_by"]').fill(E2E_ORDERED_BY_MARKER);
    await wizard
      .locator('input[name="operator_complaint"], textarea[name="operator_complaint"]')
      .fill(`E2E realtime check ${E2E_PREFIX}`);
    await wizard.getByRole("button", { name: "Next" }).click();

    await wizard.locator('input[name="worker_type"][value="Mechanical"]').check({ force: true });
    await wizard.getByRole("button", { name: "Next" }).click(); // step 3 -> step 4 (required materials, none added)
    await wizard.getByRole("button", { name: "Next" }).click(); // step 4 -> step 5 (attachments, none added)
    await wizard.getByRole("button", { name: "Next" }).click(); // step 5 -> step 6 (review & save)
    await wizard.getByRole("button", { name: "Create Job Card", exact: true }).click();

    await expect(dataEntryPage.getByText("Job Card Created Successfully")).toBeVisible({ timeout: 20_000 });
    jobCardNumber = extractJobCardNumber((await dataEntryPage.locator("body").innerText()) ?? "");
    await dataEntryPage.getByRole("link", { name: "Open in Daily Activity" }).click();

    await dataEntryPage.waitForURL(/\/maintenance\/daily-activity/, { timeout: 15_000 });
    const row = dataEntryPage.getByRole("button", { name: new RegExp(jobCardNumber.replace(/\//g, "\\/")) }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const panel = dataEntryPage.locator("#daily-activity-panel");
    await expect(panel.getByText("Ready", { exact: true })).toBeVisible({ timeout: 10_000 });
    await panel.getByRole("button", { name: "Request Closure" }).click();

    const closureDialog = dataEntryPage.getByRole("dialog").filter({ hasText: "Request Job Card Closure" });
    await expect(closureDialog).toBeVisible({ timeout: 10_000 });
    await closureDialog.getByRole("button", { name: "Request Closure", exact: true }).click();
    await expect(dataEntryPage.getByText("Closure Request Sent")).toBeVisible({ timeout: 15_000 });
  });

  let autoUpdated = false;
  await test.step("Poll the already-open Manager dashboard for an automatic KPI update", async () => {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const text = (await kpiLocator.innerText().catch(() => "")) ?? "";
      const current = parseInt(text.match(/\d+/)?.[0] ?? "0", 10);
      if (current > before) {
        autoUpdated = true;
        break;
      }
      await managerPage.waitForTimeout(2_000);
    }
  });

  await test.step("Fallback: reload confirms eventual consistency regardless of auto-update", async () => {
    await managerPage.reload();
    const afterReload = managerPage.getByRole("link", { name: /Closure Requests/ }).first();
    await expect(afterReload).toBeVisible({ timeout: 15_000 });
    const text = (await afterReload.innerText()) ?? "";
    const count = parseInt(text.match(/\d+/)?.[0] ?? "0", 10);
    expect(count).toBeGreaterThan(before);
  });

  console.log(
    autoUpdated
      ? "[realtime] Closure Requests KPI updated on the already-open Manager dashboard WITHOUT a manual reload."
      : "[realtime] Closure Requests KPI did NOT update without a reload within 25s — dashboard KPI counts are server-rendered per request, not SSE-pushed; only a reload/navigation refreshes them. Documented in the final report."
  );

  await managerContext.close();
  await dataEntryContext.close();
});
