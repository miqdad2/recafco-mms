/**
 * GET /api/health
 *
 * Lightweight application health check.
 * Used by Uptime Kuma, load balancers, and automated monitoring.
 * No authentication required — returns only safe, non-sensitive status data.
 *
 * HTTP 200  → system operational
 * HTTP 503  → database unreachable (app is up but degraded)
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

// Force dynamic so Next.js never caches this route.
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const startMs = Date.now();

  let dbStatus: "connected" | "error" = "error";


  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "connected";
  } catch {
    console.error("MMS health check: database unavailable");
  }

  const responseTimeMs = Date.now() - startMs;
  const appStatus = dbStatus === "connected" ? "ok" : "degraded";
  const httpStatus = dbStatus === "connected" ? 200 : 503;

  return NextResponse.json(
    {
      status: appStatus,
      database: dbStatus,

      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV ?? "unknown",
      responseTimeMs,
      version: "0.1.0"
    },
    { status: httpStatus, headers: { "Cache-Control": "no-store" } }
  );
}
