import { Activity, Bell, Building2, CheckCircle2, ClipboardCheck, Landmark, PackageSearch, Settings, ShieldCheck, ShoppingCart, Users, Wrench } from "lucide-react";

import { markNotificationsReadAction } from "@/app/actions/workflow";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/lib/auth/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

type CountResult = {
  count: number | null;
  error: unknown;
};

type SettingsData = {
  default_currency?: string | null;
};

type AuditRow = {
  id: string;
  action: string;
  summary: string;
  created_at: string;
};

type NotificationRow = {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  created_at: string;
  entity_id: string | null;
};

async function safeCount(query: PromiseLike<CountResult>) {
  try {
    const result = await query;
    return result.error ? 0 : result.count ?? 0;
  } catch {
    return 0;
  }
}

async function safeMaybeSettings(query: PromiseLike<{ data: SettingsData | null; error: unknown }>) {
  try {
    const result = await query;
    return result.error ? null : result.data;
  } catch {
    return null;
  }
}

async function safeRows<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>) {
  try {
    const result = await query;
    return result.error ? [] : result.data ?? [];
  } catch {
    return [];
  }
}

function createDashboardDataClient() {
  try {
    return createSupabaseAdminClient();
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const context = await requireUser();
  const fallbackSupabase = await createSupabaseServerClient();
  const supabase = createDashboardDataClient() ?? fallbackSupabase;

  const [
    profiles,
    activeDepartments,
    roles,
    auditLogs,
    settings,
    pendingApprovals,
    assignedJobs,
    unreadNotifications,
    pendingParts,
    stockRows,
    pendingPurchases,
    financeQueue
  ] = await Promise.all([
    safeCount(supabase.from("profiles").select("id", { count: "exact", head: true })),
    safeCount(supabase.from("departments").select("id", { count: "exact", head: true }).eq("is_active", true)),
    safeCount(supabase.from("roles").select("id", { count: "exact", head: true })),
    safeCount(supabase.from("audit_logs").select("id", { count: "exact", head: true })),
    safeMaybeSettings(supabase.from("app_settings").select("default_currency").eq("id", "00000000-0000-0000-0000-000000000001").maybeSingle()),
    safeCount(supabase.from("work_orders").select("id", { count: "exact", head: true }).in("status", ["Submitted", "Pending Approval"])),
    safeCount(supabase.from("work_order_assignments").select("id", { count: "exact", head: true }).eq("technician_id", context.userId)),
    safeCount(supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", context.userId).eq("is_read", false)),
    safeCount(supabase.from("parts_requests").select("id", { count: "exact", head: true }).in("status", ["Pending Approval", "Waiting for Store", "Partially Issued", "Waiting for Purchase"])),
    safeRows<{ current_stock: number | string | null; minimum_stock: number | string | null }>(supabase.from("parts").select("current_stock, minimum_stock").is("deleted_at", null)),
    safeCount(supabase.from("purchase_requests").select("id", { count: "exact", head: true }).in("status", ["Pending Purchase", "Approved", "Ordered"])),
    safeCount(supabase.from("purchase_requests").select("id", { count: "exact", head: true }).in("status", ["Pending Finance Approval", "Pending CEO Approval"]))
  ]);

  const lowStockCount = stockRows.filter((part) => Number(part.current_stock) <= Number(part.minimum_stock)).length;

  const recentLogs = await safeRows<AuditRow>(
    supabase
      .from("audit_logs")
      .select("id, action, summary, created_at")
      .order("created_at", { ascending: false })
      .limit(5)
  );

  const notifications = await safeRows<NotificationRow>(
    supabase
      .from("notifications")
      .select("id, title, message, notification_type, is_read, created_at, entity_id")
      .eq("recipient_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(8)
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live administrative foundation for RECAFCO users, departments, roles, settings, and audit monitoring."
      />
      <div className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Profiles" value={profiles} detail="Login-linked user profiles" icon={Users} tone="blue" />
          <StatCard label="Active Departments" value={activeDepartments} detail="Operational departments" icon={Building2} tone="green" />
          <StatCard label="Pending Approvals" value={pendingApprovals} detail="Work orders waiting for review" icon={ClipboardCheck} tone="amber" />
          <StatCard label="My Assigned Jobs" value={assignedJobs} detail="Technician assignment count" icon={Wrench} tone="gray" />
          <StatCard label="Unread Notifications" value={unreadNotifications} detail="Current user notifications" icon={Bell} tone="red" />
          <StatCard label="Parts Queue" value={pendingParts} detail="Approval, store, and purchase-linked requests" icon={PackageSearch} tone="blue" />
          <StatCard label="Low Stock" value={lowStockCount} detail="Parts at or below minimum" icon={ShoppingCart} tone="amber" />
          <StatCard label="Purchase Queue" value={pendingPurchases} detail="Pending, approved, or ordered purchases" icon={ShoppingCart} tone="blue" />
          <StatCard label="Finance / CEO" value={financeQueue} detail="Cost approvals requiring decision" icon={Landmark} tone="red" />
          <StatCard label="Roles" value={roles} detail="Configured access groups" icon={ShieldCheck} tone="green" />
          <StatCard label="Audit Entries" value={auditLogs} detail="Tracked admin actions" icon={Activity} tone="gray" />
          <StatCard label="Currency" value={settings?.default_currency ?? "KWD"} detail="Configured default currency" icon={Settings} tone="green" />
        </div>

        <section className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
          <div className="rounded-md border border-[#DDE2EA] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Foundation status</p>
                <h2 className="mt-1 text-xl font-black text-[#111827]">System Readiness</h2>
                <p className="mt-1 text-sm leading-6 text-[#4B5563]">Phase 1 foundation status for secure maintenance operations.</p>
              </div>
              <StatusBadge label="Phase 1 active" tone="green" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                "Secure login sessions",
                "Server-side RBAC context",
                "Protected admin routes",
                "Department master data",
                "User profile management",
                "Configurable company settings"
              ].map((item) => (
                <div key={item} className="flex min-h-12 items-center gap-3 rounded-md border border-[#DDE2EA] bg-[#F8FAFC] px-3 py-2 text-sm font-semibold text-[#111827]">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-[#DDE2EA] bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Session context</p>
            <h2 className="mt-1 text-xl font-black text-[#111827]">Current User</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex justify-between gap-3 border-b border-[#EEF2F6] pb-3">
                <dt className="text-[#4B5563]">Name</dt>
                <dd className="font-semibold text-[#111827]">{context.profile.full_name}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-[#EEF2F6] pb-3">
                <dt className="text-[#4B5563]">Role</dt>
                <dd className="font-semibold text-[#111827]">{context.role?.name ?? "Not assigned"}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-[#EEF2F6] pb-3">
                <dt className="text-[#4B5563]">Department</dt>
                <dd className="font-semibold text-[#111827]">{context.department?.name ?? "Not assigned"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#4B5563]">Cost visibility</dt>
                <dd>{context.permissions.includes("costs.view") ? <StatusBadge label="Allowed" tone="green" /> : <StatusBadge label="Restricted" tone="amber" />}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-[#DDE2EA] p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Inbox</p>
              <h2 className="mt-1 text-xl font-black text-[#111827]">In-App Notifications</h2>
              <p className="mt-1 text-sm leading-6 text-[#4B5563]">Workflow messages for approvals, assignments, completion, verification, and closure.</p>
            </div>
            <form action={markNotificationsReadAction}>
              <Button type="submit" variant="secondary">Mark read</Button>
            </form>
          </div>
          <div className="divide-y divide-[#EEF2F6]">
            {notifications?.length ? notifications.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 p-4 transition hover:bg-[#F8FAFC] sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-[#111827]">{item.title}</p>
                  <p className="text-sm text-[#4B5563]">{item.message}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!item.is_read ? <StatusBadge label="New" tone="red" /> : <StatusBadge label="Read" tone="gray" />}
                  <p className="text-xs text-[#4B5563]">{formatDateTime(item.created_at)}</p>
                </div>
              </div>
            )) : <p className="p-5 text-sm text-[#4B5563]">No notifications.</p>}
          </div>
        </section>

        <section className="rounded-md border border-[#DDE2EA] bg-white shadow-sm">
          <div className="border-b border-[#DDE2EA] p-6">
            <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Activity trail</p>
            <h2 className="mt-1 text-xl font-black text-[#111827]">Recent Audit Activity</h2>
          </div>
          <div className="divide-y divide-[#EEF2F6]">
            {recentLogs?.length ? (
              recentLogs.map((log) => (
                <div key={log.id} className="flex flex-col gap-1 p-4 transition hover:bg-[#F8FAFC] sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-[#111827]">{log.summary}</p>
                    <p className="text-sm text-[#4B5563]">{log.action}</p>
                  </div>
                  <p className="text-sm text-[#4B5563]">{formatDateTime(log.created_at)}</p>
                </div>
              ))
            ) : (
              <p className="p-5 text-sm text-[#4B5563]">No audit activity recorded yet.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
