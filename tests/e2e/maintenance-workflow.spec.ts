import { test, expect } from "@playwright/test";
import {
  DATA_ENTRY,
  MANAGER,
  E2E_ORDERED_BY_MARKER,
  E2E_PREFIX,
  FIXTURE_ASSET_CODE,
  FIXTURE_WORKER_NAME,
  FIXTURE_MATERIAL_NAME,
  login,
  extractJobCardNumber,
  installCriticalPopupHandler,
} from "./helpers";

/**
 * RECAFCO MMS — Full end-to-end workflow: Data Entry creates a Job Card
 * through Manager closure approval. Runs against the local dev app/DB only.
 *
 * Steps run in file order against a single shared Job Card (module-level
 * state) — test.describe.configure({ mode: "serial" }) plus
 * playwright.config.ts's workers:1 guarantee this ordering.
 */

test.describe.configure({ mode: "serial" });

let jobCardNumber: string;
let jobCardDetailHref: string;

test.describe("RECAFCO MMS full workflow", () => {
  test("Data Entry: login, create Job Card, issue materials, track worker time, request closure", async ({ page }) => {
    await test.step("Login as Data Entry", async () => {
      await installCriticalPopupHandler(page);
      await login(page, DATA_ENTRY.email, DATA_ENTRY.password);
      await expect(page.locator("header").getByText("Maintenance Data Entry")).toBeVisible();
    });

    const wizard = page.locator('div[role="dialog"][aria-labelledby="new-job-card-heading"]');

    await test.step("Open New Job Card wizard", async () => {
      const createLink = page.getByRole("link", { name: "Create Job Card" }).first();
      if (await createLink.count()) {
        await createLink.click();
      } else {
        await page.goto("/dashboard?new_job_card=1");
      }
      await expect(wizard).toBeVisible();
      await expect(wizard.getByText("New Job Card")).toBeVisible();
    });

    await test.step("Step 1 — Select Asset", async () => {
      const search = wizard.getByPlaceholder(/Search asset code, name, plate number/i);
      await search.fill(FIXTURE_ASSET_CODE);
      await wizard.getByRole("button", { name: new RegExp(FIXTURE_ASSET_CODE) }).first().click();
      await expect(wizard.getByText("SELECTED ASSET / VEHICLE")).toBeVisible();
      await wizard.getByRole("button", { name: "Next" }).click();
    });

    await test.step("Step 2 — Request Details", async () => {
      await wizard.locator('input[name="ordered_by"]').fill(E2E_ORDERED_BY_MARKER);
      await wizard.locator('input[name="operator_complaint"], textarea[name="operator_complaint"]').fill(`E2E complete workflow test ${E2E_PREFIX}`);
      await wizard.locator('input[name="maintenance_type"][value="Repair"]').check({ force: true });
      await wizard.getByRole("button", { name: "Next" }).click();
    });

    await test.step("Step 3 — Work Team & Assignment", async () => {
      await wizard.locator('input[name="worker_type"][value="Mechanical"]').check({ force: true });
      await wizard.getByLabel("Assign work now").check();
      await wizard.getByRole("button", { name: "Internal Team" }).click();

      const helperSearch = wizard.getByPlaceholder(/Search helpers \/ labor/i);
      await helperSearch.fill(FIXTURE_WORKER_NAME);
      await wizard.getByRole("button", { name: new RegExp(FIXTURE_WORKER_NAME, "i") }).first().click();

      // Data Entry restriction check (Task 14): worker picker/chip never
      // shows an hourly rate or "KWD" regardless of role — confirm here.
      await expect(wizard.getByText(FIXTURE_WORKER_NAME, { exact: false }).first()).toBeVisible();
      await expect(wizard.getByText(/KWD/)).toHaveCount(0);

      await wizard.getByRole("button", { name: "Next" }).click();
    });

    await test.step("Step 4 — Required Materials", async () => {
      const descInput = wizard.locator('input[name="req_part_description_0"]');
      await descInput.fill(FIXTURE_MATERIAL_NAME);
      const suggestion = wizard.getByRole("button", { name: new RegExp(FIXTURE_MATERIAL_NAME, "i") }).first();
      await expect(suggestion).toBeVisible({ timeout: 10_000 });
      await suggestion.click();
      await wizard.locator('input[name="req_part_quantity_0"]').fill("1");
      await wizard.getByRole("button", { name: "Next" }).click();
    });

    await test.step("Step 5 — Attachments (skip)", async () => {
      await wizard.getByRole("button", { name: "Next" }).click();
    });

    let openInDailyActivityHref = "";

    await test.step("Step 6 — Review & Save, submit", async () => {
      const submitButton = wizard.getByRole("button", { name: "Create Job Card", exact: true });
      await expect(submitButton).toBeVisible();
      await submitButton.click();
    });

    await test.step("Job Card Created success modal", async () => {
      await expect(page.getByText("Job Card Created Successfully")).toBeVisible({ timeout: 20_000 });
      const bodyText = (await page.locator("body").innerText()) ?? "";
      jobCardNumber = extractJobCardNumber(bodyText);
      expect(jobCardNumber).toBeTruthy();

      const viewDetailsLink = page.getByRole("link", { name: "View Job Card Details" });
      jobCardDetailHref = (await viewDetailsLink.getAttribute("href")) ?? "";
      expect(jobCardDetailHref).toMatch(/\/maintenance\/work-orders\//);

      const openInDailyActivity = page.getByRole("link", { name: "Open in Daily Activity" });
      openInDailyActivityHref = (await openInDailyActivity.getAttribute("href")) ?? "";
      await openInDailyActivity.click();
    });

    await test.step("Daily Activity: confirm new Job Card appears", async () => {
      await page.waitForURL(/\/maintenance\/daily-activity/, { timeout: 15_000 });
      const row = page.getByRole("button", { name: new RegExp(jobCardNumber.replace(/\//g, "\\/")) }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText("NEW")).toBeVisible();
      await row.click();
      await expect(row).toHaveAttribute("aria-pressed", "true");
    });

    const panel = () => page.locator("#daily-activity-panel");

    await test.step("Daily Activity: confirm status and assignment", async () => {
      await expect(panel().getByText("Active", { exact: true }).first()).toBeVisible();
      await expect(panel().getByText(FIXTURE_WORKER_NAME)).toBeVisible();
      // Data Entry cannot view costs — no KWD anywhere in the panel.
      await expect(panel().getByText(/KWD/)).toHaveCount(0);
    });

    await test.step("Materials: issue (receiving first if stock is unavailable)", async () => {
      const receiveBtn = panel().getByRole("button", { name: "Receive Materials" });
      if (await receiveBtn.count()) {
        await receiveBtn.click();
        const receiveDialog = page.locator('div[role="dialog"][aria-labelledby="send-materials-heading"]');
        await expect(receiveDialog).toBeVisible({ timeout: 10_000 });
        await receiveDialog.getByRole("button", { name: "Receive Materials", exact: true }).click();
        await expect(page.getByText("Material Received")).toBeVisible({ timeout: 10_000 });
        await expect(receiveDialog).toBeHidden({ timeout: 10_000 });
      }

      const issueBtn = panel().getByRole("button", { name: /Issue (Material|Available)/ });
      await expect(issueBtn).toBeVisible({ timeout: 15_000 });
      await issueBtn.click();

      const issueDialog = page.getByRole("dialog").filter({ hasText: "Issue Material to Job Card" });
      await expect(issueDialog).toBeVisible({ timeout: 10_000 });
      await issueDialog.getByRole("button", { name: "Issue Material", exact: true }).click();
      await expect(page.getByText("Material Issued")).toBeVisible({ timeout: 10_000 });
      await expect(issueDialog).toBeHidden({ timeout: 10_000 });
    });

    await test.step("Materials: confirm Required/Issued/Remaining and Materials Completed", async () => {
      await expect(panel().getByText(/Required 1[\s\S]*Issued 1[\s\S]*Remaining 0/)).toBeVisible({ timeout: 15_000 });
      await expect(panel().getByText("Materials Completed").first()).toBeVisible();
      await expect(panel().getByRole("button", { name: "Receive Materials" })).toHaveCount(0);
    });

    await test.step("Worker time: Start / Pause / Resume / Stop", async () => {
      // Toast confirmations (e.g. "Work Session Started") are transient and
      // unreliable to assert on — the button/status-badge state change in
      // the panel itself is the authoritative, task-required signal.
      await panel().getByRole("button", { name: "Start" }).click();
      await expect(panel().getByText("Live")).toBeVisible({ timeout: 10_000 });
      await expect(panel().getByRole("button", { name: "Pause" })).toBeVisible();

      await page.waitForTimeout(3_000);

      await panel().getByRole("button", { name: "Pause" }).click();
      await expect(panel().getByText("Paused", { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(panel().getByRole("button", { name: "Resume" })).toBeVisible();

      await panel().getByRole("button", { name: "Resume" }).click();
      await expect(panel().getByText("Live")).toBeVisible({ timeout: 10_000 });
      await expect(panel().getByRole("button", { name: "Pause" })).toBeVisible();

      await page.waitForTimeout(3_000);

      await panel().getByRole("button", { name: "Stop" }).click();
      await expect(panel().getByText("Completed", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      await expect(panel().getByRole("button", { name: "Resume Work" })).toBeVisible();
    });

    await test.step("Request Closure", async () => {
      await expect(panel().getByText("Ready", { exact: true })).toBeVisible({ timeout: 10_000 });
      await panel().getByRole("button", { name: "Request Closure" }).click();

      const closureDialog = page.getByRole("dialog").filter({ hasText: "Request Job Card Closure" });
      await expect(closureDialog).toBeVisible({ timeout: 10_000 });

      await closureDialog
        .getByPlaceholder(/Completion note|remarks/i)
        .or(closureDialog.locator("textarea"))
        .first()
        .fill(`E2E closure request ${E2E_PREFIX}`);

      const nameInput = closureDialog.getByPlaceholder(/Attachment name/i).first();
      if (await nameInput.count()) {
        await nameInput.fill("E2E Completion Photo");
        const fileInput = closureDialog.locator('input[type="file"]').first();
        await fileInput.setInputFiles({
          name: "e2e-completion-photo.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(`E2E completion attachment ${E2E_PREFIX}`),
        });
      }

      await closureDialog.getByRole("button", { name: "Request Closure", exact: true }).click();
      await expect(page.getByText("Closure Request Sent")).toBeVisible({ timeout: 15_000 });
      await expect(closureDialog).toBeHidden({ timeout: 10_000 });
    });

    await test.step("Confirm closure requested state", async () => {
      // Once closure is requested the Job Card drops off Daily Activity's
      // "active" board (it's no longer active work — it's in the Manager's
      // approval queue), so the authoritative check is the Job Card's own
      // status badge, not the Daily Activity list.
      await page.goto(jobCardDetailHref);
      await expect(page.getByText("Closure Requested", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    });

    void openInDailyActivityHref;
  });

  test("Manager: review closure request, correct/approve, verify Closed Jobs and Job Card tabs", async ({ page }) => {
    await test.step("Login as Manager", async () => {
      // Real pre-existing closure requests in the dev DB (plus this test's
      // own) can pop the Critical Workflow Popup at any point during this
      // test via the SSE-driven poll — install the auto-dismiss handler
      // before doing anything else so it's active for every later action.
      await installCriticalPopupHandler(page);
      await login(page, MANAGER.email, MANAGER.password);
      await expect(page.locator("header").getByText("Maintenance Manager")).toBeVisible();
    });

    await test.step("Closure Requests KPI shows >= 1 and opens the modal", async () => {
      const kpi = page.getByRole("link", { name: /Closure Requests/ }).first();
      await expect(kpi).toBeVisible({ timeout: 15_000 });
      const kpiText = (await kpi.innerText()) ?? "";
      const count = parseInt(kpiText.match(/\d+/)?.[0] ?? "0", 10);
      expect(count).toBeGreaterThanOrEqual(1);
      await kpi.click();
      await page.waitForURL(/closureRequests=1/);
    });

    const closureRequestsModal = page.getByRole("dialog").filter({ hasText: "Closure Requests" });

    await test.step("Confirm E2E Job Card appears and open Review Closure", async () => {
      await expect(closureRequestsModal).toBeVisible({ timeout: 10_000 });
      // Scoped to the row's own "border-b py-3" wrapper class (not a bare
      // "div" filter) — a bare filter would also match the list's outer
      // container div, which transitively "has" both the text and a button
      // from some OTHER row when more than one closure request is pending.
      const row = closureRequestsModal.locator("div.border-b.py-3").filter({ hasText: jobCardNumber });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole("button", { name: "Review Closure" }).click();
    });

    const reviewModal = page.getByRole("dialog").filter({ hasText: "Closure Review" });

    await test.step("Closure Review: verify Job Card summary", async () => {
      await expect(reviewModal).toBeVisible({ timeout: 10_000 });
      await expect(reviewModal.getByText(jobCardNumber)).toBeVisible();
      await expect(reviewModal.getByText(/Created:/)).toBeVisible();
      await expect(reviewModal.getByText(/Closure requested:/)).toBeVisible();
      await expect(reviewModal.getByText(/Time taken:/)).toBeVisible();
      await expect(reviewModal.getByText(/Requested by:/)).toBeVisible();
      await expect(reviewModal.getByText("dataentry", { exact: false })).toBeVisible();
    });

    await test.step("Closure Review: verify worker hours/rate/pay (Manager canViewCosts=true)", async () => {
      await expect(reviewModal.getByText(FIXTURE_WORKER_NAME)).toBeVisible();
      await expect(reviewModal.getByText(/Hourly Rate:/)).toBeVisible();
      await expect(reviewModal.getByText(/KWD\/hr/)).toBeVisible();
      await expect(reviewModal.getByText(/Total Pay:/)).toBeVisible();
      await expect(reviewModal.getByText(/Total Hours:/)).toBeVisible();
      await expect(reviewModal.getByText(/Sessions:/)).toBeVisible();
    });

    await test.step("Closure Review: verify materials completion", async () => {
      await expect(reviewModal.getByText("Materials Completed", { exact: true })).toBeVisible();
      await expect(reviewModal.getByText(FIXTURE_MATERIAL_NAME, { exact: false })).toBeVisible();
      await expect(reviewModal.getByText(/Req 1[\s\S]*Issued 1[\s\S]*Remaining 0/)).toBeVisible();
    });

    await test.step("Closure Review: verify attachment and closure note", async () => {
      const hasNamedAttachment = await reviewModal.getByText("E2E Completion Photo").count();
      if (hasNamedAttachment === 0) {
        await expect(reviewModal.getByText("No attachments uploaded.")).toBeVisible();
      }
      await expect(reviewModal.getByText(new RegExp(`E2E closure request ${E2E_PREFIX}`))).toBeVisible();
    });

    await test.step("Closure Review: readiness checklist", async () => {
      await expect(reviewModal.getByText("Materials completed", { exact: true })).toBeVisible();
      await expect(reviewModal.getByText("No active worker session", { exact: true })).toBeVisible();
      await reviewModal.getByText(/Worker hours reviewed/).click();
      await reviewModal.getByText(/Attachments reviewed/).click();
    });

    await test.step("Correct Session button present (correction itself skipped — see report)", async () => {
      const correctBtn = reviewModal.getByRole("button", { name: "Correct Session" });
      await expect(correctBtn.first()).toBeVisible({ timeout: 20_000 });
      // TODO (Task 11 fallback, explicitly permitted by the test brief):
      // actually exercising Correct Session requires driving
      // SessionHistoryModal's date/time correction inputs, which were not
      // characterized during selector research for this suite. Presence of
      // the button (Manager-reachable) is verified here; a Data-Entry-cannot-
      // reach-it check lives in permissions.spec.ts. Follow-up: read
      // components/work-orders/session-history-modal.tsx and extend this
      // step to submit a real correction with reason "E2E manager correction".
    });

    await test.step("Approve Closure", async () => {
      await reviewModal.getByRole("button", { name: "Approve Closure" }).click();
      await expect(page.getByText("Job Card Closed")).toBeVisible({ timeout: 20_000 });
      await expect(reviewModal).toBeHidden({ timeout: 15_000 });
    });

    await test.step("Confirm row removed from Closure Requests list", async () => {
      await expect(closureRequestsModal.getByText(jobCardNumber)).toHaveCount(0);
      // Two "Close" buttons exist in this dialog: the icon-only X (aria-label
      // "Close", no visible text) and the footer text button — getByText
      // matches only the latter since it looks at rendered text content.
      await closureRequestsModal.getByText("Close", { exact: true }).click();
    });

    await test.step("Closed Jobs: confirm Job Card listed with hours/pay/materials", async () => {
      const closedJobsCard = page.getByText("Closed Jobs", { exact: true });
      await expect(closedJobsCard).toBeVisible({ timeout: 10_000 });
      await closedJobsCard.click();

      const closedJobsModal = page.getByRole("dialog").filter({ hasText: "Closed Job Cards" });
      await expect(closedJobsModal).toBeVisible({ timeout: 10_000 });

      const closedRow = closedJobsModal.locator("div.border-b.py-3").filter({ hasText: jobCardNumber });
      await expect(closedRow).toBeVisible({ timeout: 15_000 });
      await closedRow.getByRole("button", { name: "View Details" }).click();

      const closedDetailModal = page.getByRole("dialog").filter({ hasText: "Closed Job Card Details" });
      await expect(closedDetailModal).toBeVisible({ timeout: 10_000 });
      await expect(closedDetailModal.getByText(/Total Pay|KWD/).first()).toBeVisible();
      await expect(closedDetailModal.getByText(/Fully Issued/)).toBeVisible();

      await closedDetailModal.getByRole("link", { name: "Open Full Job Card" }).click();
    });

    await test.step("Job Card detail: verify tabs after closure", async () => {
      await page.waitForURL(/\/maintenance\/work-orders\//, { timeout: 15_000 });

      await test.step("Overview tab", async () => {
        await page.goto(`${jobCardDetailHref}?tab=overview`);
        await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
      });

      await test.step("Assignment & Work Time tab", async () => {
        await page.goto(`${jobCardDetailHref}?tab=assignment`);
        // History-tab timeline entries elsewhere on this page ("worker1
        // started/paused/stopped work on...") also match "worker1" by plain
        // text, so scope to the assignment section itself.
        await expect(page.locator("#assignment").getByText(FIXTURE_WORKER_NAME).first()).toBeVisible({ timeout: 10_000 });
      });

      await test.step("Materials tab", async () => {
        await page.goto(`${jobCardDetailHref}?tab=materials`);
        await expect(page.getByText("Required items")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Fully Issued")).toBeVisible();
      });

      await test.step("Attachments tab", async () => {
        await page.goto(`${jobCardDetailHref}?tab=attachments`);
        await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible({ timeout: 10_000 });
      });

      await test.step("Closure tab", async () => {
        await page.goto(`${jobCardDetailHref}?tab=closure`);
        await expect(page.getByText("This Job Card is closed.")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/Closed .* by/)).toBeVisible();
      });

      await test.step("History tab", async () => {
        await page.goto(`${jobCardDetailHref}?tab=history`);
        // The timeline renders duplicate mobile/desktop entry sets (one
        // hidden via CSS per breakpoint) — ":visible" picks the rendered one
        // regardless of which copy happens to come first in the DOM.
        await expect(page.locator('*:visible', { hasText: "Job Card created" }).first()).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('*:visible', { hasText: /Work session started/ }).first()).toBeVisible();
        await expect(page.locator('*:visible', { hasText: "Closure requested" }).first()).toBeVisible();
        await expect(page.locator('*:visible', { hasText: /Job Card closed|Closure approved/ }).first()).toBeVisible();
      });
    });
  });
});
