// MMS-FMP-INTEGRATION-01 unit tests — run with `npm run test:unit`.
// No database: the dashboard builder receives a fake read-only client that
// records every call and throws on any write or non-whitelisted model, so
// "no write / no audit-log / no notification side effects" is enforced by
// the test itself, not just by code review.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkFmpIntegrationKey } from "@/lib/integrations/fmp/auth";
import { createShortTtlCache } from "@/lib/integrations/fmp/live-cache";
import { handleFmpLiveDashboardRequest } from "@/lib/integrations/fmp/live-dashboard-handler";
import {
  attentionReasons,
  buildFmpMaintenanceDashboard,
  buildOpenUrl,
  mapNeedsAttention,
  mapRecentRequest,
  type FmpDashboardDb,
  type FmpMaintenanceDashboard,
  type FmpWorkOrderRow,
} from "@/lib/integrations/fmp/maintenance-dashboard";

const KEY = "k".repeat(40);
const BASE_URL = "http://192.168.1.17:81";
const NOW = new Date("2026-10-15T09:00:00.000Z");
const ENDPOINT = "http://mms.local/api/integrations/fmp/maintenance-dashboard/live";

function row(overrides: Partial<FmpWorkOrderRow> = {}): FmpWorkOrderRow {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    work_order_number: "REC/MD/AUTO/JOB/0001",
    status: "In Progress",
    priority: "Normal",
    operator_complaint: "Engine overheating",
    description_of_work: null,
    maintenance_type: "Corrective",
    job_location: "Workshop A",
    plate_number: null,
    starting_datetime: null,
    updated_at: new Date("2026-10-14T08:00:00.000Z"),
    assigned_supervisor_id: null,
    assets: { asset_code: "AST-VEH-0043", asset_name: "Ford" },
    profiles: null,
    work_order_assignments: [],
    work_order_worker_assignments: [{ worker_profiles: { name: "worker1" } }],
    ...overrides,
  };
}

// ── Fake read-only DB ─────────────────────────────────────────────────────────

type Call = { model: string; method: string; args: unknown };

function fakeDb(opts: {
  counts?: number[];
  attention?: FmpWorkOrderRow[];
  recent?: FmpWorkOrderRow[];
  authUser?: { profile_id: string } | null;
}) {
  const calls: Call[] = [];
  const forbidden: Call[] = [];
  const counts = [...(opts.counts ?? [])];
  let findManyCalls = 0;

  const allowed: Record<string, Record<string, (args: unknown) => Promise<unknown>>> = {
    work_orders: {
      count: async () => counts.shift() ?? 0,
      findMany: async () => (findManyCalls++ === 0 ? opts.attention ?? [] : opts.recent ?? []),
    },
    auth_users: {
      findFirst: async () => opts.authUser ?? null,
    },
  };

  const db = new Proxy(
    {},
    {
      get(_t, model: string) {
        return new Proxy(
          {},
          {
            get(_m, method: string) {
              return (args: unknown) => {
                const call = { model, method, args };
                const impl = allowed[model]?.[method];
                if (!impl) {
                  forbidden.push(call);
                  throw new Error(`forbidden db access: ${model}.${method}`);
                }
                calls.push(call);
                return impl(args);
              };
            },
          }
        );
      },
    }
  ) as unknown as FmpDashboardDb;

  return { db, calls, forbidden };
}

function sampleDashboard(): FmpMaintenanceDashboard {
  return {
    source: "MMS_LIVE",
    online: true,
    generatedAt: NOW.toISOString(),
    cacheTtlSeconds: 10,
    summary: { openRequests: 1, inProgress: 1, waitingForParts: 0, overdue: 0, assignedToMe: null, completedThisMonth: 0 },
    needsAttention: [],
    recentRequests: [],
  };
}

function request(headers: Record<string, string> = {}, query = ""): Request {
  return new Request(`${ENDPOINT}${query}`, { headers });
}

// ── Integration key ───────────────────────────────────────────────────────────

