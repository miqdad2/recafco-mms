/**
 * GET /api/integrations/fmp/maintenance-dashboard/live
 *
 * MMS-FMP-INTEGRATION-01: read-only live Maintenance dashboard summary for
 * the separate Factory Management Platform (FMP). Server-to-server only:
 * requires the `x-fmp-integration-key` header to match FMP_INTEGRATION_KEY.
 * No MMS session, no writes, no audit-log rows, no notifications.
 *
 * Query: ?userEmail=<email> (optional) — fills summary.assignedToMe.
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
import {
  buildFmpMaintenanceDashboard,
  type FmpMaintenanceDashboard,
} from "@/lib/integrations/fmp/maintenance-dashboard";

// Never statically rendered or cached by Next.js — every request is live.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_TTL_SECONDS = 10;
const cache = createShortTtlCache<FmpMaintenanceDashboard>(CACHE_TTL_SECONDS * 1000);

// Base for each item's openUrl. MMS_PUBLIC_BASE_URL is read at runtime (e.g.
// http://192.168.1.17:81); NEXT_PUBLIC_APP_URL is inlined at build time.
function mmsBaseUrl(): string {
  return process.env.MMS_PUBLIC_BASE_URL?.trim() || getAppUrl();
}

export async function GET(request: Request): Promise<Response> {
  return handleFmpLiveDashboardRequest(request, {
    getConfiguredKey: getConfiguredFmpIntegrationKey,
    loadDashboard: ({ userEmail }) =>
      cache.get(userEmail ?? "", () =>
        buildFmpMaintenanceDashboard(prisma, {
          baseUrl: mmsBaseUrl(),
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          userEmail,
        })
      ),
    // console only — a DB-backed error log row per failed poll would turn
    // an outage into a write storm at FMP's 15–30s polling rate.
    logError: (message, error) =>
      console.error(message, error instanceof Error ? error.message : "Unknown error"),
  });
}
