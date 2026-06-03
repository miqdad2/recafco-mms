import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SystemMapStats = {
  assets: number;
  parts: number;
  workOrders: number;
  openWorkOrders: number;
  pendingApprovals: number;
  waitingForParts: number;
  partsRequests: number;
  purchaseRequests: number;
  financeApprovals: number;
  lowStockItems: number;
  unreadNotifications: number;
  closedWorkOrders: number;
  departments: number;
  profiles: number;
  roles: number;
};

type CountQuery = {
  count: number | null;
  error: unknown;
};

async function safeCount(query: PromiseLike<CountQuery>) {
  try {
    const result = await query;
    return result.error ? 0 : result.count ?? 0;
  } catch {
    return 0;
  }
}

export async function getSystemMapStats(userId: string): Promise<SystemMapStats> {
  const supabase = await createSupabaseServerClient();

  const [
    assets,
    parts,
    workOrders,
    openWorkOrders,
    pendingApprovals,
    waitingForParts,
    partsRequests,
    purchaseRequests,
    financeApprovals,
    unreadNotifications,
    closedWorkOrders,
    departments,
    profiles,
    roles
  ] = await Promise.all([
    safeCount(supabase.from("assets").select("id", { count: "exact", head: true }).is("deleted_at", null)),
    safeCount(supabase.from("parts").select("id", { count: "exact", head: true }).is("deleted_at", null)),
    safeCount(supabase.from("work_orders").select("id", { count: "exact", head: true })),
    safeCount(supabase.from("work_orders").select("id", { count: "exact", head: true }).not("status", "in", "(Closed,Cancelled,Rejected)")),
    safeCount(supabase.from("work_orders").select("id", { count: "exact", head: true }).in("status", ["Submitted", "Pending Approval"])),
    safeCount(supabase.from("work_orders").select("id", { count: "exact", head: true }).in("status", ["Waiting for Parts", "Waiting for Purchase"])),
    safeCount(supabase.from("parts_requests").select("id", { count: "exact", head: true })),
    safeCount(supabase.from("purchase_requests").select("id", { count: "exact", head: true })),
    safeCount(supabase.from("purchase_requests").select("id", { count: "exact", head: true }).in("status", ["Pending Finance Approval", "Pending CEO Approval"])),
    safeCount(supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", userId).eq("is_read", false)),
    safeCount(supabase.from("work_orders").select("id", { count: "exact", head: true }).eq("status", "Closed")),
    safeCount(supabase.from("departments").select("id", { count: "exact", head: true }).eq("is_active", true)),
    safeCount(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true)),
    safeCount(supabase.from("roles").select("id", { count: "exact", head: true }))
  ]);

  let lowStockItems = 0;
  try {
    const { data, error } = await supabase.from("parts").select("current_stock, minimum_stock").is("deleted_at", null);
    lowStockItems = error ? 0 : (data ?? []).filter((part) => Number(part.current_stock) <= Number(part.minimum_stock)).length;
  } catch {
    lowStockItems = 0;
  }

  return {
    assets,
    parts,
    workOrders,
    openWorkOrders,
    pendingApprovals,
    waitingForParts,
    partsRequests,
    purchaseRequests,
    financeApprovals,
    lowStockItems,
    unreadNotifications,
    closedWorkOrders,
    departments,
    profiles,
    roles
  };
}
