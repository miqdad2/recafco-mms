"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, XCircle } from "lucide-react";

import {
  parseOpeningStockExcelAction,
  importOpeningStockAction,
  type ImportPreviewRow,
  type ImportResult,
} from "@/app/actions/opening-stock-import";

type Step = "upload" | "preview" | "done";

const STATUS_LABEL: Record<ImportPreviewRow["status"], string> = {
  valid:             "Valid",
  missing_name:      "Missing material name",
  invalid_quantity:  "Invalid quantity",
  invalid_unit:      "Invalid unit",
  duplicate:         "Duplicate",
};

export function OpeningStockImportForm() {
  const [step, setStep]       = useState<Step>("upload");
  const [rows, setRows]       = useState<ImportPreviewRow[]>([]);
  const [result, setResult]   = useState<ImportResult | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const validRows     = rows.filter((r) => r.status === "valid");
  const duplicateRows = rows.filter((r) => r.status === "duplicate");
  const invalidRows   = rows.filter((r) => r.status !== "valid" && r.status !== "duplicate");

  async function handleParse(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    setConfirmed(false);
    try {
      const res = await parseOpeningStockExcelAction(formData);
      if (res.error) { setError(res.error); return; }
      if (res.rows.length === 0) { setError("No data rows found in the file."); return; }
      setRows(res.rows);
      setStep("preview");
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (validRows.length === 0 || !confirmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await importOpeningStockAction(validRows);
      setResult(res);
      setStep("done");
    } catch {
      setError("Import failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep("upload");
    setRows([]);
    setResult(null);
    setError(null);
    setConfirmed(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Done step ──────────────────────────────────────────────────────────────
  if (step === "done" && result) {
    return (
      <div className="space-y-4">
        <div className={`rounded-md border p-5 ${result.imported > 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="flex items-center gap-3">
            <CheckCircle2 className={`h-5 w-5 shrink-0 ${result.imported > 0 ? "text-green-600" : "text-amber-600"}`} aria-hidden />
            <p className="font-bold text-[#111827]">
              {result.imported > 0 ? "Import complete" : "Import finished with no new opening stock"}
            </p>
          </div>
          <p className="mt-2 text-xs text-[#4B5563]">
            Import batch reference: <span className="font-mono font-bold text-[#111827]">{result.batchReference}</span>
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-green-200 bg-white p-3 text-center">
              <p className="text-2xl font-black text-[#16A34A]">{result.imported}</p>
              <p className="mt-0.5 text-xs font-semibold text-[#4B5563]">Imported</p>
            </div>
            <div className={`rounded-md border p-3 text-center ${result.failures.length > 0 ? "border-red-200 bg-white" : "border-[#E5E7EB] bg-white"}`}>
              <p className={`text-2xl font-black ${result.failures.length > 0 ? "text-[#ED1C24]" : "text-[#111827]"}`}>{result.skipped}</p>
              <p className="mt-0.5 text-xs font-semibold text-[#4B5563]">Skipped</p>
            </div>
          </div>
        </div>

        {result.failures.length > 0 && (
          <div className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <p className="text-xs font-black uppercase text-[#4B5563]">Rows not imported ({result.failures.length})</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Material Name</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {result.failures.map((f) => (
                    <tr key={`${f.rowNumber}-${f.material_name}`} className="bg-red-50">
                      <td className="px-3 py-2 text-[#9CA3AF]">{f.rowNumber || "—"}</td>
                      <td className="px-3 py-2 font-semibold text-[#111827]">{f.material_name || "—"}</td>
                      <td className="px-3 py-2 font-semibold text-[#ED1C24]">{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Link
            href="/store/offline-inventory"
            className="inline-flex items-center justify-center rounded-md border border-[#ED1C24] bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            View Offline Inventory Control
          </Link>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50"
          >
            Import another file
          </button>
        </div>
      </div>
    );
  }

  // ── Preview & Validate step ───────────────────────────────────────────────
  if (step === "preview") {
    return (
      <div className="space-y-4">
        {/* Summary strip */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-black text-[#111827]">{rows.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Total rows</p>
          </div>
          <div className={`rounded-md border p-4 text-center shadow-sm ${validRows.length > 0 ? "border-green-200 bg-green-50" : "border-[#E5E7EB] bg-white"}`}>
            <p className={`text-2xl font-black ${validRows.length > 0 ? "text-[#16A34A]" : "text-[#111827]"}`}>{validRows.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Valid rows</p>
          </div>
          <div className={`rounded-md border p-4 text-center shadow-sm ${invalidRows.length > 0 ? "border-red-200 bg-red-50" : "border-[#E5E7EB] bg-white"}`}>
            <p className={`text-2xl font-black ${invalidRows.length > 0 ? "text-[#ED1C24]" : "text-[#111827]"}`}>{invalidRows.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Invalid rows</p>
          </div>
          <div className={`rounded-md border p-4 text-center shadow-sm ${duplicateRows.length > 0 ? "border-amber-200 bg-amber-50" : "border-[#E5E7EB] bg-white"}`}>
            <p className={`text-2xl font-black ${duplicateRows.length > 0 ? "text-amber-700" : "text-[#111827]"}`}>{duplicateRows.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Duplicate rows</p>
          </div>
        </div>

        {duplicateRows.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
            <p className="text-sm font-semibold text-amber-900">
              Duplicate material detected. Review before importing.
            </p>
          </div>
        )}

        {/* Preview table */}
        <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <p className="text-xs font-black uppercase text-[#4B5563]">Row preview — up to 500 rows</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Material Name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Part Number</th>
                  <th className="px-3 py-2">SS Rec. Code</th>
                  <th className="px-3 py-2">Opening Quantity</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Location / Bin</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {rows.map((r) => {
                  const rowClass =
                    r.status === "valid" ? "hover:bg-gray-50" : r.status === "duplicate" ? "bg-amber-50" : "bg-red-50";
                  return (
                    <tr key={r.rowNumber} className={rowClass}>
                      <td className="px-3 py-2 text-[#9CA3AF]">{r.rowNumber}</td>
                      <td className="px-3 py-2 max-w-[12rem] truncate font-semibold text-[#111827]">
                        {r.material_name || <span className="text-[#ED1C24]">—</span>}
                      </td>
                      <td className="px-3 py-2 text-[#4B5563]">{r.category}</td>
                      <td className="px-3 py-2 text-[#4B5563]">{r.part_number || "—"}</td>
                      <td className="px-3 py-2 text-[#4B5563]">{r.ss_rec_code || "—"}</td>
                      <td className="px-3 py-2 font-semibold text-[#111827]">{r.quantity || "—"}</td>
                      <td className="px-3 py-2 text-[#4B5563]">{r.unit || "—"}</td>
                      <td className="px-3 py-2 text-[#4B5563]">{r.location || "—"}</td>
                      <td className="px-3 py-2">
                        {r.status === "valid" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                            <CheckCircle2 className="h-3 w-3" aria-hidden /> Valid
                          </span>
                        )}
                        {r.status === "duplicate" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                            <AlertTriangle className="h-3 w-3" aria-hidden /> Duplicate
                          </span>
                        )}
                        {r.status !== "valid" && r.status !== "duplicate" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-[#ED1C24]">
                            <XCircle className="h-3 w-3" aria-hidden /> {STATUS_LABEL[r.status]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {validRows.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              <div className="flex-1">
                <p className="font-bold text-amber-900">Review before importing</p>
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  <li>Only the <strong>{validRows.length} valid</strong> row{validRows.length !== 1 ? "s" : ""} will be imported as Opening Stock.</li>
                  {invalidRows.length + duplicateRows.length > 0 && (
                    <li>
                      The <strong>{invalidRows.length + duplicateRows.length} row{invalidRows.length + duplicateRows.length !== 1 ? "s" : ""}</strong> marked invalid or duplicate will be skipped.
                    </li>
                  )}
                  <li>This action cannot be undone automatically. Review the list above before confirming.</li>
                </ul>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm font-bold text-amber-900 select-none">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-amber-400 accent-[#ED1C24]"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I have reviewed the rows above and confirm I want to import {validRows.length} item{validRows.length !== 1 ? "s" : ""} as Opening Stock.
                </label>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden />
            <p className="text-sm font-semibold text-[#ED1C24]">{error}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {validRows.length > 0 ? (
            <button
              type="button"
              onClick={handleImport}
              disabled={loading || !confirmed}
              className="rounded-md bg-[#ED1C24] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Importing…" : `Confirm Import (${validRows.length})`}
            </button>
          ) : (
            <p className="text-sm font-semibold text-[#ED1C24]">No valid rows to import.</p>
          )}
          <button
            type="button"
            onClick={reset}
            disabled={loading}
            className="rounded-md border border-[#E5E7EB] bg-white px-5 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50 disabled:opacity-50"
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  // ── Upload step ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2.5 rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden />
          <p className="text-sm font-semibold text-[#ED1C24]">{error}</p>
        </div>
      )}

      <form onSubmit={handleParse} className="rounded-md border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center gap-4 rounded-md border-2 border-dashed border-[#E5E7EB] p-8 text-center">
          <div className="rounded-md bg-[#111827] p-3">
            <FileSpreadsheet className="h-6 w-6 text-white" aria-hidden />
          </div>
          <div>
            <p className="font-bold text-[#111827]">Upload Excel file</p>
            <p className="mt-1 text-sm text-[#4B5563]">Accepted formats: .xlsx, .xls — maximum 10 MB — maximum 500 rows</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="block w-full max-w-xs rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
            required
          />
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-[#ED1C24] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            <Upload className="h-4 w-4" aria-hidden />
            {loading ? "Parsing…" : "Parse file"}
          </button>
        </div>
      </form>

      {/* Column reference */}
      <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-bold text-[#111827]">Excel template columns</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
              <tr>
                <th className="px-3 py-2">Column</th>
                <th className="px-3 py-2">Required</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {[
                ["Material Name",    true],
                ["Category",         true],
                ["Part Number",      false],
                ["SS Rec. Code",     false],
                ["Opening Quantity", true],
                ["Unit",             true],
                ["Location / Bin",   false],
                ["Remarks",          false],
              ].map(([col, req]) => (
                <tr key={String(col)}>
                  <td className="px-3 py-2 font-semibold">{col}</td>
                  <td className="px-3 py-2">
                    {req
                      ? <span className="font-bold text-[#ED1C24]">Required</span>
                      : <span className="text-[#9CA3AF]">Optional</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[#9CA3AF]">
          Headers are matched case-insensitively. Only the first sheet is used. Opening Quantity must be a whole number
          greater than 0. Unit must be one of the allowed units (PCS, SET, BOX, PACK, MTR, ROLL, KG, LTR, DRUM, BAG, PAIR, NOS).
        </p>
      </div>
    </div>
  );
}
