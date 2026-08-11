import { expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

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
  // Not "Hello, {name}" — components/dashboard/live-dashboard-header.tsx
  // (Unit 10G.18, unrelated to this suite) replaced that static greeting
  // with a time-of-day one ("Good morning/afternoon/evening") that types
  // itself out character-by-character, so matching its exact text is racy.
  // The header's subtitle is static and never animates.
  await expect(page.getByText("Here's what needs your attention today.")).toBeVisible({ timeout: 15_000 });
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

/**
 * Unit 10G.14 — seeds a fresh, uniquely-named "existing stock" Offline
 * Inventory material via a direct OPENING_STOCK movement (same shape
 * scripts/e2e-unit10-run.mjs already uses for its own test fixtures),
 * bypassing the UI so the mixed-material E2E scenario has a deterministic
 * starting balance regardless of what other test runs have done to shared
 * fixtures like "engine filter". Material names used here MUST start with
 * "E2E-MMS-" — scripts/e2e-mms-cleanup.mjs only deletes movements matching
 * that prefix.
 */
export async function seedOpeningStock(materialName: string, quantity: number, unit = "PCS") {
  if (!materialName.startsWith("E2E-MMS-")) {
    throw new Error(`seedOpeningStock: material name must start with "E2E-MMS-" so cleanup can find it (got "${materialName}")`);
  }
  const prisma = new PrismaClient();
  try {
    const dataEntryUser = await prisma.auth_users.findUnique({ where: { email: DATA_ENTRY.email }, select: { profile_id: true } });
    if (!dataEntryUser) throw new Error(`seedOpeningStock: ${DATA_ENTRY.email} not found`);
    await prisma.offline_inventory_movements.create({
      data: {
        movement_type: "OPENING_STOCK",
        movement_date: new Date(),
        manual_material_name: materialName,
        category: "Other",
        quantity,
        unit,
        created_by: dataEntryUser.profile_id,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/** Current Offline Inventory balance for a manual (non-catalog) material identity. */
export async function getOfflineInventoryBalance(materialName: string, unit = "PCS"): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const movements = await prisma.offline_inventory_movements.findMany({
      where: { manual_material_name: { equals: materialName, mode: "insensitive" }, unit: { equals: unit, mode: "insensitive" } },
      select: { movement_type: true, quantity: true },
    });
    return movements.reduce(
      (sum, m) => sum + (m.movement_type === "ISSUED" ? -Number(m.quantity) : Number(m.quantity)),
      0
    );
  } finally {
    await prisma.$disconnect();
  }
}
