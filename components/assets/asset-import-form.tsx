"use client";
import { Fragment, useState, useRef } from "react";
import Link from "next/link";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseAssetExcelAction, importAssetsAction } from "@/app/actions/asset-import";
import type { ImportPreviewRow, ImportResult } from "@/app/actions/asset-import";

type Step = "upload" | "preview" | "done";

// ─── Error classification helpers ────────────────────────────────────────────

function isDupFile(row: ImportPreviewRow) {
  return row.errors.some((e) => e.includes("Duplicate code in this file"));
}
function isDupDb(row: ImportPreviewRow) {
  return !isDupFile(row) && row.errors.some((e) => e.includes("already exists in database"));
}
function rowTone(row: ImportPreviewRow): "valid" | "dup" | "invalid" {
  if (row.valid) return "valid";
  if (isDupFile(row) || isDupDb(row)) return "dup";
  return "invalid";
}
function rowLabel(row: ImportPreviewRow): string {
  if (row.valid) return "Ready";
  if (isDupFile(row)) return "Dup (file)";
  if (isDupDb(row)) return "Dup (DB)";
  return row.errors[0] ?? "Invalid";
}

// Compact vehicle-field summary — only rendered when at least one of these
// is present, so plain equipment rows never grow an extra line.
function vehicleFieldParts(row: ImportPreviewRow): string[] {
  const parts: string[] = [];
  if (row.plate_number) parts.push(`Plate: ${row.plate_number}`);
  if (row.chassisNumber) parts.push(`Chassis: ${row.chassisNumber}`);
  if (row.engineNumber) parts.push(`Engine: ${row.engineNumber}`);
  if (row.modelYear) parts.push(`Year: ${row.modelYear}`);
  if (row.registrationExpiryDate) parts.push(`Reg. Expiry: ${row.registrationExpiryDate}`);
  if (row.insuranceExpiryDate) parts.push(`Insurance Expiry: ${row.insuranceExpiryDate}`);
  if (row.currentKilometerReading) parts.push(`KM: ${row.currentKilometerReading}`);
  if (row.assignedOperatorDriver) parts.push(`Driver: ${row.assignedOperatorDriver}`);
  return parts;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AssetImportForm() {
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const validRows      = rows.filter((r) => r.valid);
  const invalidRows    = rows.filter((r) => !r.valid);
  const dupFileRows    = rows.filter(isDupFile);
  const dupDbRows      = rows.filter(isDupDb);
  const valErrorRows   = invalidRows.filter((r) => !isDupFile(r) && !isDupDb(r));
  const newCategoryRows = validRows.filter((r) => r.category_status === "new");
  const uniqueNewCategories = new Set(newCategoryRows.map((r) => r.category.toLowerCase())).size;

  async function handleParse(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    setConfirmed(false);
    try {
      const res = await parseAssetExcelAction(formData);
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
      const res = await importAssetsAction(validRows);
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
    const dupFailures = result.failures.filter((f) =>
      f.reason.includes("already exists") || f.reason.includes("Duplicate")
    );
    const otherFailures = result.failures.filter(
      (f) => !f.reason.includes("already exists") && !f.reason.includes("Duplicate")
    );

    return (
      <div className="space-y-4">
        {/* Result header */}
        <div className={`rounded-md border p-5 ${result.imported > 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="flex items-center gap-3">
            <CheckCircle2 className={`h-5 w-5 shrink-0 ${result.imported > 0 ? "text-green-600" : "text-amber-600"}`} aria-hidden="true" />
            <p className="font-bold text-[#111827]">
              {result.imported > 0 ? "Import complete" : "Import finished with no new assets"}
            </p>
          </div>
          {/* Stats strip */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-md border border-green-200 bg-white p-3 text-center">
              <p className="text-2xl font-black text-[#16A34A]">{result.imported}</p>
              <p className="mt-0.5 text-xs font-semibold text-[#4B5563]">Imported</p>
            </div>
            <div className="rounded-md border border-amber-200 bg-white p-3 text-center">
              <p className="text-2xl font-black text-amber-700">{dupFailures.length}</p>
              <p className="mt-0.5 text-xs font-semibold text-[#4B5563]">Skipped (duplicate)</p>
            </div>
            <div className={`rounded-md border p-3 text-center ${otherFailures.length > 0 ? "border-red-200 bg-white" : "border-[#E5E7EB] bg-white"}`}>
              <p className={`text-2xl font-black ${otherFailures.length > 0 ? "text-[#ED1C24]" : "text-[#111827]"}`}>{otherFailures.length}</p>
              <p className="mt-0.5 text-xs font-semibold text-[#4B5563]">Failed (error)</p>
            </div>
          </div>
        </div>

        {/* Failures table */}
        {result.failures.length > 0 && (
          <div className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <p className="text-xs font-black uppercase text-[#4B5563]">Rows not imported ({result.failures.length})</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Asset Code</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {result.failures.map((f) => {
                    const isDup = f.reason.includes("already exists") || f.reason.includes("Duplicate");
                    return (
                      <tr key={`${f.rowNumber}-${f.asset_code}`} className={isDup ? "bg-amber-50" : "bg-red-50"}>
                        <td className="px-3 py-2 text-[#9CA3AF]">{f.rowNumber || "—"}</td>
                        <td className="px-3 py-2 font-mono font-bold text-[#111827]">{f.asset_code || "—"}</td>
                        <td className={`px-3 py-2 font-semibold ${isDup ? "text-amber-800" : "text-[#ED1C24]"}`}>{f.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Link href="/assets" className="inline-flex items-center justify-center rounded-md border border-[#ED1C24] bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white hover:opacity-90">
            View assets
          </Link>
          <Link href="/assets/import/history" className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50">
            <History className="h-4 w-4" aria-hidden="true" />
            Import history
          </Link>
          <Button variant="secondary" onClick={reset}>Import another file</Button>
        </div>
      </div>
    );
  }

  // ── Preview step ───────────────────────────────────────────────────────────
  if (step === "preview") {
    const skippedTotal = invalidRows.length;

    return (
      <div className="space-y-4">
        <p className="text-sm text-[#374151]">
          Review the preview carefully. Rows with errors will not be imported until fixed.
        </p>

        {/* 5-stat summary strip */}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-black text-[#111827]">{rows.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Total rows</p>
          </div>
          <div className={`rounded-md border p-4 text-center shadow-sm ${validRows.length > 0 ? "border-green-200 bg-green-50" : "border-[#E5E7EB] bg-white"}`}>
            <p className={`text-2xl font-black ${validRows.length > 0 ? "text-[#16A34A]" : "text-[#111827]"}`}>{validRows.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Ready to import</p>
          </div>
          <div className={`rounded-md border p-4 text-center shadow-sm ${dupFileRows.length > 0 ? "border-amber-200 bg-amber-50" : "border-[#E5E7EB] bg-white"}`}>
            <p className={`text-2xl font-black ${dupFileRows.length > 0 ? "text-amber-700" : "text-[#111827]"}`}>{dupFileRows.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Duplicate in file</p>
          </div>
          <div className={`rounded-md border p-4 text-center shadow-sm ${dupDbRows.length > 0 ? "border-amber-200 bg-amber-50" : "border-[#E5E7EB] bg-white"}`}>
            <p className={`text-2xl font-black ${dupDbRows.length > 0 ? "text-amber-700" : "text-[#111827]"}`}>{dupDbRows.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Duplicate in DB</p>
          </div>
          <div className={`rounded-md border p-4 text-center shadow-sm ${valErrorRows.length > 0 ? "border-red-200 bg-red-50" : "border-[#E5E7EB] bg-white"}`}>
            <p className={`text-2xl font-black ${valErrorRows.length > 0 ? "text-[#ED1C24]" : "text-[#111827]"}`}>{valErrorRows.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Validation errors</p>
          </div>
        </div>

        {/* Preview table */}
        <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <p className="text-xs font-black uppercase text-[#4B5563]">Row preview — up to 500 rows</p>
            <p className="mt-0.5 text-xs text-[#9CA3AF]">
              Rows highlighted in amber are duplicates (will be skipped). Rows in red have validation errors (will be skipped). White rows are ready.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Asset Code</th>
                  <th className="px-3 py-2">Asset Name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Condition</th>
                  <th className="px-3 py-2">Criticality</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {rows.map((r) => {
                  const tone = rowTone(r);
                  const rowClass = tone === "valid" ? "hover:bg-gray-50" : tone === "dup" ? "bg-amber-50" : "bg-red-50";
                  const vehicleParts = vehicleFieldParts(r);
                  return (
                    <Fragment key={r.rowNumber}>
                      <tr className={rowClass}>
                        <td className="px-3 py-2 text-[#9CA3AF]">{r.rowNumber}</td>
                        <td className="px-3 py-2 font-mono font-bold text-[#111827]">{r.asset_code || <span className="text-[#ED1C24]">—</span>}</td>
                        <td className="px-3 py-2 max-w-[12rem] truncate">{r.asset_name || <span className="text-[#ED1C24]">—</span>}</td>
                        <td className="px-3 py-2">
                          <span>{r.category || <span className="text-[#ED1C24]">—</span>}</span>
                          {r.category && r.category_status === "new" && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">New</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[#4B5563]">{r.department_name || <span className="text-[#9CA3AF]">—</span>}</td>
                        <td className="px-3 py-2">{r.status || "Active"}</td>
                        <td className="px-3 py-2 text-[#4B5563]">{r.condition || <span className="text-[#9CA3AF]">—</span>}</td>
                        <td className="px-3 py-2 text-[#4B5563]">{r.criticality || <span className="text-[#9CA3AF]">—</span>}</td>
                        <td className="px-3 py-2">
                          {tone === "valid" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ready
                            </span>
                          )}
                          {tone === "dup" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800" title={r.errors.join("; ")}>
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {rowLabel(r)}
                            </span>
                          )}
                          {tone === "invalid" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-[#ED1C24]" title={r.errors.join("; ")}>
                              <XCircle className="h-3 w-3" aria-hidden="true" /> {r.errors[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                      {/* Compact vehicle-field secondary row — only rendered for rows
                          that actually carry vehicle data, so equipment rows are unaffected. */}
                      {vehicleParts.length > 0 && (
                        <tr className={rowClass}>
                          <td />
                          <td colSpan={8} className="px-3 pb-2 pt-0">
                            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#6B7280]">
                              {vehicleParts.map((part) => (
                                <span key={part}>{part}</span>
                              ))}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Confirmation warning + checkbox */}
        {validRows.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <div className="flex-1">
                <p className="font-bold text-amber-900">Review before importing</p>
                <ul className="mt-2 space-y-1 text-sm text-amber-800">
                  <li>Only the <strong>{validRows.length} valid</strong> row{validRows.length !== 1 ? "s" : ""} will be imported.</li>
                  {skippedTotal > 0 && <li>The <strong>{skippedTotal} row{skippedTotal !== 1 ? "s" : ""}</strong> marked as duplicate or invalid will be skipped.</li>}
                  <li>Existing assets will <strong>not</strong> be overwritten. Duplicate asset codes are always skipped.</li>
                  {uniqueNewCategories > 0 && (
                    <li><strong>{uniqueNewCategories} new categor{uniqueNewCategories === 1 ? "y" : "ies"}</strong> will be auto-created under <em>Other</em> during import (shown with <span className="inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">New</span> badge in the table above).</li>
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
                  I have reviewed the rows above and confirm I want to import {validRows.length} asset{validRows.length !== 1 ? "s" : ""}.
                </label>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden="true" />
            <p className="text-sm font-semibold text-[#ED1C24]">{error}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {validRows.length > 0 ? (
            <Button onClick={handleImport} disabled={loading || !confirmed}>
              {loading ? "Importing…" : `Import ${validRows.length} asset${validRows.length !== 1 ? "s" : ""}`}
            </Button>
          ) : (
            <p className="text-sm font-semibold text-[#ED1C24]">No valid rows to import.</p>
          )}
          <Button variant="secondary" onClick={reset} disabled={loading}>
            Start over
          </Button>
        </div>
      </div>
    );
  }

  // ── Upload step ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2.5 rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden="true" />
          <p className="text-sm font-semibold text-[#ED1C24]">{error}</p>
        </div>
      )}

      <form onSubmit={handleParse} className="rounded-md border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center gap-4 rounded-md border-2 border-dashed border-[#E5E7EB] p-8 text-center">
          <div className="rounded-md bg-[#111827] p-3">
            <FileSpreadsheet className="h-6 w-6 text-white" aria-hidden="true" />
          </div>
          <div>
            <p className="font-bold text-[#111827]">Upload asset Excel file</p>
            <p className="mt-1 text-sm text-[#4B5563]">Accepted format: .xlsx — maximum 10 MB — maximum 500 rows</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block w-full max-w-xs rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
            required
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={loading} className="gap-2">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {loading ? "Parsing…" : "Parse file"}
          </Button>
        </div>
      </form>

      {/* Column reference */}
      <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-bold text-[#111827]">Supported Excel columns</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
              <tr>
                <th className="px-3 py-2">Accepted header names</th>
                <th className="px-3 py-2">Maps to</th>
                <th className="px-3 py-2">Required</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {[
                ["Asset Code / Code / Asset No",              "Asset Code",    true ],
                ["Asset Name / Name / Description",           "Asset Name",    true ],
                ["Category / Type",                           "Category",      true ],
                ["Location / Site",                           "Location",      false],
                ["Department / Department Area / Area",       "Department",    false],
                ["Manufacturer / Brand / Make",               "Brand",         false],
                ["Model",                                     "Model",         false],
                ["Serial Number / Serial No / SN",            "Serial Number", false],
                ["Plate Number / Plate No / Registration",    "Plate Number",  false],
                ["Status",                                    "Status",        false],
                ["Condition / Physical Condition",            "Condition",     false],
                ["Criticality / Criticality Level / Priority","Criticality",   false],
                ["Remarks / Comments / Additional Remarks",   "Remarks",       false],
              ].map(([header, field, req]) => (
                <tr key={String(field)}>
                  <td className="px-3 py-2 font-mono text-xs text-[#4B5563]">{header}</td>
                  <td className="px-3 py-2 font-semibold">{field}</td>
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
          Headers are matched case-insensitively. Only the first sheet is used.
          Existing asset codes are never overwritten — duplicate codes are always skipped.
        </p>
      </div>

      {/* Vehicle column reference — Vehicle Import Unit 1 */}
      <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <p className="mb-1 text-sm font-bold text-[#111827]">Vehicle columns (optional)</p>
        <p className="mb-3 text-xs text-[#4B5563]">
          Only needed when importing vehicles. Leave these columns blank for other equipment.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
              <tr>
                <th className="px-3 py-2">Accepted header names</th>
                <th className="px-3 py-2">Maps to</th>
                <th className="px-3 py-2">Format</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {[
                ["Chassis Number / Chassis No / Chassis No. / Chassis / VIN",           "Chassis Number",           "Text"],
                ["Engine Number / Engine No / Engine No. / Engine",                     "Engine Number",            "Text"],
                ["Registration Expiry Date / Registration Expiry / Registration Expiry Dt / Istimara Expiry / Vehicle Registration Expiry", "Registration Expiry Date", "YYYY-MM-DD or Excel date"],
                ["Insurance Expiry Date / Insurance Expiry / Insurance Expiry Dt / Insurance Valid Until", "Insurance Expiry Date", "YYYY-MM-DD or Excel date"],
                ["Current Kilometer Reading / Current KM / Current Kilometers / KM Reading / Kilometer Reading / Odometer / Mileage", "Current Kilometer Reading", "Number"],
                ["Assigned Driver / Assigned Operator / Assigned Operator / Driver / Driver / Operator Driver", "Assigned Driver", "Text"],
                ["Model Year / Year / Vehicle Year / Manufacturing Year / Mfg Year",     "Model Year",               "4-digit year (1970–next year)"],
              ].map(([header, field, format]) => (
                <tr key={String(field)}>
                  <td className="px-3 py-2 font-mono text-xs text-[#4B5563]">{header}</td>
                  <td className="px-3 py-2 font-semibold">{field}</td>
                  <td className="px-3 py-2 text-xs text-[#4B5563]">{format}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[#9CA3AF]">
          Duplicate plate numbers (within the file or already in Assets &amp; Equipment) are blocked, not silently imported.
          Invalid dates, model years, or kilometer readings are flagged as row errors and skipped rather than guessed.
        </p>
      </div>
    </div>
  );
}
