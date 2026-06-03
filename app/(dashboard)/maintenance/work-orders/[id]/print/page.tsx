import Image from "next/image";

import { requirePermission } from "@/lib/auth/context";
import { createQrSvg, internalQrTarget } from "@/lib/qr/svg";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export default async function PrintWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("work_orders.print");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: wo }, { data: labor }, { data: materials }, { data: history }, { data: approvals }] = await Promise.all([
    supabase.from("work_orders").select("*, assets(asset_code, asset_name), departments(name)").eq("id", id).single(),
    supabase.from("work_order_labor").select("*").eq("work_order_id", id),
    supabase.from("work_order_materials").select("*").eq("work_order_id", id),
    supabase.from("work_order_status_history").select("*").eq("work_order_id", id).order("changed_at", { ascending: true }),
    supabase.from("approvals").select("*").eq("work_order_id", id).order("created_at", { ascending: true })
  ]);

  if (!wo) return <div className="p-8">Work order not found.</div>;
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
        <div className="flex items-start justify-between border-b-4 border-[#ED1C24] pb-5">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-24 rounded-md border border-[#E5E7EB] bg-white">
              <Image src="/recafco-logo.png" alt="RECAFCO logo" fill className="object-contain p-1" />
            </div>
            <div>
              <h1 className="text-2xl font-black">RECAFCO Maintenance Work Order</h1>
              <p className="text-sm text-[#4B5563]">Generated: {formatDateTime(new Date().toISOString())}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-[#4B5563]">Work order number</p>
            <p className="text-xl font-black text-[#ED1C24]">{wo.work_order_number}</p>
            <p className="mt-2 text-sm font-bold">{wo.status}</p>
          </div>
        </div>

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
