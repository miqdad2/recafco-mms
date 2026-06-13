import { notFound } from "next/navigation";

import { FormDocumentHeader } from "@/components/forms/form-document-header";
import { writeAuditLog } from "@/lib/audit/log";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { createQrSvg, internalQrTarget } from "@/lib/qr/svg";
import { formatDateTime } from "@/lib/utils";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";

export default async function PrintWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission("work_orders.print");
  const { id } = await params;

  // Enforce visibility before handing off to Supabase queries.
  // Uses the same role-scoped filter as the list and detail pages so access
  // is consistent regardless of which page the user reaches first.
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  const accessible = await prisma.work_orders.findFirst({
    where: { AND: [{ id }, { deleted_at: null }, visibilityFilter] },
    select: { id: true },
  });
  if (!accessible) notFound();

  const [rawWo, rawLabor, rawMaterials, rawHistory, rawApprovals] = await Promise.all([
    prisma.work_orders.findUnique({
      where: { id },
      include: {
        assets: { select: { asset_code: true, asset_name: true } },
        departments: { select: { name: true } }
      }
    }),
    prisma.work_order_labor.findMany({ where: { work_order_id: id } }),
    prisma.work_order_materials.findMany({ where: { work_order_id: id } }),
    prisma.work_order_status_history.findMany({
      where: { work_order_id: id },
      orderBy: { changed_at: "asc" }
    }),
    prisma.approvals.findMany({
      where: { work_order_id: id },
      orderBy: { created_at: "asc" }
    })
  ]);

  if (!rawWo) return <div className="p-8">Work order not found.</div>;
  const wo = {
    ...rawWo,
    date_of_order: rawWo.date_of_order.toISOString(),
    starting_datetime: rawWo.starting_datetime?.toISOString() ?? null,
    ending_datetime: rawWo.ending_datetime?.toISOString() ?? null,
    running_hours: rawWo.running_hours?.toFixed(2) ?? null,
    kilometers: rawWo.kilometers?.toFixed(2) ?? null,
    next_service_date: rawWo.next_service_date?.toISOString() ?? null,
    next_service_kilometer: rawWo.next_service_kilometer?.toFixed(2) ?? null,
    next_service_running_hours: rawWo.next_service_running_hours?.toFixed(2) ?? null,
  };
  const labor = rawLabor.map((row) => ({
    ...row,
    hours: row.hours.toFixed(2),
    rate: row.rate.toFixed(3),
    amount: row.amount?.toFixed(3) ?? null
  }));
  const materials = rawMaterials.map((row) => ({
    ...row,
    quantity: row.quantity.toFixed(2),
    unit_price: row.unit_price.toFixed(3),
    amount: row.amount?.toFixed(3) ?? null
  }));
  const history = rawHistory.map((row) => ({
    ...row,
    changed_at: row.changed_at.toISOString()
  }));
  const approvals = rawApprovals.map((row) => ({
    ...row,
    decided_at: row.decided_at.toISOString()
  }));
  await writeAuditLog({
    actorId: context.userId,
    action: "work_order.print",
    entityType: "work_order",
    entityId: id,
    summary: `Opened print view for work order ${wo.work_order_number}`
  });
  const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
  const department = Array.isArray(wo.departments) ? wo.departments[0] : wo.departments;
  const qrPath = `/maintenance/work-orders/${wo.id}`;
  const qrTarget = internalQrTarget(qrPath);
  const qrSvg = await createQrSvg(qrTarget);

  return (
    <div className="bg-white p-6 text-[#111827] print:p-0">
      <style>{`@media print { aside, .lg\\:pl-72 > header { display: none !important; } main { margin: 0 !important; } .print-hide { display: none !important; } .print-sheet { border: 0 !important; box-shadow: none !important; } }`}</style>
      <button className="print-hide mb-4 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white">
        Use browser print or Ctrl+P
      </button>
      <article className="print-sheet mx-auto max-w-5xl border border-[#E5E7EB] p-8 shadow-sm">
        <FormDocumentHeader
          variant="print"
          title="Maintenance Work Order"
          departmentName="Maintenance Department"
          subtitle={`Generated: ${formatDateTime(new Date().toISOString())}`}
          referenceLabel="Work order number"
          referenceNumber={wo.work_order_number}
          status={wo.status}
        />

        <PrintGrid
          title="Work Order Details"
          rows={[
            ["Ordered by", wo.ordered_by],
            ["Department", department?.name],
            ["Asset", asset ? `${asset.asset_code} - ${asset.asset_name}` : ""],
            ["Asset category", wo.asset_category],
            ["Serial number", wo.serial_number],
            ["Plate number", wo.plate_number],
            ["Date of order", wo.date_of_order],
            ["Job location", wo.job_location],
            ["Start", formatDateTime(wo.starting_datetime)],
            ["End", formatDateTime(wo.ending_datetime)],
            ["Maintenance type", wo.maintenance_type],
            ["Worker type", wo.worker_type],
            ["Priority", wo.priority],
            ["Running hours", wo.running_hours],
            ["Kilometers", wo.kilometers]
          ]}
        />

        <section className="mt-6 grid gap-4">
          <TextArea title="Operator Complaint" value={wo.operator_complaint} />
          <TextArea title="Description of Work" value={wo.description_of_work} />
          <TextArea title="Notes" value={wo.notes} />
        </section>

        <PrintTable title="Labor" rows={labor ?? []} columns={["labor_name", "employee_number", "hours", "rate", "amount"]} />
        <PrintTable title="Material Used" rows={materials ?? []} columns={["material_name", "part_number", "ss_rec_code", "quantity", "unit_price", "amount"]} />
        <PrintTable title="Approval History" rows={approvals ?? []} columns={["approval_type", "status", "decided_at", "comments"]} />
        <PrintTable title="Approval / Status History" rows={history ?? []} columns={["from_status", "to_status", "changed_at", "notes"]} />

        <PrintGrid
          title="Next Service and Signatures"
          rows={[
            ["Next service date", wo.next_service_date],
            ["Next service kilometer", wo.next_service_kilometer],
            ["Next service running hours", wo.next_service_running_hours],
            ["Operator/requester confirmation", wo.operator_requester_confirmation],
            ["Supervisor verification", wo.supervisor_verification],
            ["Maintenance manager closure", wo.maintenance_manager_closure]
          ]}
        />
        <section className="mt-6 grid grid-cols-[140px_1fr] gap-4 border border-[#E5E7EB] p-4">
          <div className="h-28 w-28 border border-[#E5E7EB] bg-white p-1 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div>
            <h2 className="text-lg font-black">Scannable Internal QR</h2>
            <p className="mt-2 break-all text-sm">{qrPath}</p>
            <p className="mt-6 break-all text-xs text-[#4B5563]">Target: {qrTarget}</p>
          </div>
        </section>
      </article>
    </div>
  );
}

