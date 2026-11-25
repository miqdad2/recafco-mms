"use client";

import { AlertTriangle } from "lucide-react";

import type { OpeningStockImportResult, OpeningStockRowOutcome } from "@/lib/backend/store/opening-stock-import";

// Pieces shared by the Import Opening Stock form and the batch panel.

export const OUTCOME_LABEL: Record<OpeningStockRowOutcome, string> = {
  posted_existing: "Imported Existing",
  registered_new: "Registered New",
  held: "Held for Review",
  not_imported: "Failed",
  excluded: "Not imported (decision)",
};

export const TONES = {
  plain: { box: "border-[#E5E7EB] bg-white", text: "text-[#111827]" },
  green: { box: "border-green-200 bg-green-50", text: "text-[#16A34A]" },
  blue: { box: "border-blue-200 bg-blue-50", text: "text-blue-700" },
  amber: { box: "border-amber-200 bg-amber-50", text: "text-amber-700" },
  red: { box: "border-red-200 bg-red-50", text: "text-[#ED1C24]" },
} as const;

export function Stat({ value, label, tone }: { value: number; label: string; tone: keyof typeof TONES }) {
  const t = value > 0 ? TONES[tone] : TONES.plain;
  return (
    <div className={`rounded-md border p-3 text-center ${t.box}`}>
      <p className={`text-2xl font-black ${t.text}`}>{value}</p>
      <p className="mt-0.5 text-xs font-semibold text-[#4B5563]">{label}</p>
    </div>
  );
}

export function ResultCards({ r }: { r: { postedExisting: number; registeredNew: number; held: number; failed: number; excluded: number } }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat value={r.postedExisting} label="Imported Existing" tone="green" />
      <Stat value={r.registeredNew} label="Registered New" tone="blue" />
      <Stat value={r.held} label="Held for Review" tone="amber" />
      <Stat value={r.failed + r.excluded} label={r.excluded ? `Failed / not imported (${r.excluded} by decision)` : "Failed"} tone="red" />
    </div>
  );
}

export function ResultTable({ rows }: { rows: OpeningStockImportResult["rows"] }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
            <tr>
              <th className="px-3 py-2">Row</th>
              <th className="px-3 py-2">Material Name (file)</th>
              <th className="px-3 py-2">File Qty</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Inventory material</th>
              <th className="px-3 py-2">Posted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {rows.map((r) => (
              <tr key={r.rowNumber} className={r.outcome === "not_imported" || r.outcome === "excluded" ? "bg-red-50" : r.outcome === "held" ? "bg-amber-50" : ""}>
                <td className="whitespace-nowrap px-3 py-2 text-[#9CA3AF]">{r.rowNumber}</td>
                <td className="px-3 py-2 font-semibold text-[#111827]">{r.sourceName || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-[#4B5563]">{r.sourceQuantity} {r.sourceUnit}</td>
                <td className="px-3 py-2">
                  <p className="font-bold text-[#111827]">{OUTCOME_LABEL[r.outcome]}</p>
                  {(r.outcome === "held" || r.outcome === "not_imported" || r.outcome === "excluded") && <p className="text-xs text-[#4B5563]">{r.message}</p>}
                </td>
                <td className="px-3 py-2 text-[#4B5563]">
                  {r.materialName ? (
                    <>
                      {r.materialName}
                      {r.itemCode && <span className="ml-1 font-mono text-xs text-[#111827]">({r.itemCode})</span>}
                    </>
                  ) : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#111827]">{r.quantity !== null ? `${r.quantity} ${r.unit ?? ""}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden />
      <p className="text-sm font-semibold text-[#ED1C24]">{message}</p>
    </div>
  );
}
