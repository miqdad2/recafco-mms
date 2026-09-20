import { requirePermission } from "@/lib/auth/context";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { StoreBalanceView } from "@/components/store/store-balance-view";
import { prisma } from "@/lib/db/prisma";
import { canViewCosts as canViewCostsPermission } from "@/lib/security/permissions";
import {
  canManageOfflineInventory,
  getOfflineInventoryBalance,
  getInventorySpendingSummary,
  getWorkOrderOptions,
} from "@/lib/store/offline-inventory-data";

export default async function StoreBalancePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("parts.view");
  const canManage = canManageOfflineInventory(context);
  const canViewCosts = canViewCostsPermission(context);
  // Simplification Task 2: Super Admin alone gets the one-time setup actions
  // (Add Opening Stock / Import Opening Stock) surfaced on this page — Data
  // Entry/Manager only see the daily Material Actions.
  const isSuperAdmin = context.role?.slug === "super_admin";

  const sp = (await searchParams) ?? {};
  // Large Popup Conversion: Add New Material / Receive Material / Issue
  // Material open as modals from this page via these query params instead of
  // navigating to their standalone pages (which still exist and still work
  // for direct URL access — see /add-material, /receive, /issue). workOrders
  // is only needed once one of the receive/issue modals is actually open.
  const showAddMaterial = canManage && sp.addMaterial !== undefined;
  const showReceiveMaterial = canManage && sp.receiveMaterial !== undefined;
  const showIssueMaterial = canManage && sp.issueMaterial !== undefined;
  // Next.js server-component searchParams values are already URL-decoded —
  // no additional decodeURIComponent needed (that would double-decode a
  // material name containing a literal "%").
  const receiveMaterialKey = sp.receiveMaterial || null;
  const issueMaterialKey = sp.issueMaterial || null;
  // Required Materials Issue and Shortage Tracking Unit 6: arrives from a
  // Job Card's Materials section "Issue" link — may be an older Job Card
  // not among getWorkOrderOptions()'s most-recent 100, so it's looked up
  // directly and prepended below rather than silently dropped from the list.
  const issueWorkOrderId = sp.workOrder || null;

  const [{ balanceItems, totalReceived, totalIssued, balance, totalStockValue, lowStockCount }, workOrdersRaw, presetWorkOrder] =
    await Promise.all([
      getOfflineInventoryBalance(),
      showReceiveMaterial || showIssueMaterial ? getWorkOrderOptions() : Promise.resolve([]),
      issueWorkOrderId
        ? prisma.work_orders.findUnique({ where: { id: issueWorkOrderId }, select: { id: true, work_order_number: true } })
        : Promise.resolve(null),
    ]);
  const workOrders =
    presetWorkOrder && !workOrdersRaw.some((wo) => wo.id === presetWorkOrder.id)
      ? [presetWorkOrder, ...workOrdersRaw]
      : workOrdersRaw;

  // Inventory Dashboard Spending and Simple Low Stock Rules Unit 10G.63,
  // Task 4/5/6/7 — depends on balanceItems (for the category stock-value
  // roll-up), so it runs after the Promise.all above rather than inside it.
  const spendingSummary = await getInventorySpendingSummary(balanceItems);

  // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 5 — strip
  // cost fields from the data itself for a viewer without cost permission,
  // not just from what the UI renders. Next.js sends every prop passed to
  // a client component down in the page's own payload regardless of what
  // that component chooses to display, so hiding the columns in
  // StoreBalanceView alone would still leak the real numbers to the
  // browser. balanceItemsForClient is the exact BalanceItem[] shape
  // StoreBalanceView expects either way — just with the four cost fields
  // zeroed out when they must not leave the server.
  const balanceItemsForClient = canViewCosts
    ? balanceItems
    : balanceItems.map((item) => ({
        ...item,
        last_unit_cost: null,
        stock_value: 0,
        received_value: 0,
        issued_value: 0,
      }));

  // Task 11 — same stripping principle as balanceItemsForClient: every
  // field in spendingSummary is cost data (the category cost table and top
  // issued materials' values included), so a non-cost viewer gets a fully
  // zeroed-out summary rather than the UI merely choosing not to render
  // it. topIssuedMaterialsForClient keeps quantity/unit/date (Task 7's
  // "quantity-only version" for Data Entry) with only issuedValue zeroed.
  const spendingSummaryForClient = canViewCosts
    ? spendingSummary
    : {
        issuedValueThisWeek: 0,
        issuedValueThisMonth: 0,
        issuedValueThisYear: 0,
        receivedValueThisMonth: 0,
        unpricedIssuedCount: 0,
        categoryCostSummary: [],
        topIssuedMaterials: spendingSummary.topIssuedMaterials.map((m) => ({ ...m, issuedValue: 0 })),
      };

  return (
    <>
      {/* Store Dashboard + Store Issue + Material Ledger Alignment Task 10:
          Data Entry/Engineer/Manager use this page as a Material Ledger to
          see what Store has issued — it needs to update on its own after a
          Store issue action, same 15s interval as the rest of the app.
          Enterprise-Wide Real-Time Update Verification Task 2/8: widened to
          also watch "offline_inventory." — the direct Add Opening Stock/
          Import/Add Received Material/Issue Material actions now emit
          under that prefix and previously had no watcher on this page at
          all — plus "materials_request."/"job_card." so a materials receipt
          against a Job Card also refreshes the balance shown here.
          Main Page Simplification Task 2: Recent Movements no longer renders
          here, so this page no longer fetches getRecentOfflineInventoryMovements()
          — that data/query still exists and is used by the Movement History
          page. */}
      <AutoRefresh intervalMs={15000} />
      <RealtimeRefresh watch={["offline_inventory.", "material_ledger.", "store_materials.", "materials_request.", "job_card."]} />
      <StoreBalanceView
        balanceItems={balanceItemsForClient}
        totalReceived={totalReceived}
        totalIssued={totalIssued}
        balance={balance}
        canManage={canManage}
        isSuperAdmin={isSuperAdmin}
        canViewCosts={canViewCosts}
        totalStockValue={canViewCosts ? totalStockValue : 0}
        lowStockCount={lowStockCount}
        spendingSummary={spendingSummaryForClient}
        workOrders={workOrders}
        showAddMaterial={showAddMaterial}
        showReceiveMaterial={showReceiveMaterial}
        showIssueMaterial={showIssueMaterial}
        receiveMaterialKey={receiveMaterialKey}
        issueMaterialKey={issueMaterialKey}
        issueWorkOrderId={issueWorkOrderId}
      />
    </>
  );
}
