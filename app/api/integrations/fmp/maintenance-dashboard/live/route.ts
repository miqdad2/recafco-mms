/**
 * GET /api/integrations/fmp/maintenance-dashboard/live
 *
 * MMS-FMP-INTEGRATION-01: read-only live Maintenance dashboard summary for
 * the separate Factory Management Platform (FMP). Server-to-server only:
 * requires the `x-fmp-integration-key` header to match FMP_INTEGRATION_KEY.
 * No MMS session, no writes, no audit-log rows, no notifications.
 *
 * Query: ?userEmail=<email> (optional) — fills summary.assignedToMe.
 * FMP-MAINT-04: also returns the executive-summary sections (jobCards,
 * materialsRequests, inventory, assets, vehicleCompliance, labor,
 * managerAttention, links) — additive; each is null if unavailable.
 *
 * HTTP 200 → live dashboard payload
 * HTTP 400 → invalid userEmail
 * HTTP 401 → missing key, 403 → invalid key
 * HTTP 503 → FMP_INTEGRATION_KEY not configured on this server
 * HTTP 500 → query failed (safe message only)
 */

import { getAppUrl } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { getConfiguredFmpIntegrationKey } from "@/lib/integrations/fmp/auth";
import { createShortTtlCache } from "@/lib/integrations/fmp/live-cache";
import { handleFmpLiveDashboardRequest } from "@/lib/integrations/fmp/live-dashboard-handler";
import { buildFmpLiveDashboard, type FmpLiveDashboard } from "@/lib/integrations/fmp/executive-summary";
import { getOfflineInventoryBalance } from "@/lib/store/offline-inventory-data";

// Never statically rendered or cached by Next.js — every request is live.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_TTL_SECONDS = 10;
const cache = createShortTtlCache<FmpLiveDashboard>(CACHE_TTL_SECONDS * 1000);

// Base for each item's openUrl. MMS_PUBLIC_BASE_URL is read at runtime (e.g.
// http://192.168.1.17:81); NEXT_PUBLIC_APP_URL is inlined at build time.
function mmsBaseUrl(): string {
  return process.env.MMS_PUBLIC_BASE_URL?.trim() || getAppUrl();
}

// Cost figures (labor cost, stock/received/issued value) are sent to FMP
// unless FMP_INTEGRATION_INCLUDE_COSTS=false — the integration's equivalent
// of canViewCosts(), since there is no MMS user behind this request.
function includeCosts(): boolean {
  return process.env.FMP_INTEGRATION_INCLUDE_COSTS?.trim().toLowerCase() !== "false";
}

// console only — a DB-backed error log row per failed poll would turn an
// outage into a write storm at FMP's 15–30s polling rate.
function logError(message: string, error: unknown): void {
  console.error(message, error instanceof Error ? error.message : "Unknown error");
}

export async function GET(request: Request): Promise<Response> {
  return handleFmpLiveDashboardRequest(request, {
    getConfiguredKey: getConfiguredFmpIntegrationKey,
    loadDashboard: ({ userEmail }) =>
      cache.get(userEmail ?? "", () =>
        buildFmpLiveDashboard(prisma, {
          baseUrl: mmsBaseUrl(),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          userEmail,
          includeCosts: includeCosts(),
          loadInventoryBalance: getOfflineInventoryBalance,
          logError,
        })
      ),
    logError,
  });
}
