import "server-only";

import { prisma } from "@/lib/db/prisma";

export type DeletionImpact = {
  workOrdersCreated:     number;
  approvalsDecided:      number;
  workOrderAssignments:  number;
  auditLogsActed:        number;
  partsRequestsLinked:   number;
  purchaseRequestsLinked: number;
  technicianNotes:       number;
  totalSessions:         number;
  /** true only when no linked business records exist */
  canPermanentDelete:    boolean;
};

type ImpactRow = {
  work_orders_created:      bigint | number;
  approvals_decided:        bigint | number;
  work_order_assignments:   bigint | number;
  audit_logs_acted:         bigint | number;
  parts_requests_linked:    bigint | number;
  purchase_requests_linked: bigint | number;
  technician_notes:         bigint | number;
  total_sessions:           bigint | number;
};

/**
 * Returns counts of every table linked to a profile so callers can decide
 * whether archiving or permanent deletion is safe.
 * Permanent deletion is only safe when canPermanentDelete === true (no
 * business history exists).  The UI never exposes a permanent-delete button
 * for Super Admin accounts regardless of this flag.
 */
export async function getUserDeletionImpact(profileId: string): Promise<DeletionImpact> {
  const rows = await prisma.$queryRaw<ImpactRow[]>`
    select
      (select count(*) from public.work_orders
         where created_by = ${profileId}::uuid)::int          as work_orders_created,

      (select count(*) from public.approvals
         where decided_by = ${profileId}::uuid)::int          as approvals_decided,

      (select count(*) from public.work_order_assignments
         where technician_id = ${profileId}::uuid)::int       as work_order_assignments,

      (select count(*) from public.audit_logs
         where actor_id = ${profileId}::uuid)::int            as audit_logs_acted,

      (select count(*) from public.parts_requests
         where created_by  = ${profileId}::uuid
            or approved_by = ${profileId}::uuid
            or requested_by = ${profileId}::uuid
            or prepared_by  = ${profileId}::uuid)::int        as parts_requests_linked,

      (select count(*) from public.purchase_requests
         where created_by          = ${profileId}::uuid
            or finance_approved_by = ${profileId}::uuid
            or ceo_approved_by     = ${profileId}::uuid)::int as purchase_requests_linked,

      (select count(*) from public.work_order_technician_notes
         where technician_id = ${profileId}::uuid)::int       as technician_notes,

      (select count(*) from public.auth_sessions
         where profile_id = ${profileId}::uuid)::int          as total_sessions
  `;

  const r = rows[0];

  const n = (v: bigint | number) => Number(v);

  const workOrdersCreated     = n(r.work_orders_created);
  const approvalsDecided      = n(r.approvals_decided);
  const workOrderAssignments  = n(r.work_order_assignments);
  const auditLogsActed        = n(r.audit_logs_acted);
  const partsRequestsLinked   = n(r.parts_requests_linked);
  const purchaseRequestsLinked = n(r.purchase_requests_linked);
  const technicianNotes       = n(r.technician_notes);
  const totalSessions         = n(r.total_sessions);

  // work_order_technician_notes.technician_id is ON DELETE CASCADE (unlike
  // every other table checked here, which is ON DELETE NO ACTION/RESTRICT
  // and would simply block a permanent delete at the database level). A
  // technician's Job Card notes must be included here explicitly — the DB
  // would otherwise silently destroy that history instead of erroring.
  const hasHistory =
    workOrdersCreated     > 0 ||
    approvalsDecided      > 0 ||
    workOrderAssignments  > 0 ||
    auditLogsActed        > 0 ||
    partsRequestsLinked   > 0 ||
    purchaseRequestsLinked > 0 ||
    technicianNotes       > 0;

  return {
    workOrdersCreated,
    approvalsDecided,
    workOrderAssignments,
    auditLogsActed,
    partsRequestsLinked,
    purchaseRequestsLinked,
    technicianNotes,
    totalSessions,
    canPermanentDelete: !hasHistory,
  };
}

/**
 * Count of non-archived System Administrator profiles. Used to block
 * deleting (or, in principle, demoting) the last remaining admin account.
 */
export async function countActiveSuperAdmins(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    select count(*)::bigint as count
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where r.slug = 'super_admin'
      and p.deleted_at is null
  `;
  return Number(rows[0]?.count ?? 0);
}
