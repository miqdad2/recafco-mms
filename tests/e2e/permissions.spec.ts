import { test, expect } from "@playwright/test";
import { DATA_ENTRY, FIXTURE_ASSET_CODE, login, installCriticalPopupHandler } from "./helpers";

/**
 * RECAFCO MMS — Task 14: Data Entry restriction checks. Independent of the
 * main workflow spec's Job Card (fresh login, no shared state) so this file
 * can run standalone against any local dev DB state.
 */

test.describe("Data Entry restrictions", () => {
  test("Worker Profiles: hourly rate / Edit / Deactivate hidden, Add Worker visible", async ({ page }) => {
    await installCriticalPopupHandler(page);
    await login(page, DATA_ENTRY.email, DATA_ENTRY.password);
    await page.goto("/admin/worker-profiles");

    await expect(page.getByRole("columnheader", { name: "Hourly Rate (KWD)" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Deactivate|Reactivate/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add Worker" }).or(page.getByRole("link", { name: "Add Worker" }))).toBeVisible();
  });

  test("New Job Card wizard: worker picker never shows KWD/hr", async ({ page }) => {
    await installCriticalPopupHandler(page);
    await login(page, DATA_ENTRY.email, DATA_ENTRY.password);
    await page.goto("/dashboard?new_job_card=1");
    const wizard = page.locator('div[role="dialog"][aria-labelledby="new-job-card-heading"]');
    await expect(wizard).toBeVisible();

    // Step 1 requires an asset before Next advances (strict validation).
    await wizard.getByPlaceholder(/Search asset code, name, plate number/i).fill(FIXTURE_ASSET_CODE);
    await wizard.getByRole("button", { name: new RegExp(FIXTURE_ASSET_CODE) }).first().click();
    await wizard.getByRole("button", { name: "Next" }).click(); // -> step 2

    // Step 2 requires ordered_by/date_of_order/operator_complaint before Next
    // advances — leaving them empty would silently re-block on step 2.
    await wizard.locator('input[name="ordered_by"]').fill("Permissions Check");
    await wizard.locator('input[name="operator_complaint"], textarea[name="operator_complaint"]').fill("Permissions check — worker picker cost visibility");
    await wizard.getByRole("button", { name: "Next" }).click(); // -> step 3

    await expect(wizard.getByRole("heading", { name: "Work Team & Assignment" })).toBeVisible();
    await expect(wizard.getByText(/KWD/)).toHaveCount(0);
  });

  test("Dashboard: no Closure Requests / Manager-only entry points reachable", async ({ page }) => {
    await installCriticalPopupHandler(page);
    await login(page, DATA_ENTRY.email, DATA_ENTRY.password);
    await expect(page.getByRole("link", { name: /Closure Requests/ })).toHaveCount(0);
    await expect(page.getByText("Closed Jobs", { exact: true })).toHaveCount(0);

    // Direct navigation to the Manager-only closure requests query param must
    // not render the modal for a Data Entry session (isManager-gated).
    await page.goto("/dashboard?closureRequests=1");
    await expect(page.getByRole("dialog").filter({ hasText: "Closure Requests" })).toHaveCount(0);
  });
});
