// FMP-MAINT-04 unit tests — run with `npm run test:unit`.
// The builder gets a fake client that only answers read methods on an
// allow-list of models; anything else (a write, audit_logs, notifications)
// is recorded and throws.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFmpLiveDashboard,
  buildVehicleAlerts,
  pickAttentionItems,
  startOfWeek,
  summarizeOpenSessions,
  type FmpExecutiveDb,
  type FmpInventoryBalanceInput,
  type FmpManagerAttentionItem,
} from "@/lib/integrations/fmp/executive-summary";

const BASE_URL = "http://192.168.1.17:81";
const NOW = new Date();
const DAY = 86_400_000;

function dateOnly(offsetDays: number): Date {
  const d = new Date(NOW.getTime() + offsetDays * DAY);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

type Call = { model: string; method: string; args: unknown };
type Responder = (args: unknown) => unknown;

const READ_METHODS = ["count", "findMany", "findFirst", "groupBy"];

function fakeDb(responders: Record<string, Responder>) {
  const calls: Call[] = [];
  const forbidden: Call[] = [];
  const db = new Proxy(
    {},
    {
      get(_t, model: string) {
        return new Proxy(
          {},
          {
            get(_m, method: string) {
              return async (args: unknown) => {
                const call = { model, method, args };
                const responder = responders[`${model}.${method}`];
                if (!READ_METHODS.includes(method) || !responder) {
                  forbidden.push(call);
                  throw new Error(`forbidden db access: ${model}.${method}`);
                }
                calls.push(call);
                return responder(args);
              };
            },
          }
        );
      },
    }
  ) as unknown as FmpExecutiveDb;
  return { db, calls, forbidden };
}

const has = (args: unknown, text: string) => (JSON.stringify(args) ?? "").includes(text);

const INVENTORY: FmpInventoryBalanceInput = {
  balanceItems: [
    { display_name: "Engine filter", unit: "PCS", balance: 12, stock_status: "ok" },
    { display_name: "Brake pads", unit: "SET", balance: 0, stock_status: "out_of_stock" },
    { display_name: "Engine oil", unit: "LITER", balance: 1, stock_status: "low_stock" },
  ],
  balance: 13,
  totalStockValue: 250.5,
  lowStockCount: 2,
};

function responders(overrides: Record<string, Responder> = {}): Record<string, Responder> {
  return {
    "work_orders.count": (args) => {
      if (has(args, '"parts_requests"')) return 4; // materialsPending
      if (has(args, '"work_order_assignments":{"none"')) return 3; // unassigned
      if (has(args, '"status":"Closure Requested"')) return 2;
      if (has(args, '"status":"In Progress"')) return 5;
      if (has(args, '"status":"Closed"')) return 9;
      if (has(args, '"starting_datetime"')) return 1; // overdue
      if (has(args, '"Waiting Materials","Partially Issued","Waiting for Parts"')) return 6; // waiting for parts
      if (has(args, '"notIn"')) return 20; // open
      if (has(args, '"status":{"in":["Approved"')) return 14; // active
      return 40; // total
    },
    "work_orders.findMany": () => [],
    "auth_users.findFirst": () => null,
    "parts_requests.count": (args) => (has(args, '"Issued"') ? 7 : has(args, '"Requested"') ? 3 : 11),
    "general_inventory_requests.count": (args) => (has(args, "Pending") ? 1 : has(args, "Completed") ? 4 : 5),
    "assets.count": () => 8,
    "assets.groupBy": () => [
      { category: "Generator", _count: { _all: 25 } },
      { category: "Car", _count: { _all: 42 } },
    ],
    "assets.findMany": () => [
      {
        id: "veh-1", asset_code: "AST-CAR-0009", asset_name: "Pajero", plate_number: "11546",
        insurance_expiry_date: dateOnly(-3), registration_expiry_date: dateOnly(10),
      },
      {
        id: "veh-2", asset_code: "AST-BUS-0001", asset_name: "Bus", plate_number: null,
        insurance_expiry_date: dateOnly(200), registration_expiry_date: null,
      },
    ],
    "asset_movements.findMany": () => [
      { asset_id: "a1", to_location: "Site A", sent_date: dateOnly(-20), expected_return_date: dateOnly(-5) },
      { asset_id: "a2", to_location: "Site B", sent_date: dateOnly(-2), expected_return_date: dateOnly(5) },
    ],
    "offline_inventory_movements.findMany": () => [
      { movement_type: "RECEIVED", quantity: 2, unit_cost: null, total_cost: 30 },
      { movement_type: "ISSUED", quantity: 4, unit_cost: 2.5, total_cost: null },
      { movement_type: "ISSUED", quantity: 1, unit_cost: null, total_cost: null },
    ],
    "workOrderWorkSession.findMany": (args) =>
      has(args, '"Active","Paused"')
        ? [
            { work_order_id: "wo1", worker_id: "w1", status: "Active" },
            { work_order_id: "wo1", worker_id: "w2", status: "Paused" },
            { work_order_id: "wo2", worker_id: "w3", status: "Paused" },
          ]
        : [
            { started_at: new Date(NOW.getTime()), duration_minutes: 90, calculated_amount: 3 },
            { started_at: startOfWeek(NOW), duration_minutes: 30, calculated_amount: 1 },
          ],
    ...overrides,
  };
}

function build(db: FmpExecutiveDb, extra: Partial<Parameters<typeof buildFmpLiveDashboard>[1]> = {}) {
  return buildFmpLiveDashboard(db, {
    baseUrl: BASE_URL,
    cacheTtlSeconds: 10,
    userEmail: null,
    includeCosts: true,
    loadInventoryBalance: async () => INVENTORY,
    now: NOW,
    ...extra,
  });
}

describe("buildFmpLiveDashboard", () => {
  it("keeps every existing field and adds the executive sections", async () => {
    const { db, forbidden, calls } = fakeDb(responders());
    const result = await build(db);

    // Backward compatibility — the MMS-FMP-INTEGRATION-01 shape is intact.
    assert.equal(result.source, "MMS_LIVE");
    assert.equal(result.online, true);
    assert.equal(result.cacheTtlSeconds, 10);
    assert.equal(typeof result.generatedAt, "string");
    assert.deepEqual(Object.keys(result.summary).sort(), [
      "assignedToMe", "completedThisMonth", "inProgress", "openRequests", "overdue", "waitingForParts",
    ]);
    assert.ok(Array.isArray(result.needsAttention));
    assert.ok(Array.isArray(result.recentRequests));

    assert.deepEqual(result.jobCards, {
      totalJobCards: 40, activeJobs: 14, inProgress: 5, closureRequests: 2, completedThisMonth: 9,
      paused: 1, workingNow: 1, openUrl: `${BASE_URL}/maintenance/work-orders`,
    });
    assert.deepEqual(result.materialsRequests, {
      totalMaterialsRequests: 16, pendingMaterialsRequests: 4, completedMaterialsRequests: 11,
      jobCardMaterialsRequests: 11, generalInventoryRequests: 5, materialsPending: 4,
      openUrl: `${BASE_URL}/store/parts-requests`,
    });
    assert.deepEqual(result.inventory, {
      totalMaterials: 3, currentBalance: 13, lowStockCount: 2, outOfStockCount: 1,
      currentStockValueKwd: 250.5, receivedThisMonthKwd: 30, issuedThisMonthKwd: 10,
      openUrl: `${BASE_URL}/store/offline-inventory`,
    });
    assert.deepEqual(result.assets, {
      totalAssets: 67, assetsAtSite: 2, activeMaintenance: 8, overdueReturn: 1,
      assetTypeBreakdown: [{ type: "Car", count: 42 }, { type: "Generator", count: 25 }],
      openUrl: `${BASE_URL}/assets`,
    });
    assert.deepEqual(result.labor, {
      workingNow: 1, pausedWorkers: 2, laborHoursToday: result.labor!.laborHoursToday, laborCostTodayKwd: result.labor!.laborCostTodayKwd,
      laborHoursThisWeek: 2, laborCostThisWeekKwd: 4, openUrl: `${BASE_URL}/maintenance/assignments`,
    });
    assert.ok(result.labor!.laborHoursToday >= 1.5);

    assert.equal(result.vehicleCompliance?.vehicleExpiryAlerts, 2);
    assert.equal(result.vehicleCompliance?.expiredCount, 1);
    assert.equal(result.vehicleCompliance?.expiringSoon, 1);
    assert.equal(result.vehicleCompliance?.topVehicleExpiryAlerts[0].overdueDays, 3);

    assert.deepEqual(result.managerAttention?.counts, {
      closureRequests: 2, vehicleExpiryAlerts: 2, overdueJobs: 1, waitingMaterials: 6, lowStock: 2, unassignedJobs: 3,
    });
    assert.equal(result.managerAttention?.needsManagerAttention, 16);
    assert.deepEqual(result.managerAttention?.attentionItems.map((i) => i.type), [
      "vehicle_expiry", "low_stock", "vehicle_expiry", "low_stock",
    ]);
    assert.equal(result.links.workerActivity, `${BASE_URL}/maintenance/assignments`);

    // Read-only: nothing outside the read allow-list was touched.
    assert.deepEqual(forbidden, []);
    assert.ok(calls.every((c) => READ_METHODS.includes(c.method)));
    assert.ok(!calls.some((c) => /audit|notification/i.test(c.model)));
  });

  it("withholds every cost figure when includeCosts is false", async () => {
    const { db, calls } = fakeDb(responders());
    const result = await build(db, { includeCosts: false });
    assert.equal(result.inventory?.currentStockValueKwd, null);
    assert.equal(result.inventory?.receivedThisMonthKwd, null);
    assert.equal(result.inventory?.issuedThisMonthKwd, null);
    assert.equal(result.labor?.laborCostTodayKwd, null);
    assert.equal(result.labor?.laborCostThisWeekKwd, null);
    assert.equal(result.labor?.laborHoursThisWeek, 2);
    assert.ok(!calls.some((c) => c.model === "offline_inventory_movements"));
    assert.doesNotMatch(JSON.stringify(result), /250\.5/);
  });

  it("returns null for a failed section without failing the payload", async () => {
    const logged: string[] = [];
    const { db } = fakeDb(
      responders({
        "assets.groupBy": () => {
          throw new Error("boom");
        },
      })
    );
    const result = await build(db, {
      loadInventoryBalance: async () => {
        throw new Error("inventory down");
      },
      logError: (message) => logged.push(message),
    });
    assert.equal(result.assets, null);
    assert.equal(result.inventory, null);
    assert.equal(result.managerAttention, null);
    assert.notEqual(result.jobCards, null);
    assert.notEqual(result.vehicleCompliance, null);
    assert.equal(result.summary.openRequests, 20);
    assert.ok(logged.length >= 2);
  });
});

describe("executive helpers", () => {
  it("counts working/paused jobs and workers like the MMS dashboard", () => {
    assert.deepEqual(
      summarizeOpenSessions([
        { work_order_id: "a", worker_id: "1", status: "Active" },
        { work_order_id: "a", worker_id: "2", status: "Paused" },
        { work_order_id: "b", worker_id: "2", status: "Paused" },
      ]),
      { jobsWorkingNow: 1, jobsPaused: 1, workersWorkingNow: 1, workersPaused: 1 }
    );
  });

  it("flags only vehicle documents inside the expiry window, soonest first", () => {
    const alerts = buildVehicleAlerts(
      [
        { id: "v1", asset_code: "C1", asset_name: "Car", plate_number: "1", insurance_expiry_date: dateOnly(15), registration_expiry_date: dateOnly(16) },
        { id: "v2", asset_code: "C2", asset_name: "Truck", plate_number: null, insurance_expiry_date: dateOnly(-40), registration_expiry_date: null },
      ],
      BASE_URL
    );
    assert.deepEqual(alerts.map((a) => [a.assetRef, a.expiryType, a.overdueDays]), [
      ["C2", "Insurance", 40],
      ["C1", "Insurance", 0],
    ]);
    assert.equal(alerts[0].title, "Truck");
    assert.equal(alerts[1].title, "Car (1)");
    assert.equal(alerts[0].openUrl, `${BASE_URL}/assets/v2`);
  });

  it("spreads attention items across types and caps the list", () => {
    const item = (type: FmpManagerAttentionItem["type"], ref: string): FmpManagerAttentionItem => ({
      type, ref, title: ref, reason: "", status: null, priority: null, openUrl: "",
    });
    const picked = pickAttentionItems([
      ...Array.from({ length: 10 }, (_, i) => item("closure_request", `c${i}`)),
      item("low_stock", "l0"),
      item("unassigned_job", "u0"),
    ]);
    assert.equal(picked.length, 6);
    assert.deepEqual(picked.map((p) => p.ref), ["c0", "l0", "u0", "c1", "c2", "c3"]);
  });
});