function PrintGrid({ title, rows }: { title: string; rows: Array<[string, unknown]> }) {
  return (
    <section className="mt-6">
      <h2 className="border-b border-[#E5E7EB] pb-2 text-lg font-black">{title}</h2>
      <div className="mt-3 grid grid-cols-3 gap-0 border border-[#E5E7EB] text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="border-b border-r border-[#E5E7EB] p-2">
            <p className="text-xs font-bold uppercase text-[#4B5563]">{label}</p>
            <p className="mt-1 font-semibold">{String(value ?? "Not recorded")}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TextArea({ title, value }: { title: string; value: string | null }) {
  return <div><h2 className="text-sm font-black uppercase text-[#4B5563]">{title}</h2><p className="mt-1 min-h-14 border border-[#E5E7EB] p-3 text-sm">{value || "Not recorded"}</p></div>;
}

function PrintTable({ title, rows, columns }: { title: string; rows: Array<Record<string, unknown>>; columns: string[] }) {
  return (
    <section className="mt-6">
      <h2 className="border-b border-[#E5E7EB] pb-2 text-lg font-black">{title}</h2>
      <table className="mt-3 w-full border-collapse text-left text-sm">
        <thead><tr>{columns.map((column) => <th key={column} className="border border-[#E5E7EB] bg-gray-50 p-2">{column.replaceAll("_", " ")}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row) => <tr key={String(row.id)}>{columns.map((column) => <td key={column} className="border border-[#E5E7EB] p-2">{column === "changed_at" ? formatDateTime(typeof row[column] === "string" ? row[column] : null) : String(row[column] ?? "-")}</td>)}</tr>) : <tr><td className="border border-[#E5E7EB] p-2" colSpan={columns.length}>No records.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
