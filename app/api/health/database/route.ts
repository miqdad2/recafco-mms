/**
 * GET /api/health/database
 *
 * Detailed PostgreSQL health check.
 * Returns database size, public table count, and connection latency.
 * No authentication required — returns only aggregate structural metadata.
 *
 * HTTP 200 → database reachable
 * HTTP 503 → database unreachable
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type DbSizeRow = { size: string };
type TableCountRow = { count: bigint };
type VersionRow = { version: string };

export async function GET(): Promise<NextResponse> {
  const startMs = Date.now();

  try {
    const [sizeRows, tableRows, versionRows] = await Promise.all([
      prisma.$queryRaw<DbSizeRow[]>`
        SELECT pg_size_pretty(pg_database_size(current_database())) AS size
      `,
      prisma.$queryRaw<TableCountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
      `,
      prisma.$queryRaw<VersionRow[]>`
        SELECT current_setting('server_version') AS version
      `
    ]);

    const responseTimeMs = Date.now() - startMs;

    return NextResponse.json({
      status: "connected",
      responseTimeMs,
      databaseSize: sizeRows[0]?.size ?? "unknown",
      tableCount: Number(tableRows[0]?.count ?? 0),
      postgresVersion: versionRows[0]?.version ?? "unknown",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Database connection failed",
        responseTimeMs: Date.now() - startMs,
        timestamp: new Date().toISOString()
      },
      { status: 503 }
    );
  }
}
