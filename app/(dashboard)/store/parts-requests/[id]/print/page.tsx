import Image from "next/image";

import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";

export default async function PrintPartsRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("parts_requests.view");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: request }, { data: items }] = await Promise.all([
    supabase.from("parts_requests").select("*, work_orders(work_order_number), assets(asset_code, asset_name), departments(name)").eq("id", id).single(),
    supabase.from("parts_request_items").select("*").eq("parts_request_id", id)
  ]);
  if (!request) return <div className="p-8">Parts request not found.</div>;
  const workOrder = Array.isArray(request.work_orders) ? request.work_orders[0] : request.work_orders;
  const asset = Array.isArray(request.assets) ? request.assets[0] : request.assets;
  const department = Array.isArray(request.departments) ? request.departments[0] : request.departments;

  return (
    <div className="bg-white p-6 text-[#111827] print:p-0">
      <style>{`@media print { aside, .lg\\:pl-72 > header { display: none !important; } .print-hide { display:none!important; } }`}</style>
      <button className="print-hide mb-4 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white">Use browser print or Ctrl+P</button>
      <article className="mx-auto max-w-5xl border border-[#E5E7EB] p-8 shadow-sm">
        <Header title="RECAFCO Parts Request" number={request.parts_request_number} status={request.status} />
        <Grid rows={[
          ["Department", department?.name],
          ["Work order", workOrder?.work_order_number],
          ["Asset", asset ? `${asset.asset_code} - ${asset.asset_name}` : ""],
          ["Date", request.request_date],
          ["Time", request.request_time],
          ["Serial number", request.serial_number],
          ["Remarks", request.remarks],
          ["Total", request.total_price]
        ]} />
        <Table title="Requested Items" rows={items ?? []} columns={["description", "part_number", "ss_rec_code", "quantity_requested", "unit_price", "total_price", "stock_availability", "issued_quantity", "remarks"]} />
        <Grid rows={[
          ["Approval comments", request.approval_comments],
          ["Store comments", request.store_issue_comments],
          ["Generated", formatDateTime(new Date().toISOString())],
          ["Internal route", `/store/parts-requests/${request.id}`]
        ]} />
      </article>
    </div>
  );
}

function Header({ title, number, status }: { title: string; number: string | null; status: string }) {
  return (
    <div className="flex items-start justify-between border-b-4 border-[#ED1C24] pb-5">
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-24 rounded-md border border-[#E5E7EB] bg-white"><Image src="/recafco-logo.png" alt="RECAFCO logo" fill className="object-contain p-1" /></div>
        <div><h1 className="text-2xl font-black">{title}</h1><p className="text-sm text-[#4B5563]">Generated: {formatDateTime(new Date().toISOString())}</p></div>
      </div>
      <div className="text-right"><p className="text-sm text-[#4B5563]">Number</p><p className="text-xl font-black text-[#ED1C24]">{number}</p><p className="mt-2 text-sm font-bold">{status}</p></div>
    </div>
  );
}

function Grid({ rows }: { rows: Array<[string, unknown]> }) {
  return <section className="mt-6 grid grid-cols-3 border border-[#E5E7EB] text-sm">{rows.map(([label, value]) => <div key={label} className="border-b border-r border-[#E5E7EB] p-2"><p className="text-xs font-bold uppercase text-[#4B5563]">{label}</p><p className="mt-1 font-semibold">{String(value ?? "Not recorded")}</p></div>)}</section>;
}

function Table({ title, rows, columns }: { title: string; rows: Array<Record<string, unknown>>; columns: string[] }) {
  return <section className="mt-6"><h2 className="border-b border-[#E5E7EB] pb-2 text-lg font-black">{title}</h2><table className="mt-3 w-full border-collapse text-left text-sm"><thead><tr>{columns.map((column) => <th key={column} className="border border-[#E5E7EB] bg-gray-50 p-2">{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={String(row.id)}>{columns.map((column) => <td key={column} className="border border-[#E5E7EB] p-2">{String(row[column] ?? "-")}</td>)}</tr>) : <tr><td className="border border-[#E5E7EB] p-2" colSpan={columns.length}>No records.</td></tr>}</tbody></table></section>;
}
