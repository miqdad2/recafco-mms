/**
 * Safe database connection check.
 *
 * Reads DATABASE_URL from the environment, runs a single read-only
 * SELECT 1 through the Prisma client, and exits with code 0 on success
 * or code 1 on failure.  Nothing is written or modified.
 *
 * Usage:
 *   npm run db:check
 */

import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL;

if (!url) {
  console.error("[db:check] ERROR: DATABASE_URL is not set in the environment.");
  console.error("          Create a .env file and set DATABASE_URL=postgresql://...");
  process.exit(1);
}

// Redact password from display for safety.
let displayUrl = url;
try {
  const parsed = new URL(url);
  if (parsed.password) parsed.password = "***";
  displayUrl = parsed.toString();
} catch {
  displayUrl = url.replace(/:([^:@]+)@/, ":***@");
}

console.log(`[db:check] Connecting to: ${displayUrl}`);

const prisma = new PrismaClient({
  log: ["error"]
});

try {
  const rows = await prisma.$queryRaw`SELECT 1 AS ping`;
  const ping = rows[0]?.ping;

  if (Number(ping) === 1) {
    console.log("[db:check] PostgreSQL connection OK.");
  } else {
    console.error("[db:check] Unexpected response from database:", rows);
    process.exit(1);
  }
} catch (error) {
  console.error("[db:check] Connection FAILED:", error.message);
  console.error("");
  console.error("Possible causes:");
  console.error("  1. PostgreSQL is not running — start the service.");
  console.error("  2. DATABASE_URL credentials are incorrect.");
  console.error("  3. The database does not exist yet.");
  console.error("");
  console.error("Run:  npm run predev   (starts PostgreSQL service on Windows)");
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
