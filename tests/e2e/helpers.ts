import { expect, type Page } from "@playwright/test";

/**
 * Shared constants and helpers for the RECAFCO MMS full workflow E2E test.
 * Local dev app + local dev database only.
 */

export const DATA_ENTRY = {
  email: "dataentry@recafco.com",
  password: "123456789",
};

export const MANAGER = {
  email: "manager1@recafco.com",
  password: "123456789",
};

// Marker stored in the "Order taken by" field of every Job Card this suite
// creates — the sole identifier scripts/e2e-mms-cleanup.mjs uses to find and
// delete E2E-created rows. Never reused for anything else so the cleanup
// script's WHERE clause can never match real data.
export const E2E_ORDERED_BY_MARKER = "E2E-MMS-Test";

export const RUN_ID = `${Date.now()}`;
export const E2E_PREFIX = `E2E-MMS-${RUN_ID}`;

// Existing local fixtures reused by this suite instead of creating new
// asset/worker rows (Task 2's "prefer existing asset already available"
// principle extended to the one seeded worker profile — avoids polluting
// Worker Profiles with test rows that would need separate cleanup).
export const FIXTURE_ASSET_CODE = "AST-VEH-0043"; // Ford — Plate 11546
export const FIXTURE_WORKER_NAME = "worker1"; // Helper/Labor, active, hourly_rate 2 KWD/hr
export const FIXTURE_MATERIAL_NAME = "engine filter"; // existing Offline Inventory item with positive balance

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.getByText(/Hello,/)).toBeVisible({ timeout: 15_000 });
}

/** Extracts the Job Card number (e.g. "REC/MD/AUTO/JOB/0007") from free text. */
export function extractJobCardNumber(text: string): string {
  const match = text.match(/Job Card\s+(\S+)\s+is now Active/);
  if (!match) throw new Error(`Could not find Job Card number in text: ${text}`);
  return match[1];
}

/**
 * The Critical Workflow Popup (components/notifications/critical-workflow-popup.tsx)
 * is mounted globally for both roles and pops up automatically — covering
 * the whole screen with its own backdrop — whenever the logged-in user has
 * an unread role-to-role Job Card event (per lib/notifications/critical-popup.ts:
 * "Job Card Closed" / "Job Card Updated" for Data Entry, "Closure Approval
 * Needed" / "New Active Job Card" for Manager). Real pre-existing dev-DB job
 * cards plus this suite's own actions on either role can each trigger one,
 * arriving at any point via the SSE-driven notification poll (~15s, per
 * CLAUDE.md) — not just right after login. Registers a Playwright locator
 * handler so it's transparently dismissed before ANY subsequent action,
 * anywhere in the test, without every click needing its own retry logic.
 */
export async function installCriticalPopupHandler(page: Page) {
  // Matched by visible "Dismiss" text (not accessible name/role) inside a
  // dialog — deliberately NOT scoped to a specific title allowlist, since
  // more event rules can be added over time (see critical-popup.ts). This
  // is still safe/specific: (1) a toast's icon-only close button carries
  // aria-label="Dismiss" with no visible rendered text, so getByText never
  // matches it (ruling out the toast false-positive that broke an earlier
  // version of this handler), and (2) no other modal in this app (Closure
  // Requests, Closure Review, Closed Job Cards, the New Job Card wizard,
  // Request Closure, Issue/Receive Material) renders a button whose visible
  // text is literally "Dismiss" — this component is the only one that does.
  const dismissText = page.getByRole("dialog").getByText("Dismiss", { exact: true });
  await page.addLocatorHandler(dismissText, async () => {
    await dismissText.click();
  });
}
