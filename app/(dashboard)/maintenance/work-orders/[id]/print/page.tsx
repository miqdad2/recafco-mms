import { notFound } from "next/navigation";

import { FormDocumentHeader } from "@/components/forms/form-document-header";
import { PrintScreenActions } from "@/components/work-orders/print-screen-actions";
import { writeAuditLog } from "@/lib/audit/log";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { formatDate, formatDateTime } from "@/lib/utils";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { displaySimplifiedStatus } from "@/lib/work-orders/simplified-status-display";
import { deriveSimpleWorkerState } from "@/lib/work-orders/hours-variance";
import { getMaterialFulfillmentForWorkOrder, anyMaterialsIncomplete } from "@/lib/work-orders/material-fulfillment";

export default async function PrintWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("work_orders.print");
  const { id } = await params;

  // Enforce visibility before handing off to the Prisma query.
  // Uses the same role-scoped filter as the list and detail pages so access
  // is consistent regardless of which page the user reaches first.
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const accessible = await prisma.work_orders.findFirst({
    where: { AND: [{ id }, { deleted_at: null }, visibilityFilter] },
    select: { id: true },
  });
  if (!accessible) notFound();

  const [rawWo, rawLegacyLabor, rawMaterials, rawApprovals, rawWorkerAssignments, rawWorkSessions, rawTechAssignments, materialFulfillment] =
    await Promise.all([
      prisma.work_orders.findUnique({
        where: { id },
        include: {
          assets: { select: { asset_code: true, asset_name: true } },
          departments: { select: { name: true } }
        }
      }),
      prisma.work_order_labor.findMany({ where: { work_order_id: id }, orderBy: { created_at: "asc" } }),
      // Unit 10G.57, Task 3/4 — audited: this is the free-form "Record
      // Material Used" quick-log (app/actions/maintenance.ts's
      // addWorkOrderMaterialAction and the Job Card edit form), still
      // actively written today — NOT a dead table. It is genuinely
      // different from, and additional to, the Required Materials/Issue
      // workflow Daily Activity and the Job Card detail page's main
      // Materials tab track (see materialFulfillment below): Offline
      // Inventory Control's own Issue Material action never writes a row
      // here. Kept as one of two real sources merged below so a manually
      // logged "material used" entry never silently disappears from print.
      prisma.work_order_materials.findMany({ where: { work_order_id: id }, orderBy: { created_at: "asc" } }),
      // Job Card status history (work_order_status_history) is not written
      // to by any current backend function — a dead legacy table (see
      // app/actions/closed-job-cards.ts's own note on this). The compact
      // Status History / Approval sections below are derived instead from
      // real, actively-written sources: approvals rows (Closure Requested /
      // Closed) and work_order_materials.created_at (materials issued).
      prisma.approvals.findMany({ where: { work_order_id: id }, orderBy: { decided_at: "asc" } }),
      // Internal Team labor roster — Worker Timer and Closure Logic
      // Hardening Unit 10G.53, Task 11: widened from "active"-only to also
      // include "finished" (same as lib/work-orders/work-session-totals.ts's
      // getWorkOrderLaborSummary/Bulk) so a worker who has finished their
      // work still prints, with a "Finished" status — only "removed" rows
      // (taken off the roster entirely) are excluded.
      prisma.workOrderWorkerAssignment.findMany({
        where: { work_order_id: id, status: { in: ["active", "finished"] } },
        include: { worker_profiles: true },
        orderBy: [{ worker_role: "asc" }, { assigned_at: "asc" }]
      }),
      prisma.workOrderWorkSession.findMany({
        where: { work_order_id: id, status: { not: "Cancelled" } },
        orderBy: { started_at: "asc" }
      }),
      // Internal Technician self-service / Freelancer / External Company
      // assignment — the detail page's fallback when no Internal Team
      // roster exists.
      prisma.work_order_assignments.findMany({ where: { work_order_id: id }, include: { profiles: true }, orderBy: { assigned_at: "asc" } }),
      // Unit 10G.57, Task 3/4 — the SECOND, primary real source: the exact
      // same Required Materials + Offline Inventory issuance read Daily
      // Activity and the Job Card detail page's main Materials tab already
      // use (lib/work-orders/material-fulfillment.ts, unchanged — no
      // duplicated calculation). Before this unit the print page never read
      // this at all, so a Job Card whose materials were only ever issued
      // through the real Issue Material workflow (the common case) printed
      // "No material used" even though materials genuinely were issued.
      getMaterialFulfillmentForWorkOrder(prisma, id)
    ]);

  if (!rawWo) return <div className="p-8">Job Card not found.</div>;

  const decidedByIds = [...new Set(rawApprovals.map((a) => a.decided_by).filter((v): v is string => Boolean(v)))];
  const decidedByProfiles = decidedByIds.length
    ? await prisma.profiles.findMany({ where: { id: { in: decidedByIds } }, select: { id: true, full_name: true } })
    : [];
  const nameById = new Map(decidedByProfiles.map((p) => [p.id, p.full_name]));

  await writeAuditLog({
    actorId: context.userId,
    action: "work_order.print",
    entityType: "work_order",
    entityId: id,
    summary: `Opened print view for Job Card ${rawWo.work_order_number}`
  });

  const asset = Array.isArray(rawWo.assets) ? rawWo.assets[0] : rawWo.assets;
  const department = Array.isArray(rawWo.departments) ? rawWo.departments[0] : rawWo.departments;

  // ── Work Team and Time (Task 7) ─────────────────────────────────────────
  // One combined roster + time-tracking table, built from whichever source
  // actually has data for this Job Card — never both, mirroring the mutual
  // exclusivity the Job Card detail page's Assignment tab already assumes
  // (hasInternalTeam ? internal roster : work_order_assignments).
  type WorkerRow = { name: string; employeeNo: string; type: string; start: string; end: string; hours: string; notes: string };
  const workerRows: WorkerRow[] = [];
  const handledTechnicianIds = new Set<string>();

  if (rawWorkerAssignments.length) {
    const sessionsByAssignment = new Map<string, typeof rawWorkSessions>();
    for (const s of rawWorkSessions) {
      const list = sessionsByAssignment.get(s.worker_assignment_id) ?? [];
      list.push(s);
      sessionsByAssignment.set(s.worker_assignment_id, list);
    }

    for (const a of rawWorkerAssignments) {
      const sessions = sessionsByAssignment.get(a.id) ?? [];
      const totalMinutes = sessions.reduce((sum, s) => sum + s.duration_minutes, 0);
      const activeSession = sessions.find((s) => s.status === "Active") ?? null;
      const earliestStart = sessions.length ? sessions[0].started_at : null;
      const latestEnd = sessions.reduce<Date | null>((max, s) => {
        const end = s.stopped_at ?? s.paused_at;
        if (!end) return max;
        return !max || end > max ? end : max;
      }, null);

      // Unit 10G.53, Task 11: same 4-state model as everywhere else
      // (Not Started/Working/Paused/Finished) — a raw session status of
      // "Completed" prints as "In progress"'s opposite, "Not recorded"/
      // "Not Started"'s sibling below, not as a separate technical status.
      const sessionStatus = activeSession ? "Active" : sessions.length ? sessions[sessions.length - 1].status : "Not Started";
      const simpleState = deriveSimpleWorkerState(a.status, sessionStatus);
      const notes = simpleState === "Working" ? "In Progress" : simpleState;

      workerRows.push({
        name: a.worker_profiles.name,
        employeeNo: a.worker_profiles.employee_id ?? "-",
        type: a.worker_role,
        start: earliestStart ? formatDateTime(earliestStart.toISOString()) : "Not recorded",
        end: activeSession ? "In progress" : latestEnd ? formatDateTime(latestEnd.toISOString()) : "Not recorded",
        hours: (totalMinutes / 60).toFixed(2),
        notes
      });
    }
  } else if (rawTechAssignments.length) {
    const laborHoursByTechnician = new Map<string, number>();
    for (const l of rawLegacyLabor) {
      if (!l.technician_id) continue;
      laborHoursByTechnician.set(l.technician_id, (laborHoursByTechnician.get(l.technician_id) ?? 0) + Number(l.hours));
      handledTechnicianIds.add(l.technician_id);
    }

    for (const a of rawTechAssignments) {
      const isInternal = a.assignment_type === "INTERNAL_TECHNICIAN";
      const isFreelancer = a.assignment_type === "FREELANCER";
      const name = isInternal ? a.profiles?.full_name ?? "Unknown technician" : isFreelancer ? a.external_name ?? "Freelancer" : a.external_company ?? "External company";
      const hours = a.technician_id ? laborHoursByTechnician.get(a.technician_id) : undefined;

      workerRows.push({
        name,
        employeeNo: isInternal ? a.profiles?.employee_number ?? "-" : "-",
        type: isInternal ? "Internal Technician" : isFreelancer ? "Freelancer" : "External Company",
        start: "Not recorded",
        end: "Not recorded",
        hours: hours !== undefined ? hours.toFixed(2) : "Not recorded",
        notes: a.notes || "Assigned"
      });
    }
  }

  // Any technician-logged hours not already folded into a roster/assignment
  // row above (e.g. a reassigned Job Card) still get shown — worker hours
  // that were actually logged must never silently disappear from print.
  const unclaimedLabor = new Map<string, { name: string; employeeNo: string; hours: number }>();
  for (const l of rawLegacyLabor) {
    if (l.technician_id && handledTechnicianIds.has(l.technician_id)) continue;
    const key = l.technician_id ?? `${l.labor_name}|${l.employee_number ?? ""}`;
    const existing = unclaimedLabor.get(key);
    if (existing) existing.hours += Number(l.hours);
    else unclaimedLabor.set(key, { name: l.labor_name, employeeNo: l.employee_number ?? "-", hours: Number(l.hours) });
  }
  for (const entry of unclaimedLabor.values()) {
    workerRows.push({
      name: entry.name,
      employeeNo: entry.employeeNo,
      type: "Technician",
      start: "Not recorded",
      end: "Not recorded",
      hours: entry.hours.toFixed(2),
      notes: "Logged hours"
    });
  }

  // ── Status History and Approval / Closure (Tasks 9-10) ──────────────────
  const closureRequestedApproval = [...rawApprovals].reverse().find((a) => a.status === "Closure Requested") ?? null;
  const closedApproval = [...rawApprovals].reverse().find((a) => a.status === "Closed") ?? null;
  const materialsIssuedAt = rawMaterials.length
    ? rawMaterials.reduce((max, m) => (m.created_at > max ? m.created_at : max), rawMaterials[0].created_at)
    : null;

  const statusHistoryRows = (
    [
      ["Created", formatDateTime(rawWo.created_at.toISOString())],
      ...(materialsIssuedAt ? ([["Materials Issued", formatDateTime(materialsIssuedAt.toISOString())]] as Array<[string, string]>) : []),
      ...(closureRequestedApproval
        ? ([["Closure Requested", formatDateTime(closureRequestedApproval.decided_at.toISOString())]] as Array<[string, string]>)
        : []),
      ...(closedApproval ? ([["Closed", formatDateTime(closedApproval.decided_at.toISOString())]] as Array<[string, string]>) : [])
    ] as Array<[string, string]>
  ).slice(0, 5);

  const approvalRows: Array<[string, string]> = [
    ["Current status", displaySimplifiedStatus(rawWo.status)],
    ...(closureRequestedApproval
      ? ([
          ["Closure requested by", nameById.get(closureRequestedApproval.decided_by ?? "") ?? "Unknown"],
          ["Closure requested at", formatDateTime(closureRequestedApproval.decided_at.toISOString())]
        ] as Array<[string, string]>)
      : []),
    ...(closedApproval
      ? ([
          ["Closed by", nameById.get(closedApproval.decided_by ?? "") ?? "Unknown"],
          ["Closed at", formatDateTime(closedApproval.decided_at.toISOString())]
        ] as Array<[string, string]>)
      : []),
    ["Comments", closedApproval?.comments || closureRequestedApproval?.comments || "Not recorded"]
  ];

  // ── Job Card Details grid (Task 5) ───────────────────────────────────────
  // Core identifying fields always shown; "if available" fields are simply
  // omitted when empty instead of printing an empty "Not recorded" cell, so
  // the grid never grows with blank rows.
  const detailRows: Array<[string, string]> = [
    ["Reported by", rawWo.ordered_by || "Not recorded"],
    ["Date of Job Card", formatDate(rawWo.date_of_order)],
    ...(department?.name ? ([["Department", department.name]] as Array<[string, string]>) : []),
    ["Asset", asset ? `${asset.asset_code} - ${asset.asset_name}` : "Not recorded"],
    ...(rawWo.asset_category ? ([["Asset Type", rawWo.asset_category]] as Array<[string, string]>) : []),
    ...(rawWo.serial_number ? ([["Serial Number", rawWo.serial_number]] as Array<[string, string]>) : []),
    ...(rawWo.plate_number ? ([["Plate Number", rawWo.plate_number]] as Array<[string, string]>) : []),
    ["Job Location", rawWo.job_location || "Not recorded"],
    ["Maintenance Type", rawWo.maintenance_type || "Not recorded"],
    ...(rawWo.running_hours ? ([["Running Hours", rawWo.running_hours.toFixed(2)]] as Array<[string, string]>) : []),
    ...(rawWo.kilometers ? ([["Kilometers", rawWo.kilometers.toFixed(2)]] as Array<[string, string]>) : []),
    ...(rawWo.worker_type ? ([["Worker Type", rawWo.worker_type]] as Array<[string, string]>) : []),
    ...(rawWo.starting_datetime ? ([["Start", formatDateTime(rawWo.starting_datetime.toISOString())]] as Array<[string, string]>) : []),
    ...(rawWo.ending_datetime ? ([["End", formatDateTime(rawWo.ending_datetime.toISOString())]] as Array<[string, string]>) : [])
  ];

  const nextServiceRows: Array<[string, string]> = [
    ...(rawWo.next_service_date ? ([["Next service date", formatDate(rawWo.next_service_date)]] as Array<[string, string]>) : []),
    ...(rawWo.next_service_kilometer
      ? ([["Next service kilometer", rawWo.next_service_kilometer.toFixed(2)]] as Array<[string, string]>)
      : []),
    ...(rawWo.next_service_running_hours
      ? ([["Next service running hours", rawWo.next_service_running_hours.toFixed(2)]] as Array<[string, string]>)
      : [])
  ];

  // ── Material Used (Unit 10G.57, Task 3/4) ────────────────────────────────
  // Merges the two real, currently-written sources rather than picking one:
  // (1) Required Materials rows actually issued (issued_qty > 0) — the same
  // read Daily Activity/the Job Card detail page's Materials tab use — and
  // (2) the free-form "Record Material Used" quick-log (work_order_materials,
  // see the fetch comment above). A Job Card can have real data in either,
  // both, or neither; showing only one silently drops genuinely-used
  // materials, which was the actual bug this task describes.
  const issuedRequiredParts = materialFulfillment.filter((f) => f.issued_qty > 1e-9);
  const issuedPartIds = [...new Set(issuedRequiredParts.map((f) => f.part_id).filter((v): v is string => Boolean(v)))];
  const ssRecCodeByPartId = issuedPartIds.length
    ? new Map(
        (await prisma.parts.findMany({ where: { id: { in: issuedPartIds } }, select: { id: true, ss_rec_code: true } })).map((p) => [
          p.id,
          p.ss_rec_code
        ])
      )
    : new Map<string, string | null>();

  type MaterialRow = { id: string; name: string; partNo: string | null; ssRecCode: string | null; qty: string };
  const materials: MaterialRow[] = [
    ...issuedRequiredParts.map(
      (f): MaterialRow => ({
        id: f.id,
        name: f.description,
        partNo: f.part_number,
        ssRecCode: f.part_id ? ssRecCodeByPartId.get(f.part_id) ?? null : null,
        qty: f.issued_qty.toFixed(2)
      })
    ),
    ...rawMaterials.map(
      (row): MaterialRow => ({
        id: row.id,
        name: row.material_name,
        partNo: row.part_number,
        ssRecCode: row.ss_rec_code,
        qty: row.quantity.toFixed(2)
      })
    )
  ];
  // Task 3's exact 3 cases: something was actually used (table); nothing
  // used yet but materials ARE required (Materials pending); nothing
  // required or used at all (No material used) — never the last one when
  // the first two arrays above prove otherwise.
  const materialsPendingOnly = materials.length === 0 && materialFulfillment.length > 0 && anyMaterialsIncomplete(materialFulfillment);
  const materialsPartiallyPending = materials.length > 0 && anyMaterialsIncomplete(materialFulfillment);

  const detailHref = `/maintenance/work-orders/${id}`;

  // ── Signature spacer sizing (Unit 10G.57C, Task 3) ───────────────────────
  // 10G.57A/10G.57B's flex + margin-top:auto "sticky footer" was found in
  // real Chrome print preview to still push Signatures to page 2 even with a
  // large blank gap on page 1 (see the @media print comment below for why).
  // Replaced with a fixed, content-size-aware spacer instead: a plain block
  // element with a static height, placed once, right before Signatures. It
  // can never itself force or prevent a page break (break-inside: auto), so
  // it carries none of the previous approach's page-1/page-2 boundary risk —
  // worst case it just adds harmless blank space. Tiers deliberately favor
  // NOT causing a page 2 over being flush to the bottom (Task 9's stated
  // priority): a short Job Card gets the largest spacer, a merely-longer one
  // gets a smaller spacer, and a genuinely large one gets none at all so its
  // real content is never pushed to page 2 by an artificial gap.
  const complaintTextLength = (rawWo.operator_complaint?.length ?? 0) + (rawWo.description_of_work?.length ?? 0);
  const hasLongComplaintText = complaintTextLength > 400;
  const workerCount = workerRows.length;
  const materialCount = materials.length;
  const signatureSpacerClass: "signature-spacer-normal" | "signature-spacer-small" | null =
    workerCount > 5 || materialCount > 10
      ? null
      : workerCount > 4 || materialCount > 6 || hasLongComplaintText
        ? "signature-spacer-small"
        : "signature-spacer-normal";

  return (
    <div className="min-h-screen bg-[#F3F5F8] px-4 py-6 text-[#111827] print:min-h-0 print:bg-white print:p-0">
      {/* Unit 10G.57, Task 1/2/7/8 — the two class names the task itself
          specifies (.screen-only for content that should stay on screen
          only, .no-print for the screen chrome/buttons) do the exact same
          thing; kept as two names anyway so the markup below signals intent
          clearly. @page margin brought to 8mm (was 9mm) per Task 7's exact
          spec. Task 8: tables now get their own print rules instead of the
          old blanket "whole section can never break" — a real, unbounded
          table needs its header repeated per page (thead as a repeating
          table-header-group) and every ROW individually protected from
          splitting across a page break, not the entire table forced onto
          one page. Sections that are genuinely small/bounded (Job Card
          Details, complaint/description boxes, Signatures) keep the
          original "never break this block" treatment via .avoid-break. */}
      {/* Signature placement history — Unit 10G.57A introduced a flex
          column + margin-top: auto "sticky footer" to bottom-align
          Signatures on page 1 for short Job Cards. Unit 10G.57B tried to fix
          a page-2 regression in that approach by shrinking the flex box's
          min-height (281mm -> 271mm) to add clearance below the exact page
          boundary. Real Chrome print preview showed Signatures could still
          jump to page 2 with a large blank gap on page 1 — i.e. flexbox
          fragmentation across a print page boundary, combined with Signatures'
          required page-break-inside: avoid (the three boxes must never be
          sliced apart), was not reliable: any relocation of that block due
          to overflow leaves the space margin-top: auto already spent behind
          it empty, since nothing follows Signatures to reflow into the gap.
          Unit 10G.57C, Task 1/2/3: removes flex/margin-auto entirely for
          print (.print-sheet is back to plain block flow — no
          display:flex, no flex-direction, no min-height) and replaces it
          with a plain, static, content-size-aware spacer block
          (.signature-spacer*, sized in the component body above from real
          worker/material counts) rendered once as an ordinary sibling right
          before Signatures. A plain block element can never itself force or
          prevent a page break, so this carries none of the flex approach's
          page-boundary risk — worst case it only ever adds harmless blank
          space; it never pushes real content anywhere. Signatures keeps its
          own page-break-inside: avoid so the three boxes are still never
          split across a page, and — because a long Job Card gets no spacer
          at all — genuinely long content still flows Signatures onto page 2
          exactly as before, with no overlap risk (still no absolute or
          fixed positioning anywhere). */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          .screen-only, .no-print { display: none !important; }
          aside, header, nav { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; }
          .print-sheet {
            box-sizing: border-box !important;
            border: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
          .signature-spacer { break-inside: auto; page-break-inside: auto; }
          .signature-spacer-normal { height: 35mm; max-height: 35mm; }
          .signature-spacer-small { height: 15mm; max-height: 15mm; }
          .print-signatures { break-inside: avoid; page-break-inside: avoid; }
          .avoid-break { page-break-inside: avoid; break-inside: avoid; }
          .print-table-heading { break-after: avoid; page-break-after: avoid; }
          .print-table thead { display: table-header-group; }
          .print-table tr { page-break-inside: avoid; break-inside: avoid; }
          .signature-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
      `}</style>

      {/* Task 1/2/11 — Back / Open Job Card / Print, screen-only (never
          printed). A real "Print" button (window.print()) replaces the old
          plain text hint. */}
      <PrintScreenActions detailHref={detailHref} />

      <article className="print-sheet mx-auto w-full max-w-[210mm] border border-[#E5E7EB] bg-white p-5 text-[10.5px] leading-snug shadow-sm">
        <div className="avoid-break">
          <FormDocumentHeader
            variant="print"
            compact
            title="Maintenance Job Card"
            departmentName="Maintenance Department"
            subtitle={`Generated: ${formatDateTime(new Date().toISOString())}`}
            referenceLabel="Job Card number"
            referenceNumber={rawWo.work_order_number}
            status={displaySimplifiedStatus(rawWo.status)}
          />
        </div>

        <PrintGrid title="Job Card Details" rows={detailRows} />

        <section className="mt-3 grid gap-2 avoid-break">
          <TextBox title="Operator Complaint" value={rawWo.operator_complaint} />
          <TextBox title="Description of Work" value={rawWo.description_of_work} />
        </section>

        {/* Task 8 — no .avoid-break on this section: a long roster is
            allowed to flow onto page 2 naturally. print-table-heading keeps
            the heading glued to the table that follows it instead of being
            stranded alone at the bottom of a page. */}
        <section className="mt-3">
          <SectionHeading className="print-table-heading">Work Team and Time</SectionHeading>
          {workerRows.length ? (
            <table className="print-table mt-1.5 w-full border-collapse text-left">
              <thead>
                <tr>
                  {["Worker Name", "Employee No.", "Type / Division", "Start Time", "End Time", "Hours", "Notes / Status"].map((h) => (
                    <th key={h} className="border border-[#E5E7EB] bg-gray-50 p-1 text-[9px] font-bold uppercase text-[#4B5563]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workerRows.map((row, i) => (
                  <tr key={i}>
                    <td className="border border-[#E5E7EB] p-1 font-semibold">{row.name}</td>
                    <td className="border border-[#E5E7EB] p-1">{row.employeeNo}</td>
                    <td className="border border-[#E5E7EB] p-1">{row.type}</td>
                    <td className="border border-[#E5E7EB] p-1">{row.start}</td>
                    <td className="border border-[#E5E7EB] p-1">{row.end}</td>
                    <td className="border border-[#E5E7EB] p-1">{row.hours}</td>
                    <td className="border border-[#E5E7EB] p-1">{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">No workers assigned.</p>
          )}
        </section>

        {/* Task 3/4/8 — Material Used: real issued materials from the same
            source Daily Activity/the Job Card detail page use, merged with
            the free-form "Record Material Used" log (see the fetch comments
            above); never both silently dropped to one source. */}
        <section className="mt-3">
          <SectionHeading className="print-table-heading">Material Used</SectionHeading>
          {materials.length ? (
            <>
              <table className="print-table mt-1.5 w-full border-collapse text-left">
                <thead>
                  <tr>
                    {["Material", "Part No.", "SS Rec Code", "Qty"].map((h) => (
                      <th key={h} className="border border-[#E5E7EB] bg-gray-50 p-1 text-[9px] font-bold uppercase text-[#4B5563]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {materials.map((row) => (
                    <tr key={row.id}>
                      <td className="border border-[#E5E7EB] p-1 font-semibold">{row.name}</td>
                      <td className="border border-[#E5E7EB] p-1">{row.partNo ?? "-"}</td>
                      <td className="border border-[#E5E7EB] p-1">{row.ssRecCode ?? "-"}</td>
                      <td className="border border-[#E5E7EB] p-1">{row.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {materialsPartiallyPending ? (
                <p className="mt-1 text-[10px] font-semibold text-amber-700">Some required materials are still pending.</p>
              ) : null}
            </>
          ) : materialsPendingOnly ? (
            <p className="mt-1 text-[10px] font-semibold text-amber-700">Materials pending.</p>
          ) : (
            <p className="mt-1 text-[10px] text-[#6B7280]">No material used.</p>
          )}
        </section>

        {/* Task 5/9 — Status History and Approval and Closure are useful for
            Manager review on screen but are not part of the official
            printed paper; screen-only hides them from print without
            removing them from the screen view. */}
        <div className="screen-only mt-3 grid grid-cols-2 gap-3 avoid-break">
          <div>
            <SectionHeading>Status History</SectionHeading>
            <ul className="mt-1.5 divide-y divide-[#E5E7EB] border border-[#E5E7EB]">
              {statusHistoryRows.map(([label, value]) => (
                <li key={label} className="flex items-center justify-between px-1.5 py-1">
                  <span className="text-[#4B5563]">{label}</span>
                  <span className="font-semibold">{value}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SectionHeading>Approval and Closure</SectionHeading>
            <ul className="mt-1.5 divide-y divide-[#E5E7EB] border border-[#E5E7EB]">
              {approvalRows.map(([label, value]) => (
                <li key={label} className="flex items-center justify-between gap-2 px-1.5 py-1">
                  <span className="shrink-0 text-[#4B5563]">{label}</span>
                  <span className="truncate text-right font-semibold">{value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {nextServiceRows.length ? <PrintGrid title="Next Service" rows={nextServiceRows} cols={3} /> : null}

        {/* Unit 10G.57C, Task 2/3 — screen-only no-op on screen (plain
            document flow, unaffected); in print, a static block whose
            height is picked above from real worker/material/text counts:
            the largest spacer for short content, a smaller one for
            medium content, and none at all (this element isn't rendered)
            for large content — so it only ever adds harmless blank space
            before Signatures and never itself causes a page break. */}
        {signatureSpacerClass ? <div className={signatureSpacerClass} /> : null}

        {/* Task 6/8 — three boxes in one row on a wide enough screen and
            always in print (A4 is always wide enough); stacks to one column
            only on a narrow screen/mobile, never in print. avoid-break
            keeps the whole signature block together as one unit — it still
            simply flows to page 2 if page 1 is already full.
            Unit 10G.57C, Task 1/4: print-signatures no longer participates
            in a flex "sticky footer" (see the @media print block above for
            why that was removed) — it is now a plain block, positioned by
            the .signature-spacer above it, still with page-break-inside:
            avoid so the three boxes are never split across a page. Screen
            layout is unaffected (plain document flow, no forced page
            height). */}
        <section className="print-signatures mt-3 avoid-break">
          <SectionHeading>Signatures</SectionHeading>
          <div className="signature-grid mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SignatureBox label="Operator / Requester Confirmation" value={rawWo.operator_requester_confirmation} />
            <SignatureBox label="Supervisor Verification" value={rawWo.supervisor_verification} />
            <SignatureBox label="Maintenance Manager Closure" value={rawWo.maintenance_manager_closure} />
          </div>
        </section>
      </article>
    </div>
  );
}

function SectionHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`border-b border-[#E5E7EB] pb-1 text-[12px] font-black uppercase tracking-wide ${className}`}>{children}</h2>;
}

function PrintGrid({ title, rows, cols = 3 }: { title: string; rows: Array<[string, string]>; cols?: number }) {
  return (
    <section className="mt-3 avoid-break">
      <SectionHeading>{title}</SectionHeading>
      <div
        className="mt-1.5 grid gap-0 border border-[#E5E7EB]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {rows.map(([label, value]) => (
          <div key={label} className="border-b border-r border-[#E5E7EB] p-1">
            <p className="text-[8.5px] font-bold uppercase text-[#6B7280]">{label}</p>
            <p className="mt-0.5 text-[10px] font-semibold">{value || "Not recorded"}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TextBox({ title, value }: { title: string; value: string | null }) {
  return (
    <div>
      <h3 className="text-[9.5px] font-black uppercase text-[#6B7280]">{title}</h3>
      <p className="mt-0.5 border border-[#E5E7EB] p-1.5 text-[10px]">{value || "Not recorded"}</p>
    </div>
  );
}

function SignatureBox({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-sm border border-[#E5E7EB] p-1.5">
      <p className="text-[8.5px] font-bold uppercase text-[#6B7280]">{label}</p>
      {/* Task 6 — min-h bumped from 6 to 10 for real pen-signature room. */}
      <p className="mt-3 min-h-10 border-t border-dashed border-[#E5E7EB] pt-1 text-[10px] font-semibold">{value || ""}</p>
    </div>
  );
}
