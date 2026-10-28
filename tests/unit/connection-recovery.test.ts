// Database connection recovery — which failures are retried, and how far.
// Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IDLE_CONNECTION_LIFETIME_SECONDS,
  isConnectionLost,
  isReadOnlySql,
  runInTransactionScope,
  withConnectionLifetime,
  withConnectionRecovery,
} from "@/lib/db/connection-recovery";

const lost = () => Object.assign(new Error("Invalid `prisma.$queryRaw()` invocation:\nServer has closed the connection."), { code: "P1017" });
const noSleep = async () => undefined;

describe("isConnectionLost", () => {
  it("recognises a closed / terminated / unreachable connection", () => {
    assert.equal(isConnectionLost(lost()), true);
    assert.equal(isConnectionLost(new Error("FATAL: terminating connection due to administrator command (E57P01)")), true);
    assert.equal(isConnectionLost(new Error("Can't reach database server at localhost:5432")), true);
  });
  it("does not treat data or lock problems as a lost connection", () => {
    assert.equal(isConnectionLost(Object.assign(new Error("Unique constraint failed"), { code: "P2002" })), false);
    assert.equal(isConnectionLost(new Error("deadlock detected")), false);
    assert.equal(isConnectionLost(Object.assign(new Error("Transaction already closed"), { code: "P2028" })), false);
  });
});

describe("withConnectionLifetime", () => {
  it("adds the idle lifetime, keeping everything else", () => {
    const url = new URL(withConnectionLifetime("postgresql://u:p%40ss@localhost:5432/db?schema=public")!);
    assert.equal(url.searchParams.get("max_idle_connection_lifetime"), String(IDLE_CONNECTION_LIFETIME_SECONDS));
    assert.equal(url.searchParams.get("schema"), "public");
    assert.equal(url.password, "p%40ss");
    assert.equal(url.pathname, "/db");
  });
  it("never overrides an operator's own setting, and leaves a missing URL alone", () => {
    assert.match(withConnectionLifetime("postgresql://localhost/db?max_idle_connection_lifetime=60")!, /max_idle_connection_lifetime=60$/);
    assert.equal(withConnectionLifetime(undefined), undefined);
  });
});

describe("withConnectionRecovery", () => {
  it("default: a quick retry, then waits past the idle lifetime (dead connection replaced)", async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await withConnectionRecovery(async () => (++calls <= 2 ? Promise.reject(lost()) : "ok"), {
      sleep: async (ms) => { waits.push(ms); },
    });
    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.equal(waits[0] < 1000, true);
    assert.equal(waits[1] > IDLE_CONNECTION_LIFETIME_SECONDS * 1000, true);
  });
  it("is bounded: at most one try per configured delay plus the first", async () => {
    let calls = 0;
    await assert.rejects(withConnectionRecovery(async () => { calls++; throw lost(); }, { sleep: noSleep }), /closed the connection/);
    assert.equal(calls, 4);
  });
  it("never retries other errors", async () => {
    let calls = 0;
    await assert.rejects(withConnectionRecovery(async () => { calls++; throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" }); }, { sleep: noSleep }));
    assert.equal(calls, 1);
  });
  it("stops as soon as canRetry says the work has started (uncertain write)", async () => {
    let calls = 0;
    let started = false;
    await assert.rejects(withConnectionRecovery(async () => { calls++; started = true; throw lost(); }, { canRetry: () => !started, sleep: noSleep }));
    assert.equal(calls, 1);
  });
  it("never retries inside a transaction", async () => {
    let calls = 0;
    await assert.rejects(runInTransactionScope(() => withConnectionRecovery(async () => { calls++; throw lost(); }, { sleep: noSleep })));
    assert.equal(calls, 1);
  });
});

describe("isReadOnlySql", () => {
  it("accepts plain reads", () => {
    assert.equal(isReadOnlySql("select au.id from public.auth_sessions s where s.expires_at > now() limit 1"), true);
    assert.equal(isReadOnlySql("  -- note\n WITH x AS (select 1) SELECT * FROM x"), true);
    assert.equal(isReadOnlySql("select updated_at, last_update_by from t"), true);
  });
  it("rejects writes, locks and side-effecting functions", () => {
    for (const sql of [
      "update work_orders set status = 'Closed'",
      "insert into t values (1)",
      "with d as (delete from t returning *) select * from d",
      "select * from parts_requests where id = $1 for update",
      "select set_config('app.current_profile_id', $1, true)",
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      "select nextval('wo_seq')",
      "",
    ]) {
      assert.equal(isReadOnlySql(sql), false, sql);
    }
  });
});
