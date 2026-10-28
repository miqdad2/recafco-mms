import "server-only";

import { PrismaClient } from "@prisma/client";

import { isReadOnlySql, READ_OPERATIONS, withConnectionLifetime, withConnectionRecovery } from "@/lib/db/connection-recovery";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function rawSqlText(args: unknown): string {
  const sql = args as { sql?: unknown; strings?: unknown } | null;
  if (typeof sql?.sql === "string") return sql.sql;
  if (Array.isArray(sql?.strings)) return sql.strings.join("?");
  return "";
}

// Reads (and read-only raw SELECTs) outside a transaction recover from
// connections PostgreSQL has closed — e.g. after a database restart — and
// idle pooled connections are replaced after a short lifetime so a retry
// gets a fresh one. Writes are never retried here; see
// lib/db/connection-recovery.ts. The extended client keeps the PrismaClient
// shape, so it is typed as one for every existing caller.
function createPrismaClient(): PrismaClient {
  const base = new PrismaClient({
    datasourceUrl: withConnectionLifetime(process.env.DATABASE_URL),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });
  return base.$extends({
    name: "connection-recovery",
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          return READ_OPERATIONS.has(operation) ? withConnectionRecovery(() => query(args)) : query(args);
        }
      },
      async $queryRaw({ args, query }) {
        return isReadOnlySql(rawSqlText(args)) ? withConnectionRecovery(() => query(args)) : query(args);
      }
    }
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
