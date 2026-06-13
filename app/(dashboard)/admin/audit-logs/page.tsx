import Link from "next/link";
import { Prisma } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDateTime } from "@/lib/utils";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AuditLogsPageProps = {
  searchParams?: Promise<{ page?: string; action?: string; actor?: string; entity?: string; search?: string }>;
};

const pageSize = 50;

type AuditLogRow = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: Json;
  created_at: Date;
  actor_name: string | null;
  actor_employee_number: string | null;
  actor_email: string | null;
  actor_role: string | null;
  actor_department: string | null;
};

type AuditLogStats = {
  total_records: bigint;
  actor_count: bigint;
  action_count: bigint;
  entity_count: bigint;
};

function entityHref(entityType: string, entityId: string | null) {
  if (!entityId) return null;
  const routes: Record<string, string> = {
    asset: `/assets/${entityId}`,
    department: "/admin/departments",
    parts_request: `/store/parts-requests/${entityId}`,
    profile: "/admin/users",
    purchase_request: `/purchase/requests/${entityId}`,
    work_order: `/maintenance/work-orders/${entityId}`
  };
  return routes[entityType] ?? null;
}

function shortId(value: string | null) {
  return value ? value.slice(0, 8) : "";
}

function metadataDetails(metadata: Json) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const record = metadata as Record<string, unknown>;
  const details: string[] = [];

  if (record.reason) details.push(`Reason: ${String(record.reason)}`);
  if (record.operation) details.push(`Operation: ${String(record.operation)}`);
  if (record.from_status || record.to_status) details.push(`Status: ${String(record.from_status ?? "-")} -> ${String(record.to_status ?? "-")}`);
  if (record.changed_fields && Array.isArray(record.changed_fields) && record.changed_fields.length) {
    details.push(`Fields: ${record.changed_fields.slice(0, 5).map(String).join(", ")}`);
  }
  if (record.email) details.push(`Email: ${String(record.email)}`);
  if (record.fileName) details.push(`File: ${String(record.fileName)}`);
  if (record.bucket) details.push(`Bucket: ${String(record.bucket)}`);

  return details.slice(0, 4);
}

function buildWhere(action: string, actor: string, entity: string, search: string) {
  const filters: Prisma.Sql[] = [];
  if (action) filters.push(Prisma.sql`al.action = ${action}`);
  if (entity) filters.push(Prisma.sql`al.entity_type = ${entity}`);
  if (actor) {
    const actorPattern = `%${actor}%`;
    filters.push(Prisma.sql`(p.full_name ilike ${actorPattern} or p.employee_number ilike ${actorPattern} or au.email ilike ${actorPattern} or r.name ilike ${actorPattern} or d.name ilike ${actorPattern})`);
  }
  if (search) {
    const pattern = `%${search}%`;
    filters.push(Prisma.sql`(al.action ilike ${pattern} or al.entity_type ilike ${pattern} or al.summary ilike ${pattern} or p.full_name ilike ${pattern} or p.employee_number ilike ${pattern} or au.email ilike ${pattern})`);
  }
  return filters.length ? Prisma.sql`where ${Prisma.join(filters, " and ")}` : Prisma.empty;
}