describe("integration key", () => {
  it("rejects a missing key with 401 and never loads data", async () => {
    let loads = 0;
    const res = await handleFmpLiveDashboardRequest(request(), {
      getConfiguredKey: () => KEY,
      loadDashboard: async () => (loads++, sampleDashboard()),
    });
    assert.equal(res.status, 401);
    assert.equal(loads, 0);
    assert.deepEqual(await res.json(), { error: "Missing integration key." });
  });

  it("rejects an invalid key with 403 and never loads data", async () => {
    let loads = 0;
    const res = await handleFmpLiveDashboardRequest(request({ "x-fmp-integration-key": "wrong-key" }), {
      getConfiguredKey: () => KEY,
      loadDashboard: async () => (loads++, sampleDashboard()),
    });
    assert.equal(res.status, 403);
    assert.equal(loads, 0);
  });

  it("returns 503 when the server key is unset or too short", async () => {
    for (const configured of [null, "short-key"]) {
      const res = await handleFmpLiveDashboardRequest(request({ "x-fmp-integration-key": "short-key" }), {
        getConfiguredKey: () => configured,
        loadDashboard: async () => sampleDashboard(),
      });
      assert.equal(res.status, 503);
    }
  });

  it("compares keys exactly", () => {
    assert.equal(checkFmpIntegrationKey(KEY, KEY), "ok");
    assert.equal(checkFmpIntegrationKey(` ${KEY} `, KEY), "ok");
    assert.equal(checkFmpIntegrationKey(`${KEY}x`, KEY), "invalid");
    assert.equal(checkFmpIntegrationKey(KEY.toUpperCase(), KEY), "invalid");
    assert.equal(checkFmpIntegrationKey("", KEY), "missing");
  });
});

// ── Handler response ─────────────────────────────────────────────────────────

