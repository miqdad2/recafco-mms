import { requirePermission } from "@/lib/auth/context";
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
    <StoreBalanceView
      balanceItems={balanceItems}
      totalOpeningStock={totalOpeningStock}
      totalReceived={totalReceived}
      totalIssued={totalIssued}
      balance={balance}
      canManage={canManage}
      recentMovements={recentMovements}
    />
  );
}