export default async function AuditLogsPage({ searchParams }: AuditLogsPageProps) {
  await requirePermission("admin.audit_logs.view");
  const params = await searchParams;
  const page = Math.max(1, Number(params?.page ?? 1) || 1);
  const action = String(params?.action ?? "").trim().slice(0, 100);
  const actor = String(params?.actor ?? "").trim().slice(0, 100);
  const entity = String(params?.entity ?? "").trim().slice(0, 100);
  const search = String(params?.search ?? "").trim().slice(0, 80);
  const where = buildWhere(action, actor, entity, search);
  const offset = (page - 1) * pageSize;
  const [logs, countRows, statsRows] = await Promise.all([
    prisma.$queryRaw<AuditLogRow[]>(Prisma.sql`
      select
        al.id,
        al.actor_id,
        al.action,
        al.entity_type,
        al.entity_id,
        al.summary,
        al.metadata,
        al.created_at,
        p.full_name as actor_name,
        p.employee_number as actor_employee_number,
        au.email as actor_email,
        r.name as actor_role,
        d.name as actor_department
      from public.audit_logs al
      left join public.profiles p on p.id = al.actor_id
      left join public.auth_users au on au.profile_id = p.id
      left join public.roles r on r.id = p.role_id
      left join public.departments d on d.id = p.department_id
      ${where}
      order by al.created_at desc
      limit ${pageSize} offset ${offset}
    `),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      select count(*)::bigint as count
      from public.audit_logs al
      left join public.profiles p on p.id = al.actor_id
      left join public.auth_users au on au.profile_id = p.id
      left join public.roles r on r.id = p.role_id
      left join public.departments d on d.id = p.department_id
      ${where}
    `),
    prisma.$queryRaw<AuditLogStats[]>(Prisma.sql`
      select
        count(*)::bigint as total_records,
        count(distinct al.actor_id)::bigint as actor_count,
        count(distinct al.action)::bigint as action_count,
        count(distinct al.entity_type)::bigint as entity_count
      from public.audit_logs al
      left join public.profiles p on p.id = al.actor_id
      left join public.auth_users au on au.profile_id = p.id
      left join public.roles r on r.id = p.role_id
      left join public.departments d on d.id = p.department_id
      ${where}
    `)
  ]);
  const count = Number(countRows[0]?.count ?? 0);
  const stats = statsRows[0];
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <>
      <PageHeader title="Audit Logs" description="System-wide audit trail for users, authentication, admin changes, files, exports, and maintenance workflow actions." />
      <div className="p-4 lg:p-6">
        <section className="mb-4 grid gap-3 md:grid-cols-4">
          <AuditMetric label="Matching records" value={Number(stats?.total_records ?? 0)} />
          <AuditMetric label="Actors identified" value={Number(stats?.actor_count ?? 0)} />
          <AuditMetric label="Action types" value={Number(stats?.action_count ?? 0)} />
          <AuditMetric label="Entity types" value={Number(stats?.entity_count ?? 0)} />
        </section>
        <form className="mb-4 grid gap-3 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm lg:grid-cols-[1fr_13rem_13rem_13rem_auto]">
          <input className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="search" defaultValue={params?.search ?? ""} placeholder="Search action, entity, summary" />
          <input className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="action" defaultValue={params?.action ?? ""} placeholder="Exact action" />
          <input className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="actor" defaultValue={params?.actor ?? ""} placeholder="Actor, role, department" />
          <input className="focus-ring rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="entity" defaultValue={params?.entity ?? ""} placeholder="Exact entity type" />
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="px-4 py-3">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {logs.map((log) => {
                  const href = entityHref(log.entity_type, log.entity_id);
                  const details = metadataDetails(log.metadata);
                  return (
                    <tr key={log.id}>
                      <td className="px-4 py-3 text-[#4B5563]">{formatDateTime(log.created_at.toISOString())}</td>
                      <td className="px-4 py-3 font-semibold text-[#111827]">{log.action}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#111827]">{log.entity_type}</div>
                        {href ? (
                          <Link className="text-xs font-semibold text-[#2563EB] hover:underline" href={href}>
                            Open {shortId(log.entity_id)}
                          </Link>
                        ) : log.entity_id ? (
                          <div className="text-xs text-[#4B5563]">{shortId(log.entity_id)}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{log.summary}</td>
                      <td className="px-4 py-3 text-xs leading-5 text-[#4B5563]">
                        {details.length ? (
                          <div className="space-y-1">
                            {details.map((detail) => <div key={detail}>{detail}</div>)}
                          </div>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#111827]">{log.actor_name ?? "System"}</div>
                        {log.actor_name ? (
                          <div className="text-xs leading-5 text-[#4B5563]">
                            {[log.actor_role, log.actor_department, log.actor_employee_number ?? log.actor_email].filter(Boolean).join(" / ")}
                          </div>
                        ) : log.actor_id ? (
                          <div className="text-xs text-[#4B5563]">{shortId(log.actor_id)}</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {!logs.length ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm font-semibold text-[#4B5563]" colSpan={6}>
                      No audit logs match the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
        <Pagination page={page} totalPages={totalPages} search={params?.search} action={action || undefined} actor={actor || undefined} entity={entity || undefined} total={count} />
      </div>
    </>
  );
}

function AuditMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase text-[#4B5563]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#111827]">{value.toLocaleString("en-US")}</p>
    </div>
  );
}

function Pagination({ page, totalPages, search, action, actor, entity, total }: { page: number; totalPages: number; search?: string; action?: string; actor?: string; entity?: string; total: number }) {
  const hrefFor = (nextPage: number) => {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    if (search) params.set("search", search);
    if (action) params.set("action", action);
    if (actor) params.set("actor", actor);
    if (entity) params.set("entity", entity);
    return `/admin/audit-logs?${params.toString()}`;
  };

  return (
    <div className="mt-4 flex items-center justify-between rounded-md border border-[#E5E7EB] bg-white p-3 text-sm font-semibold text-[#4B5563]">
      <span>{total} records / Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        {page > 1 ? <Link className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827]" href={hrefFor(page - 1)}>Previous</Link> : null}
        {page < totalPages ? <Link className="rounded-md border border-[#E5E7EB] px-3 py-2 text-[#111827]" href={hrefFor(page + 1)}>Next</Link> : null}
      </div>
    </div>
  );
}
