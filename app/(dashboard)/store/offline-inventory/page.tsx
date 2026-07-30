import { requirePermission } from "@/lib/auth/context";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { StoreBalanceView } from "@/components/store/store-balance-view";
import {
  canManageOfflineInventory,
  getOfflineInventoryBalance,
  getWorkOrderOptions,
} from "@/lib/store/offline-inventory-data";

export default async function StoreBalancePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("parts.view");
  const canManage = canManageOfflineInventory(context);
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

  const [{ balanceItems, totalOpeningStock, totalReceived, totalIssued, balance }, workOrders] =
    await Promise.all([
      getOfflineInventoryBalance(),
      showReceiveMaterial || showIssueMaterial ? getWorkOrderOptions() : Promise.resolve([]),
    ]);

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
        balanceItems={balanceItems}
        totalOpeningStock={totalOpeningStock}
        totalReceived={totalReceived}
        totalIssued={totalIssued}
        balance={balance}
        canManage={canManage}
        isSuperAdmin={isSuperAdmin}
        workOrders={workOrders}
        showAddMaterial={showAddMaterial}
        showReceiveMaterial={showReceiveMaterial}
        showIssueMaterial={showIssueMaterial}
        receiveMaterialKey={receiveMaterialKey}
        issueMaterialKey={issueMaterialKey}
      />
    </>
  );
}
