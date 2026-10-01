import "server-only";

import { z } from "zod";

import { checkFmpIntegrationKey, FMP_INTEGRATION_KEY_HEADER } from "@/lib/integrations/fmp/auth";
import type { FmpMaintenanceDashboard } from "@/lib/integrations/fmp/maintenance-dashboard";

// MMS-FMP-INTEGRATION-01: transport layer for
// GET /api/integrations/fmp/maintenance-dashboard/live — key check, query
// validation, safe error mapping. Dependencies are injected so the auth and
// error paths are unit-testable without a database.

export type FmpLiveDashboardDeps = {
  getConfiguredKey: () => string | null;
  loadDashboard: (input: { userEmail: string | null }) => Promise<FmpMaintenanceDashboard>;
  logError?: (message: string, error: unknown) => void;
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

const emailSchema = z.string().trim().toLowerCase().email().max(320);

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE_HEADERS, ...extraHeaders } });
}

export async function handleFmpLiveDashboardRequest(request: Request, deps: FmpLiveDashboardDeps): Promise<Response> {
  const keyCheck = checkFmpIntegrationKey(request.headers.get(FMP_INTEGRATION_KEY_HEADER), deps.getConfiguredKey());

  if (keyCheck === "not_configured") {
    return json({ error: "FMP integration is not configured." }, 503);
  }
  if (keyCheck === "missing") {
    return json({ error: "Missing integration key." }, 401, { "WWW-Authenticate": FMP_INTEGRATION_KEY_HEADER });
  }
  if (keyCheck === "invalid") {
    return json({ error: "Invalid integration key." }, 403);
  }

  // Optional "Assigned To Me" mapping: FMP passes its signed-in user's email.
  const rawEmail = new URL(request.url).searchParams.get("userEmail");
  let userEmail: string | null = null;
  if (rawEmail !== null && rawEmail.trim() !== "") {
    const parsed = emailSchema.safeParse(rawEmail);
    if (!parsed.success) return json({ error: "Invalid userEmail parameter." }, 400);
    userEmail = parsed.data;
  }

  try {
    const dashboard = await deps.loadDashboard({ userEmail });
    return json(dashboard, 200);
  } catch (error) {
    deps.logError?.("[fmp-integration] live maintenance dashboard failed", error);
    return json({ source: "MMS_LIVE", online: false, error: "Maintenance dashboard is temporarily unavailable." }, 500);
  }
}
