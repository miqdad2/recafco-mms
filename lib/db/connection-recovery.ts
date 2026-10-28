// Database connection recovery — bounded retry for work that provably never
// reached the database.
//
// When PostgreSQL restarts (or terminates sessions), the connections Prisma
// keeps in its pool are dead. Measured on a disposable database: Prisma does
// NOT drop a dead connection when a query fails on it — it hands the same
// one out again (20 retries in 3 s all failed on it) and recovery took an
// unpredictable ~20+ failed requests. What does work: with
// max_idle_connection_lifetime set, a connection idle longer than that is
// discarded when it is next handed out, so a retry made after waiting just
// over that lifetime always gets a fresh connection.
//
// So: the database URL gets max_idle_connection_lifetime (unless the
// operator already set it), and these helpers retry ONLY
//   - reads outside a transaction (they change nothing), and
//   - transactions whose own work had not started yet (nothing was sent),
// first quickly, then once more after the idle lifetime. A write whose
// outcome is uncertain is never retried here; it fails as before and the
// caller's own safeguards apply (Job Card submission id, closure status
// checks).
//
// Plain module (no "server-only") so unit tests can import it.

import { AsyncLocalStorage } from "node:async_hooks";

/** Pooled connections idle longer than this are replaced when next used. */
export const IDLE_CONNECTION_LIFETIME_SECONDS = 10;

/** Adds max_idle_connection_lifetime to the database URL unless already set. */
export function withConnectionLifetime(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) return databaseUrl;
  try {
    const url = new URL(databaseUrl);
    if (!url.searchParams.has("max_idle_connection_lifetime")) {
      url.searchParams.set("max_idle_connection_lifetime", String(IDLE_CONNECTION_LIFETIME_SECONDS));
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

const LOST_CONNECTION_CODES = new Set(["P1001", "P1017"]);
const LOST_CONNECTION_TEXT =
  /Server has closed the connection|terminating connection due to administrator command|\bE?57P01\b|ConnectionReset|connection reset|forcibly closed by the remote host|Can't reach database server|Connection terminated unexpectedly/i;

/** True when the error means the connection was lost (not a query or data problem). */
export function isConnectionLost(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && LOST_CONNECTION_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return LOST_CONNECTION_TEXT.test(message);
}

// Set while withBackendTransaction runs its operation: a lost connection
// inside a transaction cannot be recovered by retrying a single query.
const transactionScope = new AsyncLocalStorage<true>();

export function runInTransactionScope<T>(run: () => Promise<T>): Promise<T> {
  return transactionScope.run(true, run);
}

export function isInsideTransaction(): boolean {
  return transactionScope.getStore() === true;
}

const LIFETIME_WAIT_MS = IDLE_CONNECTION_LIFETIME_SECONDS * 1000 + 500;

export type RecoveryOptions = {
  /** Wait before each retry; the number of entries is the number of retries. */
  retryDelaysMs?: number[];
  /** Extra condition checked before each retry (e.g. "the work had not started"). */
  canRetry?: () => boolean;
  /** Called before each retry; for tests and logging. */
  onRetry?: (attempt: number, error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Runs `run`, retrying while it fails because the connection was lost: a
 * quick retry, then after the idle lifetime (so the dead connection is
 * replaced), at most `retryDelaysMs.length` times. Never retries inside a
 * transaction, or when `canRetry` says no. Any other error, or running out
 * of retries, is thrown unchanged.
 */
export async function withConnectionRecovery<T>(run: () => Promise<T>, options: RecoveryOptions = {}): Promise<T> {
  const delays = options.retryDelaysMs ?? [50, LIFETIME_WAIT_MS, LIFETIME_WAIT_MS];
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const retry =
        isConnectionLost(error) &&
        attempt <= delays.length &&
        !isInsideTransaction() &&
        (options.canRetry?.() ?? true);
      if (!retry) throw error;
      options.onRetry?.(attempt, error);
      await sleep(delays[attempt - 1]);
    }
  }
}

/** Model operations that only read. */
export const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * True for a raw query that only reads: a plain SELECT / WITH … SELECT
 * without locking or data-changing keywords. Anything else is treated as a
 * possible write and never retried.
 */
export function isReadOnlySql(sql: string): boolean {
  const text = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (!/^(select|with)\b/i.test(text)) return false;
  return !/\b(insert|update|delete|merge|truncate|alter|create|drop|grant|for\s+(no\s+key\s+)?update|for\s+share|nextval|setval|set_config|pg_advisory\w*|pg_terminate_backend)\b/i.test(text);
}
