import Image from "next/image";

import { requirePermission } from "@/lib/auth/context";
import { createQrSvg, internalQrTarget } from "@/lib/qr/svg";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export default async function PrintAssetHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("assets.view");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: asset }, { data: workOrders }, { data: materials }] = await Promise.all([
    supabase.from("assets").select("*, departments(name)").eq("id", id).single(),
    supabase.from("work_orders").select("*").eq("asset_id", id).order("date_of_order", { ascending: false }),
    supabase.from("work_order_materials").select("*, work_orders!inner(asset_id, work_order_number)").eq("work_orders.asset_id", id)
  ]);
  if (!asset) return <div className="p-8">Asset not found.</div>;
  const department = Array.isArray(asset.departments) ? asset.departments[0] : asset.departments;
  const qrPath = `/assets/${asset.id}`;
  const qrTarget = internalQrTarget(qrPath);
  const qrSvg = await createQrSvg(qrTarget);

  return (
    <div className="bg-white p-6 text-[#111827] print:p-0">
      <style>{`@media print { aside, .lg\\:pl-72 > header { display: none !important; } .print-hide { display:none!important; } }`}</style>
      <button className="print-hide mb-4 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white">Use browser print or Ctrl+P</button>
      <article className="mx-auto max-w-5xl border border-[#E5E7EB] p-8 shadow-sm">
        <div className="flex items-start justify-between border-b-4 border-[#ED1C24] pb-5">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-24 rounded-md border border-[#E5E7EB] bg-white"><Image src="/recafco-logo.png" alt="RECAFCO logo" fill className="object-contain p-1" /></div>
            <div><h1 className="text-2xl font-black">Asset Maintenance History</h1><p className="text-sm text-[#4B5563]">Generated: {formatDateTime(new Date().toISOString())}</p></div>
          </div>
          <div className="text-right"><p className="text-sm text-[#4B5563]">Asset</p><p className="text-xl font-black text-[#ED1C24]">{asset.asset_code}</p><p className="mt-2 text-sm font-bold">{asset.status}</p></div>
        </div>
        <Grid rows={[
          ["Asset name", asset.asset_name],
          ["Category", asset.category],
          ["Department", department?.name],
          ["Location", asset.location],
          ["Serial number", asset.serial_number],
          ["Plate number", asset.plate_number],
          ["Current KM", asset.current_kilometer_reading],
          ["Running hours", asset.current_running_hours],
          ["Next service date", asset.next_service_date],
          ["Next service KM", asset.next_service_kilometer],
          ["Next service hours", asset.next_service_running_hours],
          ["Internal route", `/assets/${asset.id}`]
        ]} />
        <section className="mt-6 grid grid-cols-[140px_1fr] gap-4 border border-[#E5E7EB] p-4">
          <div className="h-28 w-28 border border-[#E5E7EB] bg-white p-1 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div>
            <h2 className="text-lg font-black">Scannable Asset QR</h2>
            <p className="mt-2 break-all text-sm">{qrPath}</p>
            <p className="mt-6 break-all text-xs text-[#4B5563]">Target: {qrTarget}</p>
          </div>
        </section>
        <Table title="Related Work Orders" rows={workOrders ?? []} columns={["work_order_number", "date_of_order", "maintenance_type", "worker_type", "priority", "status", "total_work_order_cost"]} />
        <Table title="Parts Used" rows={materials ?? []} columns={["material_name", "part_number", "ss_rec_code", "quantity", "unit_price", "amount"]} />
      </article>
    </div>
  );
}

function Grid({ rows }: { rows: Array<[string, unknown]> }) {
  return <section className="mt-6 grid grid-cols-3 border border-[#E5E7EB] text-sm">{rows.map(([label, value]) => <div key={label} className="border-b border-r border-[#E5E7EB] p-2"><p className="text-xs font-bold uppercase text-[#4B5563]">{label}</p><p className="mt-1 font-semibold">{String(value ?? "Not recorded")}</p></div>)}</section>;
}

function Table({ title, rows, columns }: { title: string; rows: Array<Record<string, unknown>>; columns: string[] }) {
  return <section className="mt-6"><h2 className="border-b border-[#E5E7EB] pb-2 text-lg font-black">{title}</h2><table className="mt-3 w-full border-collapse text-left text-sm"><thead><tr>{columns.map((column) => <th key={column} className="border border-[#E5E7EB] bg-gray-50 p-2">{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={String(row.id)}>{columns.map((column) => <td key={column} className="border border-[#E5E7EB] p-2">{String(row[column] ?? "-")}</td>)}</tr>) : <tr><td className="border border-[#E5E7EB] p-2" colSpan={columns.length}>No records.</td></tr>}</tbody></table></section>;
}