describe("live endpoint handler", () => {
  it("returns the live-shaped payload with no-store caching headers", async () => {
    const res = await handleFmpLiveDashboardRequest(request({ "x-fmp-integration-key": KEY }), {
      getConfiguredKey: () => KEY,
      loadDashboard: async () => sampleDashboard(),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    const body = await res.json();
    assert.equal(body.source, "MMS_LIVE");
    assert.equal(body.online, true);
    assert.equal(typeof body.generatedAt, "string");
    assert.equal(body.cacheTtlSeconds, 10);
  });

  it("passes a normalized userEmail and rejects a malformed one", async () => {
    let seen: string | null | undefined;
    const ok = await handleFmpLiveDashboardRequest(
      request({ "x-fmp-integration-key": KEY }, "?userEmail=%20Manager1@Recafco.com%20"),
      { getConfiguredKey: () => KEY, loadDashboard: async ({ userEmail }) => ((seen = userEmail), sampleDashboard()) }
    );
    assert.equal(ok.status, 200);
    assert.equal(seen, "manager1@recafco.com");

    const bad = await handleFmpLiveDashboardRequest(request({ "x-fmp-integration-key": KEY }, "?userEmail=not-an-email"), {
      getConfiguredKey: () => KEY,
      loadDashboard: async () => sampleDashboard(),
    });
    assert.equal(bad.status, 400);
  });

  it("hides internal error details on failure", async () => {
    const logged: unknown[] = [];
    const res = await handleFmpLiveDashboardRequest(request({ "x-fmp-integration-key": KEY }), {
      getConfiguredKey: () => KEY,
      loadDashboard: async () => {
        throw new Error("connect ECONNREFUSED postgresql://admin:secret@db:5432");
      },
      logError: (_m, e) => logged.push(e),
    });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /secret|postgresql|ECONNREFUSED|stack/i);
    assert.deepEqual(JSON.parse(text), {
      source: "MMS_LIVE",
      online: false,
      error: "Maintenance dashboard is temporarily unavailable.",
    });
    assert.equal(logged.length, 1);
  });
});

// ── Dashboard builder: summary mapping + read-only guarantee ─────────────────

describe("buildFmpMaintenanceDashboard", () => {
  it("maps each summary count to its card and reads only", async () => {
    const { db, calls, forbidden } = fakeDb({ counts: [21, 4, 3, 2, 9, 5], authUser: { profile_id: "p-1" } });
    const result = await buildFmpMaintenanceDashboard(db, {
      baseUrl: BASE_URL,
      cacheTtlSeconds: 10,
      userEmail: "manager1@recafco.com",
      now: NOW,
    });

    assert.deepEqual(result.summary, {
      openRequests: 21,
      inProgress: 4,
      waitingForParts: 3,
      overdue: 2,
      completedThisMonth: 9,
      assignedToMe: 5,
    });
    assert.equal(result.source, "MMS_LIVE");
    assert.equal(result.generatedAt, NOW.toISOString());

    const countWheres = calls.filter((c) => c.method === "count").map((c) => JSON.stringify(c.args));
    assert.match(countWheres[0], /"notIn":\["Created","Draft","Closed","Cancelled","Rejected"\]/);
    assert.match(countWheres[1], /"status":"In Progress"/);
    assert.match(countWheres[2], /"Waiting Materials","Partially Issued"/);
    assert.match(countWheres[3], /"starting_datetime":\{"lt":"2026-10-15T09:00:00.000Z"\}/);
    assert.match(countWheres[4], /"status":"Closed".*"updated_at":\{"gte"/);
    assert.match(countWheres[5], /"technician_id":"p-1".*"assigned_supervisor_id":"p-1"/);
    for (const where of countWheres) assert.match(where, /"deleted_at":null/);

    assert.deepEqual(forbidden, []);
    assert.ok(calls.every((c) => ["count", "findMany", "findFirst"].includes(c.method)));
    assert.ok(calls.every((c) => c.model === "work_orders" || c.model === "auth_users"));
  });

  it("returns assignedToMe null without an email and 0 for an unknown email", async () => {
    const none = await buildFmpMaintenanceDashboard(fakeDb({}).db, {
      baseUrl: BASE_URL, cacheTtlSeconds: 10, userEmail: null, now: NOW,
    });
    assert.equal(none.summary.assignedToMe, null);

    const unknown = await buildFmpMaintenanceDashboard(fakeDb({ authUser: null }).db, {
      baseUrl: BASE_URL, cacheTtlSeconds: 10, userEmail: "nobody@recafco.com", now: NOW,
    });
    assert.equal(unknown.summary.assignedToMe, 0);
  });

  it("limits recent requests to 10 non-draft rows ordered newest first", async () => {
    const { db, calls } = fakeDb({});
    await buildFmpMaintenanceDashboard(db, { baseUrl: BASE_URL, cacheTtlSeconds: 10, userEmail: null, now: NOW });
    const [attentionQuery, recentQuery] = calls.filter((c) => c.method === "findMany").map((c) => c.args as Record<string, unknown>);
    assert.equal(recentQuery.take, 10);
    assert.deepEqual(recentQuery.orderBy, { created_at: "desc" });
    assert.match(JSON.stringify(recentQuery.where), /"notIn":\["Created","Draft"\]/);
    assert.equal(attentionQuery.take, 100);
    // No cost columns are ever selected.
    assert.doesNotMatch(JSON.stringify(recentQuery.select), /cost|rate|password|hash/i);
  });
});

// ── Recent Requests mapping ──────────────────────────────────────────────────

describe("recent request mapping", () => {
  it("maps a job card to the FMP recent-request shape", () => {
    const item = mapRecentRequest(row(), `${BASE_URL}/`);
    assert.deepEqual(item, {
      id: "11111111-2222-3333-4444-555555555555",
      ref: "REC/MD/AUTO/JOB/0001",
      title: "Engine overheating",
      assetOrLocation: "AST-VEH-0043 — Ford",
      status: "In Progress",
      statusLabel: "Active",
      priority: "Normal",
      assignedTo: "worker1",
      updatedAt: "2026-10-14T08:00:00.000Z",
      openUrl: "http://192.168.1.17:81/maintenance/work-orders/11111111-2222-3333-4444-555555555555",
    });
  });

  it("falls back sensibly when optional fields are missing", () => {
    const item = mapRecentRequest(
      row({
        work_order_number: null,
        operator_complaint: "  ",
        description_of_work: null,
        assets: null,
        job_location: null,
        plate_number: "11546",
        work_order_worker_assignments: [],
        work_order_assignments: [
          { assignment_type: "EXTERNAL_COMPANY", external_name: null, external_company: "ACME Repairs", profiles: null },
        ],
        status: "Closure Requested",
      }),
      BASE_URL
    );
    assert.equal(item.ref, "JC-11111111");
    assert.equal(item.title, "Corrective");
    assert.equal(item.assetOrLocation, "11546");
    assert.equal(item.assignedTo, "ACME Repairs");
    assert.equal(item.statusLabel, "Closure Requested");
  });

  it("builds the MMS detail URL", () => {
    assert.equal(buildOpenUrl("http://192.168.1.17:81//", "abc"), "http://192.168.1.17:81/maintenance/work-orders/abc");
  });
});

// ── Needs Attention mapping ──────────────────────────────────────────────────

describe("needs attention mapping", () => {
  it("derives every reason from current record state", () => {
    assert.deepEqual(
      attentionReasons(row({ status: "Waiting Materials", priority: "Urgent", starting_datetime: new Date("2026-10-01T00:00:00Z"), work_order_worker_assignments: [] }), NOW),
      ["Overdue", "Urgent priority", "Waiting for parts", "Unassigned"]
    );
    assert.deepEqual(attentionReasons(row({ status: "Closure Requested", priority: "High" }), NOW), [
      "High priority",
      "Closure request pending",
    ]);
    // Future start date is not overdue; assigned + normal priority → nothing.
    assert.deepEqual(attentionReasons(row({ starting_datetime: new Date("2026-11-01T00:00:00Z") }), NOW), []);
    // Supervisor-only assignment still counts as assigned.
    assert.deepEqual(
      attentionReasons(row({ status: "Approved", work_order_worker_assignments: [], assigned_supervisor_id: "sup-1" }), NOW),
      []
    );
  });

  it("ranks by severity, drops rows with no reason, and caps the list", () => {
    const rows = [
      row({ id: "normal" }),
      row({ id: "unassigned", status: "Approved", work_order_worker_assignments: [] }),
      row({ id: "overdue", starting_datetime: new Date("2026-10-01T00:00:00Z") }),
      row({ id: "high", priority: "High" }),
    ];
    const items = mapNeedsAttention(rows, NOW, BASE_URL);
    assert.deepEqual(items.map((i) => i.id), ["overdue", "high", "unassigned"]);
    assert.deepEqual(items[0].reasons, ["Overdue"]);
    assert.equal(items[0].openUrl, `${BASE_URL}/maintenance/work-orders/overdue`);

    const many = Array.from({ length: 25 }, (_, i) => row({ id: `r${i}`, priority: "Urgent" }));
    assert.equal(mapNeedsAttention(many, NOW, BASE_URL).length, 10);
  });
});

// ── Short cache ──────────────────────────────────────────────────────────────

describe("short TTL cache", () => {
  it("reuses a value only within the TTL and shares in-flight loads", async () => {
    let now = 0;
    let loads = 0;
    const cache = createShortTtlCache<number>(10_000, 50, () => now);
    const load = async () => ++loads;

    const [a, b] = await Promise.all([cache.get("", load), cache.get("", load)]);
    assert.equal(a, 1);
    assert.equal(b, 1);
    now = 9_999;
    assert.equal(await cache.get("", load), 1);
    now = 10_001;
    assert.equal(await cache.get("", load), 2);
    assert.equal(loads, 2);
  });

  it("never caches failures", async () => {
    const cache = createShortTtlCache<number>(10_000);
    await assert.rejects(cache.get("", async () => { throw new Error("db down"); }));
    assert.equal(await cache.get("", async () => 7), 7);
  });
});
