import { requirePermission } from "@/lib/auth/context";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { StoreBalanceView } from "@/components/store/store-balance-view";
import {
  canManageOfflineInventory,
  getOfflineInventoryBalance,
  getRecentOfflineInventoryMovements,
} from "@/lib/store/offline-inventory-data";

export default async function StoreBalancePage() {
  const context = await requirePermission("parts.view");
  const canManage = canManageOfflineInventory(context);

  const [{ balanceItems, totalOpeningStock, totalReceived, totalIssued, balance }, recentMovements] =
    await Promise.all([getOfflineInventoryBalance(), getRecentOfflineInventoryMovements(15)]);

  return (
    <>
      {/* Store Dashboard + Store Issue + Material Ledger Alignment Task 10:
          Data Entry/Engineer/Manager use this page as a Material Ledger to
          see what Store has issued — it needs to update on its own after a
          Store issue action, same 15s interval as the rest of the app. */}
      <AutoRefresh intervalMs={15000} />
      <RealtimeRefresh watch={["store_materials.sent", "material_ledger.updated"]} />
      <StoreBalanceView
        balanceItems={balanceItems}
        totalOpeningStock={totalOpeningStock}
        totalReceived={totalReceived}
        totalIssued={totalIssued}
        balance={balance}
        canManage={canManage}
        recentMovements={recentMovements}
      />
    </>
  );
}
