import type { system_error_logs } from "@prisma/client";
import { Activity, AlertTriangle, Bell, CheckCircle2, Clock3, Database, HardDrive, KeyRound, Lock, Plus, ShieldAlert, ShieldCheck, Siren, Stethoscope, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createManualSystemIssueAction, updateSystemIssueStatusAction } from "@/app/actions/system-health";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUser } from "@/lib/auth/context";
import { type BackupLogRow, getBackupInfo, getLatestBackup } from "@/lib/backup/status";
import { prisma } from "@/lib/db/prisma";
import { logSystemError } from "@/lib/errors/logging";
import { cn, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 30;
const managedStatuses = ["open", "investigating"] as const;

type SearchParams = Record<string, string | string[] | undefined>;

type HealthData =
  | {
      ready: true;
      dbOnline: boolean;
      issues: system_error_logs[];
      total: number;
      unresolvedCount: number;
      criticalOpenCount: number;
      todayCount: number;
      notificationFailuresToday: number;
      recentNotificationFailures: Array<{
        id: string;
        event_key: string | null;
        recipient_user_id: string | null;
        error_message: string | null;
        attempted_at: Date;
      }>;
      revokedSessionsToday: number;
      auditEventsToday: number;
      statusGroups: Array<{ status: string; _count: { _all: number } }>;
      severityGroups: Array<{ severity: string; _count: { _all: number } }>;
      sourceGroups: Array<{ source: string; _count: { _all: number } }>;
      recentAuditLogs: Array<{ id: string; action: string; summary: string; created_at: Date }>;
      issuesLast7Days: number;
      lastIssueAt: Date | null;
      // Security overview fields
      activeSessions: number;
      failedLoginsToday: number;
      lockedAccounts: number;
      latestBackup: BackupLogRow | null;
    }
  | {
      ready: false;
      dbOnline: boolean;
      error: string;
    };

export default async function SystemHealthPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const context = await requireUser();
  const canView =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("admin.audit_logs.view") ||
    context.permissions.includes("admin.system_health.view");

  if (!canView) redirect("/dashboard?error=permission-denied");

  const params = (await searchParams) ?? {};
  const page = Math.max(1, Number(single(params.page) ?? 1) || 1);
  const severity = single(params.severity) ?? "";
  const status = single(params.status) ?? "";
  const source = single(params.source) ?? "";
  const search = (single(params.search) ?? "").trim().slice(0, 80);
  const health = await loadHealthData({ page, severity, status, source, search });

  return (
    <>
      <PageHeader
        title="System Health Center"
        description="Super Admin and IT monitoring for crashes, workflow failures, notification delivery issues, session problems, and day-to-day system reliability."
        actions={
          <>
            <Link href="/admin/audit-logs">
              <Button variant="secondary">Audit logs</Button>
            </Link>
            <Link href="/admin/notification-settings">
              <Button variant="secondary">Notification logs</Button>
            </Link>
          </>
        }
      />
      <div className="space-y-5 p-4 lg:p-6">
        {single(params.success) ? <Banner tone="green" message={successMessage(single(params.success) ?? "")} /> : null}
        {single(params.error) ? <Banner tone="red" message={single(params.error) ?? "System health action failed."} /> : null}

        {!health.ready ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-1 h-5 w-5 text-amber-700" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-black text-amber-950">System health storage is not ready</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-900">
                  The app is online, but the health log table could not be queried. Apply migration `20260607150000_system_health_center.sql` to enable persistent issue tracking.
                </p>
                <p className="mt-2 text-xs font-semibold text-amber-900">{health.error}</p>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <HealthCard icon={Database} label="Database" value={health.dbOnline ? "Online" : "Down"} detail="Basic database connection check" tone={health.dbOnline ? "green" : "red"} />
              <HealthCard icon={Siren} label="Open issues" value={health.unresolvedCount} detail="Open or under investigation" tone={health.unresolvedCount ? "red" : "green"} />
              <HealthCard icon={ShieldAlert} label="Critical open" value={health.criticalOpenCount} detail="Critical/error issues not resolved" tone={health.criticalOpenCount ? "red" : "green"} />
              <HealthCard icon={Activity} label="Today" value={health.todayCount} detail="System issues logged today" tone={health.todayCount ? "amber" : "green"} />
            </section>

            <CommandStatus health={health} />

            <SecurityOverview
              activeSessions={health.activeSessions}
              failedLoginsToday={health.failedLoginsToday}
              lockedAccounts={health.lockedAccounts}
              latestBackup={health.latestBackup}
            />

            <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <Stethoscope className="h-5 w-5 text-[#ED1C24]" aria-hidden="true" />
                  <h2 className="text-lg font-black text-[#111827]">Operations health</h2>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <MiniMetric label="Notification failures today" value={health.notificationFailuresToday} tone={health.notificationFailuresToday ? "red" : "green"} />
                  <MiniMetric label="Revoked sessions today" value={health.revokedSessionsToday} tone={health.revokedSessionsToday ? "amber" : "green"} />
                  <MiniMetric label="Audit events today" value={health.auditEventsToday} tone="blue" />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Breakdown title="By severity" rows={severityRows(health.severityGroups)} />
                  <Breakdown title="By status" rows={statusRows(health.statusGroups)} />
                </div>
              </div>

              <ManualIssuePanel />
            </section>

            <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase text-[#ED1C24]">Issue sources</p>
                  <h2 className="text-lg font-black text-[#111827]">Where problems are coming from</h2>
                </div>
                <StatusBadge label={`${health.total} matching issues`} tone="blue" />
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {health.sourceGroups.length ? health.sourceGroups.map((row) => (
                  <Link key={row.source} href={`/admin/system-health?source=${encodeURIComponent(row.source)}`} className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3 hover:border-[#ED1C24]">
                    <p className="truncate text-sm font-black text-[#111827]">{row.source}</p>
                    <p className="mt-2 text-2xl font-black text-[#111827]">{row._count._all}</p>
                  </Link>
                )) : (
                  <div className="rounded-md border border-green-200 bg-green-50 p-4 md:col-span-2 xl:col-span-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-700" aria-hidden="true" />
                      <div>
                        <p className="font-black text-green-900">No runtime issue sources recorded</p>
                        <p className="mt-1 text-sm leading-6 text-green-800">This is a healthy state. New crashes, failed actions, notification failures, or manual IT issues will appear here automatically.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <RecentActivityPanel logs={health.recentAuditLogs} />

            <NotificationFailuresPanel failures={health.recentNotificationFailures} />

            <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <form className="grid gap-3 lg:grid-cols-[1fr_180px_180px_220px_auto]">
                <input className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" name="search" defaultValue={search} placeholder="Search message, source, route" />
                <select className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" name="severity" defaultValue={severity}>
                  <option value="">All severities</option>
                  {["critical", "error", "warning", "info"].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" name="status" defaultValue={status}>
                  <option value="">All statuses</option>
                  {["open", "investigating", "resolved", "ignored"].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <input className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" name="source" defaultValue={source} placeholder="Exact source" />
                <Button type="submit" variant="secondary">Filter</Button>
              </form>
            </section>

            <IssueTable issues={health.issues} page={page} total={health.total} params={{ severity, status, source, search }} />
          </>
        )}
      </div>
    </>
  );
}

async function loadHealthData({ page, severity, status, source, search }: { page: number; severity: string; status: string; source: string; search: string }): Promise<HealthData> {
  let dbOnline = false;

  try {
    await prisma.$queryRaw`select 1`;
    dbOnline = true;
  } catch {
    return { ready: false, dbOnline: false, error: "Database connection failed." };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const where = {
    ...(severity ? { severity } : {}),
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(search
      ? {
          OR: [
            { message: { contains: search, mode: "insensitive" as const } },
            { source: { contains: search, mode: "insensitive" as const } },
            { route: { contains: search, mode: "insensitive" as const } },
            { entity_type: { contains: search, mode: "insensitive" as const } }
          ]
        }
      : {})
  };

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const now = new Date();
    const [issues, total, unresolvedCount, criticalOpenCount, todayCount, notificationFailuresToday, recentNotificationFailures, revokedSessionsToday, auditEventsToday, statusGroups, severityGroups, sourceGroups, recentAuditLogs, issuesLast7Days, lastIssue, activeSessions, failedLoginsToday, lockedAccounts, latestBackup] = await Promise.all([
      prisma.system_error_logs.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE
      }),
      prisma.system_error_logs.count({ where }),
      prisma.system_error_logs.count({ where: { status: { in: [...managedStatuses] } } }),
      prisma.system_error_logs.count({ where: { severity: { in: ["critical", "error"] }, status: { in: [...managedStatuses] } } }),
      prisma.system_error_logs.count({ where: { created_at: { gte: today } } }),
      prisma.notification_delivery_logs.count({ where: { status: "failed", attempted_at: { gte: today } } }),
      prisma.notification_delivery_logs.findMany({
        where: { status: "failed" },
        orderBy: { attempted_at: "desc" },
        take: 10,
        select: {
          id: true,
          event_key: true,
          recipient_user_id: true,
          error_message: true,
          attempted_at: true
        }
      }),
      prisma.auth_sessions.count({ where: { revoked_at: { gte: today } } }),
      prisma.audit_logs.count({ where: { created_at: { gte: today } } }),
      prisma.system_error_logs.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.system_error_logs.groupBy({ by: ["severity"], _count: { _all: true } }),
      prisma.system_error_logs.groupBy({
        by: ["source"],
        _count: { _all: true },
        orderBy: { _count: { source: "desc" } },
        take: 8
      }),
      prisma.audit_logs.findMany({
        orderBy: { created_at: "desc" },
        take: 6,
        select: {
          id: true,
          action: true,
          summary: true,
          created_at: true
        }
      }),
      prisma.system_error_logs.count({ where: { created_at: { gte: sevenDaysAgo } } }),
      prisma.system_error_logs.findFirst({ orderBy: { created_at: "desc" }, select: { created_at: true } }),
      // Security overview queries
      prisma.auth_sessions.count({ where: { expires_at: { gt: now }, revoked_at: null } }),
      prisma.audit_logs.count({ where: { action: "auth.login_failed", created_at: { gte: today } } }),
      prisma.auth_users.count({ where: { locked_until: { gt: now } } }),
      getLatestBackup()
    ]);

    return {
      ready: true,
      dbOnline,
      issues,
      total,
      unresolvedCount,
      criticalOpenCount,
      todayCount,
      notificationFailuresToday,
      recentNotificationFailures,
      revokedSessionsToday,
      auditEventsToday,
      statusGroups,
      severityGroups,
      sourceGroups,
      recentAuditLogs,
      issuesLast7Days,
      lastIssueAt: lastIssue?.created_at ?? null,
      activeSessions,
      failedLoginsToday,
      lockedAccounts,
      latestBackup
    };
  } catch (error) {
    await logSystemError({
      severity: "warning",
      source: "admin.system_health.load",
      message: error instanceof Error ? error.message : "System health page failed to query health data",
      metadata: { route: "/admin/system-health" }
    });
    return {
      ready: false,
      dbOnline,
      error: error instanceof Error ? error.message : "Health table query failed."
    };
  }
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function successMessage(value: string) {
  if (value === "status-updated") return "System health issue status updated.";
  if (value === "issue-created") return "Manual system health issue created.";
  return "System health updated.";
}

function severityTone(severity: string) {
  if (severity === "critical" || severity === "error") return "red" as const;
  if (severity === "warning") return "amber" as const;
  return "blue" as const;
}

function statusTone(status: string) {
  if (status === "open") return "red" as const;
  if (status === "investigating") return "amber" as const;
  if (status === "resolved") return "green" as const;
  return "gray" as const;
}

function formatRelative(value: Date) {
  return formatDateTime(value.toISOString());
}

function entityHref(issue: system_error_logs) {
  if (!issue.entity_id || !issue.entity_type) return null;
  const routes: Record<string, string> = {
    asset: `/assets/${issue.entity_id}`,
    parts_request: `/store/parts-requests/${issue.entity_id}`,
    purchase_request: `/purchase/requests/${issue.entity_id}`,
    work_order: `/maintenance/work-orders/${issue.entity_id}`
  };
  return routes[issue.entity_type] ?? null;
}

function Banner({ tone, message }: { tone: "green" | "red"; message: string }) {
  return (
    <div className={cn("rounded-md border px-4 py-3 text-sm font-semibold", tone === "green" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800")}>
      {message}
    </div>
  );
}

function CommandStatus({ health }: { health: Extract<HealthData, { ready: true }> }) {
  const needsAttention = !health.dbOnline || health.unresolvedCount > 0 || health.criticalOpenCount > 0 || health.notificationFailuresToday > 0;
  const statusLabel = needsAttention ? "Attention required" : "Operating normally";
  const statusTone = needsAttention ? "red" : "green";

  const checks = [
    { label: "Database reachable", ok: health.dbOnline, detail: health.dbOnline ? "Connection check passed" : "Database check failed" },
    { label: "No critical open issues", ok: health.criticalOpenCount === 0, detail: `${health.criticalOpenCount} critical/error open` },
    { label: "Notifications healthy today", ok: health.notificationFailuresToday === 0, detail: `${health.notificationFailuresToday} failed deliveries` },
    { label: "Issue trend controlled", ok: health.issuesLast7Days <= 5, detail: `${health.issuesLast7Days} issues in 7 days` }
  ];

  return (
    <section className={cn("rounded-md border bg-white p-4 shadow-sm", needsAttention ? "border-red-200" : "border-green-200")}>
      <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
        <div className="flex items-start gap-3">
          <span className={cn("rounded-md p-2", needsAttention ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700")}>
            {needsAttention ? <AlertTriangle className="h-5 w-5" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-black uppercase text-[#ED1C24]">Command status</p>
              <StatusBadge label={statusLabel} tone={statusTone} />
            </div>
            <h2 className="mt-2 text-xl font-black text-[#111827]">
              {needsAttention ? "Review system issues before they affect users" : "System is healthy and ready for daily operation"}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[#4B5563]">
              Last issue logged: {health.lastIssueAt ? formatRelative(health.lastIssueAt) : "No issues recorded yet"}. Use this page daily to catch workflow failures, crashes, and user-reported problems early.
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {checks.map((check) => (
            <div key={check.label} className={cn("rounded-md border p-3", check.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50")}>
              <div className="flex items-center gap-2">
                {check.ok ? <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 text-red-700" aria-hidden="true" />}
                <p className={cn("text-sm font-black", check.ok ? "text-green-900" : "text-red-900")}>{check.label}</p>
              </div>
              <p className={cn("mt-1 text-xs font-semibold", check.ok ? "text-green-800" : "text-red-800")}>{check.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HealthCard({ icon: Icon, label, value, detail, tone }: { icon: typeof Database; label: string; value: ReactNode; detail: string; tone: "green" | "amber" | "red" }) {
  return (
    <div className={cn("rounded-md border bg-white p-4 shadow-sm", tone === "green" && "border-green-200", tone === "amber" && "border-amber-200", tone === "red" && "border-red-200")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-[#4B5563]">{label}</p>
          <p className="mt-2 text-2xl font-black text-[#111827]">{value}</p>
        </div>
        <span className={cn("rounded-md p-2", tone === "green" && "bg-green-50 text-green-600", tone === "amber" && "bg-amber-50 text-amber-600", tone === "red" && "bg-red-50 text-red-600")}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-sm text-[#4B5563]">{detail}</p>
    </div>
  );
}

function MiniMetric({ label, value, tone }: { label: string; value: number; tone: "green" | "amber" | "red" | "blue" }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
      <p className="text-xs font-black uppercase text-[#4B5563]">{label}</p>
      <p className={cn("mt-2 text-2xl font-black", tone === "green" && "text-green-700", tone === "amber" && "text-amber-700", tone === "red" && "text-red-700", tone === "blue" && "text-blue-700")}>{value}</p>
    </div>
  );
}

function severityRows(rows: Array<{ severity: string; _count: { _all: number } }>) {
  return ["critical", "error", "warning", "info"].map((severity) => ({
    label: severity,
    value: rows.find((row) => row.severity === severity)?._count._all ?? 0,
    tone: severityTone(severity)
  }));
}

function statusRows(rows: Array<{ status: string; _count: { _all: number } }>) {
  return ["open", "investigating", "resolved", "ignored"].map((status) => ({
    label: status,
    value: rows.find((row) => row.status === status)?._count._all ?? 0,
    tone: statusTone(status)
  }));
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ label: string; value: number; tone: "green" | "amber" | "red" | "blue" | "gray" }> }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] p-3">
      <p className="text-sm font-black text-[#111827]">{title}</p>
      <div className="mt-3 space-y-2">
        {rows.length ? rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <StatusBadge label={row.label} tone={row.tone} />
            <span className="font-black text-[#111827]">{row.value}</span>
          </div>
        )) : <span className="text-sm font-semibold text-[#4B5563]">No data</span>}
      </div>
    </div>
  );
}

type NotificationFailureRow = {
  id: string;
  event_key: string | null;
  recipient_user_id: string | null;
  error_message: string | null;
  attempted_at: Date;
};

function NotificationFailuresPanel({ failures }: { failures: NotificationFailureRow[] }) {
  if (!failures.length) return null;

  return (
    <section className="rounded-md border border-red-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Bell className="h-5 w-5 text-[#ED1C24]" aria-hidden="true" />
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">Notification delivery</p>
          <h2 className="text-lg font-black text-[#111827]">Recent delivery failures</h2>
        </div>
      </div>
      <p className="mb-4 text-sm leading-6 text-[#4B5563]">
        These notification INSERTs failed. Check the error column — a common cause is a stale foreign key constraint referencing <code className="rounded bg-[#F5F6F8] px-1 font-mono text-xs">auth.users</code>. Apply migration <code className="rounded bg-[#F5F6F8] px-1 font-mono text-xs">20260609000001_fix_notifications_fk.sql</code> to remove those constraints.
      </p>
      <div className="divide-y divide-[#E5E7EB]">
        {failures.map((row) => (
          <div key={row.id} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
            <div>
              <p className="text-xs font-black uppercase text-[#4B5563]">Event</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-[#111827]">{row.event_key ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-[#4B5563]">Recipient</p>
              <p className="mt-0.5 font-mono text-xs text-[#4B5563]">{row.recipient_user_id ? `${row.recipient_user_id.slice(0, 8)}…` : "—"}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-[#4B5563]">Error</p>
              <p className="mt-0.5 break-words text-sm leading-5 text-red-700">{row.error_message ? row.error_message.slice(0, 120) : "No error message recorded"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#4B5563]">{formatRelative(row.attempted_at)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentActivityPanel({ logs }: { logs: Array<{ id: string; action: string; summary: string; created_at: Date }> }) {
  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
      <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-[#ED1C24]" aria-hidden="true" />
          <h2 className="text-lg font-black text-[#111827]">Recent system activity</h2>
        </div>
        {logs.length ? (
          <div className="divide-y divide-[#E5E7EB]">
            {logs.map((log) => (
              <div key={log.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={log.action} tone="blue" />
                  <span className="text-xs font-semibold text-[#4B5563]">{formatRelative(log.created_at)}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-[#111827]">{log.summary}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No recent activity" message="Audit activity will appear here as users work in the system." />
        )}
      </div>
      <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Bell className="h-5 w-5 text-[#ED1C24]" aria-hidden="true" />
          <h2 className="text-lg font-black text-[#111827]">Monitoring workflow</h2>
        </div>
        <div className="space-y-3">
          <MonitoringStep label="1. Review red cards first" detail="Critical issues, failed notifications, and unresolved errors are the first priority." />
          <MonitoringStep label="2. Mark status as investigating" detail="Use this when IT has seen the issue but still needs follow-up." />
          <MonitoringStep label="3. Resolve with notes" detail="Keep a short record of the fix so repeated problems can be identified later." />
        </div>
      </div>
    </section>
  );
}

function MonitoringStep({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
      <p className="text-sm font-black text-[#111827]">{label}</p>
      <p className="mt-1 text-sm leading-6 text-[#4B5563]">{detail}</p>
    </div>
  );
}

function ManualIssuePanel() {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Plus className="h-5 w-5 text-[#ED1C24]" aria-hidden="true" />
        <h2 className="text-lg font-black text-[#111827]">Add day-to-day issue</h2>
      </div>
      <p className="mt-1 text-sm leading-6 text-[#4B5563]">Use this for IT notes, user-reported problems, deployment observations, or manual reliability tracking.</p>
      <form action={createManualSystemIssueAction} className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <select className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" name="severity" defaultValue="warning">
            {["info", "warning", "error", "critical"].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input className="focus-ring min-h-10 rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" name="source" placeholder="Source, e.g. user.report" />
        </div>
        <input className="focus-ring min-h-10 w-full rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" name="route" placeholder="Related route, optional" />
        <textarea className="focus-ring min-h-24 w-full rounded-md border border-[#DDE2EA] px-3 py-2 text-sm" name="message" placeholder="Describe the issue clearly" required />
        <Button type="submit">Create issue</Button>
      </form>
    </section>
  );
}

function SecurityOverview({
  activeSessions,
  failedLoginsToday,
  lockedAccounts,
  latestBackup
}: {
  activeSessions: number;
  failedLoginsToday: number;
  lockedAccounts: number;
  latestBackup: BackupLogRow | null;
}) {
  const hasAlerts = failedLoginsToday > 0 || lockedAccounts > 0;
  const backupInfo = getBackupInfo(latestBackup);

  return (
    <section className="rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#ED1C24]" aria-hidden="true" />
          <div>
            <p className="text-xs font-black uppercase text-[#ED1C24]">Access security</p>
            <h2 className="text-lg font-black text-[#111827]">Authentication and session overview</h2>
          </div>
        </div>
        {hasAlerts && (
          <span className="w-fit rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700">
            Attention required
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* Active sessions */}
        <div className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-black uppercase text-[#4B5563]">Active sessions</p>
            <Users className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-black text-[#111827]">{activeSessions}</p>
          <p className="mt-1 text-xs text-[#4B5563]">Valid, non-expired sessions right now</p>
        </div>

        {/* Failed logins today */}
        <div className={cn("rounded-md border p-3", failedLoginsToday > 0 ? "border-amber-200 bg-amber-50" : "border-[#E5E7EB] bg-[#F8FAFC]")}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-black uppercase text-[#4B5563]">Failed logins today</p>
            <KeyRound className={cn("h-4 w-4 shrink-0", failedLoginsToday > 0 ? "text-amber-600" : "text-[#4B5563]")} aria-hidden="true" />
          </div>
          <p className={cn("mt-2 text-2xl font-black", failedLoginsToday > 0 ? "text-amber-700" : "text-[#111827]")}>{failedLoginsToday}</p>
          <p className="mt-1 text-xs text-[#4B5563]">auth.login_failed events since midnight</p>
        </div>

        {/* Locked accounts */}
        <div className={cn("rounded-md border p-3", lockedAccounts > 0 ? "border-red-200 bg-red-50" : "border-[#E5E7EB] bg-[#F8FAFC]")}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-black uppercase text-[#4B5563]">Locked accounts</p>
            <Lock className={cn("h-4 w-4 shrink-0", lockedAccounts > 0 ? "text-red-600" : "text-[#4B5563]")} aria-hidden="true" />
          </div>
          <p className={cn("mt-2 text-2xl font-black", lockedAccounts > 0 ? "text-red-700" : "text-[#111827]")}>{lockedAccounts}</p>
          <p className="mt-1 text-xs text-[#4B5563]">Accounts currently locked (locked_until &gt; now)</p>
        </div>

        {/* Backup status — live from backup_logs */}
        <div className={cn(
          "rounded-md border p-3",
          backupInfo.tone === "green" ? "border-green-200 bg-green-50"
            : backupInfo.tone === "red" ? "border-red-200 bg-red-50"
            : backupInfo.tone === "blue" ? "border-blue-200 bg-blue-50"
            : "border-amber-200 bg-amber-50"
        )}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-black uppercase text-[#4B5563]">Backup status</p>
            <HardDrive className={cn(
              "h-4 w-4 shrink-0",
              backupInfo.tone === "green" ? "text-green-600"
                : backupInfo.tone === "red" ? "text-red-600"
                : backupInfo.tone === "blue" ? "text-blue-600"
                : "text-amber-600"
            )} aria-hidden="true" />
          </div>
          <p className={cn(
            "mt-2 text-sm font-black",
            backupInfo.tone === "green" ? "text-green-700"
              : backupInfo.tone === "red" ? "text-red-700"
              : backupInfo.tone === "blue" ? "text-blue-700"
              : "text-amber-700"
          )}>{backupInfo.value}</p>
          <p className="mt-1 text-xs leading-5 text-[#4B5563]">{backupInfo.detail}</p>
          {backupInfo.completedAt ? (
            <p className="mt-1 text-xs text-[#4B5563]">{formatRelative(backupInfo.completedAt)}</p>
          ) : null}
          {backupInfo.fileSizeMb !== null ? (
            <p className="mt-1 text-xs text-[#4B5563]">{backupInfo.fileSizeMb.toFixed(3)} MB</p>
          ) : null}
          {backupInfo.filePath ? (
            <p className="mt-1 break-all font-mono text-[10px] text-[#4B5563]">{backupInfo.filePath}</p>
          ) : null}
          {backupInfo.errorMessage ? (
            <p className="mt-1 break-words text-xs leading-5 text-red-700">{backupInfo.errorMessage.slice(0, 100)}</p>
          ) : null}
          {backupInfo.value === "Not Configured" ? (
            <p className="mt-1 text-xs leading-5 text-amber-700">
              Run <code className="rounded bg-amber-100 px-1 font-mono">scripts\backup-db.ps1</code> via Task Scheduler.
            </p>
          ) : null}
        </div>
      </div>

      {lockedAccounts > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-red-800">
            <span className="font-black">{lockedAccounts} account{lockedAccounts !== 1 ? "s are" : " is"} currently locked.</span>{" "}
            Accounts auto-unlock after 15 minutes. If a user is legitimately locked out, an IT Admin can reset their password via{" "}
            <span className="font-mono">npm run auth:set-password</span>.
          </p>
        </div>
      )}
    </section>
  );
}

function IssueTable({ issues, page, total, params }: { issues: system_error_logs[]; page: number; total: number; params: { severity: string; status: string; source: string; search: string } }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
        <div>
          <p className="text-xs font-black uppercase text-[#4B5563]">Issue log</p>
          <p className="text-sm font-semibold text-[#111827]">Operational issues, crashes, and workflow failures</p>
        </div>
        <StatusBadge label={`Page ${page} of ${totalPages}`} tone="blue" />
      </div>
      {issues.length ? (
        <div className="divide-y divide-[#E5E7EB]">
          {issues.map((issue) => {
            const href = entityHref(issue);
            return (
              <div key={issue.id} className="grid gap-4 p-4 xl:grid-cols-[1fr_340px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={issue.severity} tone={severityTone(issue.severity)} />
                    <StatusBadge label={issue.status} tone={statusTone(issue.status)} />
                    <span className="text-xs font-semibold text-[#4B5563]">{formatRelative(issue.created_at)}</span>
                  </div>
                  <h3 className="mt-2 font-black text-[#111827]">{issue.message}</h3>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-[#4B5563]">
                    <span>Source: {issue.source}</span>
                    {issue.route ? <span>Route: {issue.route}</span> : null}
                    {href ? <Link href={href} className="text-[#2563EB] hover:text-[#ED1C24]">Open related record</Link> : null}
                  </div>
                  {issue.stack ? <details className="mt-3 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3 text-xs text-[#4B5563]"><summary className="cursor-pointer font-bold text-[#111827]">Stack / technical detail</summary><pre className="mt-2 whitespace-pre-wrap break-words">{issue.stack.slice(0, 1600)}</pre></details> : null}
                  {issue.resolution_notes ? <p className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">Resolution note: {issue.resolution_notes}</p> : null}
                </div>
                <form action={updateSystemIssueStatusAction} className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                  <input type="hidden" name="issue_id" value={issue.id} />
                  <label className="text-xs font-black uppercase text-[#4B5563]" htmlFor={`status-${issue.id}`}>Triage status</label>
                  <select id={`status-${issue.id}`} className="focus-ring mt-2 min-h-10 w-full rounded-md border border-[#DDE2EA] bg-white px-3 py-2 text-sm" name="status" defaultValue={issue.status}>
                    {["open", "investigating", "resolved", "ignored"].map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <textarea className="focus-ring mt-3 min-h-20 w-full rounded-md border border-[#DDE2EA] bg-white px-3 py-2 text-sm" name="resolution_notes" defaultValue={issue.resolution_notes ?? ""} placeholder="Resolution or investigation note" />
                  <Button type="submit" variant="secondary" className="mt-3 w-full">Save status</Button>
                </form>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-4">
          <EmptyState title="No system issues found" message="Try changing filters, or create a manual issue for day-to-day tracking." />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] p-3 text-sm font-semibold text-[#4B5563]">
        <Link className={paginationClass(page <= 1)} href={healthHref({ ...params, page: Math.max(1, page - 1) })} aria-disabled={page <= 1}>Previous</Link>
        <span>{total} issues / Page {page} of {totalPages}</span>
        <Link className={paginationClass(page >= totalPages)} href={healthHref({ ...params, page: Math.min(totalPages, page + 1) })} aria-disabled={page >= totalPages}>Next</Link>
      </div>
    </section>
  );
}

function healthHref({ severity, status, source, search, page }: { severity: string; status: string; source: string; search: string; page: number }) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (severity) params.set("severity", severity);
  if (status) params.set("status", status);
  if (source) params.set("source", source);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/system-health?${qs}` : "/admin/system-health";
}

function paginationClass(disabled: boolean) {
  return cn(
    "rounded-md border border-[#DDE2EA] px-4 py-2 text-sm font-bold",
    disabled ? "pointer-events-none bg-gray-50 text-gray-400" : "bg-white text-[#111827] hover:bg-gray-50"
  );
}
