"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, RefreshCw, Upload } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { confirmMaterialImportAction, previewMaterialImportAction } from "@/app/actions/material-master";
import {
  MATERIAL_IMPORT_FIELD_LABELS,
  OPTIONAL_IMPORT_FIELDS,
  type MaterialCategoryResolution,
  type MaterialCategoryResolutions,
  type MaterialImportColumnMapping,
  type MaterialImportField,
  type MaterialImportRowStatus,
} from "@/lib/store/material-master-import";
import type { MaterialImportPreview, MaterialImportResult } from "@/lib/backend/store/material-master";
import { inputCls, labelCls } from "@/components/store/offline-inventory-types";

// Super Admin Material Master import. Choosing a file runs a preview on the
// server (nothing is saved); sheet, header row and column mapping can be
// changed and previewed again. Import sends the same file and the exact
// options of the preview on screen, plus the row numbers shown as ready —
// the server checks every row again and imports only those still valid.

type StatusFilter = "all" | "valid" | "existing" | "duplicate" | "code" | "description" | "missingUnit" | "invalid" | "unit" | "category";

const STATUS_GROUP: Record<MaterialImportRowStatus, Exclude<StatusFilter, "all">> = {
  valid: "valid",
  existing_item_code: "existing",
  existing_material: "existing",
  duplicate_item_code: "duplicate",
  duplicate_material: "duplicate",
  missing_item_code: "code",
  missing_description: "description",
  missing_unit: "missingUnit",
  too_long: "invalid",
  invalid_value: "invalid",
  invalid_unit: "unit",
  unknown_category: "category",
};

const GROUP_TONE = { valid: "green", existing: "blue", duplicate: "amber", code: "red", description: "red", missingUnit: "red", invalid: "red", unit: "amber", category: "amber" } as const;
const GROUP_LABEL = {
  valid: "Ready",
  existing: "Existing",
  duplicate: "Duplicate",
  code: "Missing code",
  description: "Missing description",
  missingUnit: "Missing unit",
  invalid: "Invalid value",
  unit: "Invalid unit",
  category: "New / Needs Review",
} as const;

// A <select> value for a category decision: "" = none yet.
const CREATE_CATEGORY = "__create__";
const CATEGORY_CHOICE_PREFIX = "map:";

function resolutionValue(resolution: MaterialCategoryResolution | undefined): string {
  if (!resolution) return "";
  return resolution.action === "create" ? CREATE_CATEGORY : `${CATEGORY_CHOICE_PREFIX}${resolution.category}`;
}

const PAGE_SIZE = 100;

// UUID v4 from getRandomValues — randomUUID is missing on plain-HTTP LAN
// access (not a secure context).
function newSubmissionId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function MaterialMasterImportForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MaterialImportPreview | null>(null);
  const [submissionId, setSubmissionId] = useState<string>("");
  const [sheetName, setSheetName] = useState<string>("");
  const [headerMode, setHeaderMode] = useState<"auto" | "yes" | "no">("auto");
  const [mapping, setMapping] = useState<MaterialImportColumnMapping | null>(null);
  const [resolutions, setResolutions] = useState<MaterialCategoryResolutions>({});
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MaterialImportResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const importingRef = useRef(false);

  async function runPreview(
    target: File,
    opts: {
      sheetName: string;
      headerMode: "auto" | "yes" | "no";
      mapping: MaterialImportColumnMapping | null;
      mappingConfirmed?: boolean;
      resolutions?: MaterialCategoryResolutions;
    }
  ) {
    setLoading(true);
    setError(null);
    setResult(null);
    setConfirmed(false);
    const fd = new FormData();
    fd.set("file", target);
    if (opts.sheetName) fd.set("sheet_name", opts.sheetName);
    fd.set("header_row", opts.headerMode);
    if (opts.mapping) fd.set("mapping", JSON.stringify(opts.mapping));
    fd.set("mapping_confirmed", opts.mappingConfirmed ? "1" : "0");
    fd.set("category_resolutions", JSON.stringify(opts.resolutions ?? {}));
    const r = await previewMaterialImportAction(fd);
    setLoading(false);
    if (!r.ok) {
      // Keep the screen, so a mapping mistake can simply be corrected.
      setError(r.error);
      return;
    }
    setPreview(r.data);
    setSheetName(r.data.sheetName);
    setMapping(r.data.mapping);
    setResolutions(r.data.categoryResolutions);
    setSubmissionId(newSubmissionId());
    setFilter("all");
    setPage(1);
  }

  function onFileChange(f: File | null) {
    setFile(f);
    setPreview(null);
    setResult(null);
    setError(null);
    setHeaderMode("auto");
    setSheetName("");
    setMapping(null);
    setResolutions({});
    if (f) void runPreview(f, { sheetName: "", headerMode: "auto", mapping: null });
  }

  async function runImport() {
    if (!file || !preview || !confirmed || importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("sheet_name", preview.sheetName);
    fd.set("header_row", preview.hasHeaderRow ? "yes" : "no");
    fd.set("mapping", JSON.stringify(preview.mapping));
    fd.set("mapping_confirmed", "1");
    fd.set("category_resolutions", JSON.stringify(preview.categoryResolutions));
    fd.set("confirmed_rows", JSON.stringify(preview.rows.filter((r) => r.status === "valid").map((r) => r.rowNumber)));
    fd.set("client_submission_id", submissionId);
    const r = await confirmMaterialImportAction(fd);
    importingRef.current = false;
    setImporting(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResult(r.data);
  }

  const filteredRows = useMemo(
    () => (preview ? (filter === "all" ? preview.rows : preview.rows.filter((r) => STATUS_GROUP[r.status] === filter)) : []),
    [preview, filter]
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((Math.min(page, totalPages) - 1) * PAGE_SIZE, Math.min(page, totalPages) * PAGE_SIZE);
  const mappingChanged = preview !== null && JSON.stringify(mapping) !== JSON.stringify(preview.mapping);
  const optionsChanged =
    preview !== null &&
    (sheetName !== preview.sheetName ||
      (headerMode !== "auto" && (headerMode === "yes") !== preview.hasHeaderRow) ||
      mappingChanged ||
      JSON.stringify(resolutions) !== JSON.stringify(preview.categoryResolutions));
  const needsConfirmation = preview !== null && preview.needsConfirmation.length > 0;
  const shownOptional = preview ? OPTIONAL_IMPORT_FIELDS.filter((f) => preview.mapping[f] !== null) : [];

  function previewAgain(confirmMapping: boolean) {
    if (!file || !preview) return;
    const sheetChanged = sheetName !== preview.sheetName;
    void runPreview(file, {
      sheetName,
      headerMode,
      mapping: sheetChanged ? null : mapping,
      // Choosing different columns is itself the confirmation.
      mappingConfirmed: !sheetChanged && (confirmMapping || mappingChanged || !needsConfirmation),
      resolutions: sheetChanged ? {} : resolutions,
    });
  }

  function setResolution(key: string, value: string) {
    setResolutions((current) => {
      const next = { ...current };
      if (value === CREATE_CATEGORY) next[key] = { action: "create" };
      else if (value.startsWith(CATEGORY_CHOICE_PREFIX)) next[key] = { action: "map", category: value.slice(CATEGORY_CHOICE_PREFIX.length) };
      else delete next[key];
      return next;
    });
  }

  function createAllNewCategories() {
    if (!preview) return;
    setResolutions((current) => {
      const next = { ...current };
      for (const c of preview.categoryReview) if (c.key) next[c.key] = { action: "create" };
      return next;
    });
  }

  const summaryCards: { key: StatusFilter; label: string; value: number }[] = preview
    ? [
        { key: "all", label: "Total Excel rows", value: preview.summary.totalRows },
        { key: "valid", label: "Valid new materials", value: preview.summary.valid },
        { key: "existing", label: "Existing matches", value: preview.summary.existing },
        { key: "duplicate", label: "Duplicates in file", value: preview.summary.duplicates },
        { key: "code", label: "Missing codes", value: preview.breakdown.missingCodes },
        { key: "description", label: "Missing descriptions", value: preview.breakdown.missingDescriptions },
        { key: "missingUnit", label: "Missing units", value: preview.breakdown.missingUnits },
        { key: "invalid", label: "Invalid values", value: preview.breakdown.invalidValues },
        { key: "unit", label: "Invalid units", value: preview.summary.invalidUnits },
        { key: "category", label: "Unknown categories", value: preview.breakdown.unknownCategories },
      ]
    : [];

  function columnSelect(label: string, field: MaterialImportField, optional = false) {
    if (!preview || !mapping) return null;
    const value = mapping[field];
    return (
      <div>
        <label htmlFor={`map-${field}`} className={labelCls}>{label}</label>
        <select
          id={`map-${field}`}
          value={value === null ? "" : String(value)}
          onChange={(e) => setMapping({ ...mapping, [field]: e.target.value === "" ? null : Number(e.target.value) })}
          className={inputCls}
        >
          <option value="">{optional ? "Not included" : "Choose a column"}</option>
          {preview.columns.map((c) => (
            <option key={c.column} value={c.column}>
              Column {c.letter}{c.firstRowText ? ` — ${c.firstRowText}` : ""}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black text-[#111827]">1. Choose the Excel material master</h2>
        <p className="mt-1 text-xs text-[#4B5563]">
          Columns are found from your file’s headers, in any order, and you can change them below. Item Code, Material Description and
          Unit are required. Materials are registered with <strong>zero stock</strong>; no receiving, issuing, purchase or opening-stock
          quantity is created, and existing materials are never changed. Without a Category column, materials go to “Other”.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className="sr-only"
            id="material-master-file"
          />
          <label
            htmlFor="material-master-file"
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white hover:bg-[#c8181e]"
          >
            <Upload className="h-4 w-4" aria-hidden />
            {file ? "Choose another file" : "Choose Excel file"}
          </label>
          {file && (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#111827]">
              <FileSpreadsheet className="h-4 w-4 text-green-700" aria-hidden />
              {file.name}
            </span>
          )}
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-sm text-[#4B5563]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading file…
            </span>
          )}
        </div>
        <p className="mt-3 text-xs text-[#4B5563]">
          <strong className="font-bold">Units from Excel</strong>
          <br />
          All valid units are accepted. Units are saved exactly as entered in Excel. No automatic conversion is applied.
        </p>
      </section>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-[#B91C1C]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {result && (
        <section className="rounded-md border border-green-200 bg-green-50 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-black text-green-800">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {result.alreadyImported ? "This import was already saved" : "Import complete"}
          </h2>
          <p className="mt-1 text-sm text-[#111827]">
            {result.imported} material{result.imported === 1 ? "" : "s"} registered with zero stock · batch{" "}
            <span className="font-mono">{result.batchReference}</span>
          </p>
          {result.skippedRows.length > 0 && (
            <div className="mt-2 text-xs text-[#4B5563]">
              <p className="font-bold text-amber-700">
                {result.skippedRows.length} confirmed row{result.skippedRows.length === 1 ? " was" : "s were"} no longer valid and not imported:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {result.skippedRows.slice(0, 50).map((r) => (
                  <li key={r.rowNumber}>Row {r.rowNumber} ({r.itemCode || "no code"}): {r.message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/store/offline-inventory" className="inline-flex min-h-[44px] items-center rounded-md bg-[#111827] px-4 text-sm font-bold text-white">
              Go to Inventory Control
            </Link>
            <button
              type="button"
              onClick={() => {
                if (fileRef.current) fileRef.current.value = "";
                onFileChange(null);
              }}
              className="inline-flex min-h-[44px] items-center rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#111827]"
            >
              Import another file
            </button>
          </div>
        </section>
      )}

      {preview && !result && (
        <>
          <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black text-[#111827]">2. Sheet and columns</h2>
            <p className="mt-1 text-xs text-[#4B5563]">
              {preview.headerDetected ? "A header row was detected." : "No header row detected — reading every row as data."} Change anything
              below and press Preview again.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="lg:col-span-2">
                <label htmlFor="sheet" className={labelCls}>Sheet</label>
                <select id="sheet" value={sheetName} onChange={(e) => setSheetName(e.target.value)} className={inputCls}>
                  {preview.sheetNames.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="header-mode" className={labelCls}>First row</label>
                <select id="header-mode" value={headerMode} onChange={(e) => setHeaderMode(e.target.value as "auto" | "yes" | "no")} className={inputCls}>
                  <option value="auto">Detect automatically</option>
                  <option value="yes">Is a header row</option>
                  <option value="no">Is data (no header)</option>
                </select>
              </div>
              {columnSelect("Item Code", "itemCode")}
              {columnSelect("Material Description", "description")}
              {columnSelect("Unit", "unit")}
              {columnSelect("Serial Number (display only)", "serial", true)}
            </div>
            <h3 className="mt-4 text-xs font-black text-[#4B5563]">Optional columns</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {OPTIONAL_IMPORT_FIELDS.map((f) => (
                <div key={f}>{columnSelect(MATERIAL_IMPORT_FIELD_LABELS[f], f, true)}</div>
              ))}
            </div>
            {preview.unmappedColumns.length > 0 && (
              <p className="mt-2 text-xs text-[#6B7280]">
                Ignored columns: {preview.unmappedColumns.map((c) => `${c.letter}${c.firstRowText ? ` (${c.firstRowText})` : ""}`).join(", ")}
              </p>
            )}
            {needsConfirmation && (
              <div role="alert" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <p className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  Needs confirmation
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {preview.needsConfirmation.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => previewAgain(true)}
                  className="mt-2 inline-flex min-h-[44px] items-center rounded-md bg-[#111827] px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  Confirm these columns
                </button>
              </div>
            )}
            <button
              type="button"
              disabled={loading || !file}
              onClick={() => previewAgain(false)}
              className={`mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-4 text-sm font-bold ${
                optionsChanged ? "bg-[#111827] text-white" : "border border-[#E5E7EB] bg-white text-[#111827]"
              } disabled:opacity-50`}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Preview again
            </button>
            {optionsChanged && <span className="ml-2 text-xs font-bold text-amber-700">Options changed — preview again before importing.</span>}
          </section>

          {preview.categoryReview.length > 0 && (
            <section className="rounded-md border border-amber-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-black text-[#111827]">Categories — New / Needs Review</h2>
              <p className="mt-1 text-xs text-[#4B5563]">
                These categories are not in Inventory yet. Decide for each one, then press Preview again. Rows without a decision are not imported.
              </p>
              <div className="mt-3 space-y-2">
                {preview.categoryReview.map((c) => (
                  <div key={c.key} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr]">
                    <p className="text-sm font-semibold text-[#111827]">
                      {c.value || "(blank category)"} <span className="font-normal text-[#6B7280]">— {c.rows} row{c.rows === 1 ? "" : "s"}</span>
                    </p>
                    <select
                      aria-label={`Decision for category ${c.value || "blank"}`}
                      value={resolutionValue(resolutions[c.key])}
                      onChange={(e) => setResolution(c.key, e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Needs review — do not import</option>
                      {c.key && <option value={CREATE_CATEGORY}>Create as a new category</option>}
                      {preview.knownCategories.map((k) => (
                        <option key={k} value={`${CATEGORY_CHOICE_PREFIX}${k}`}>Use existing: {k}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={createAllNewCategories}
                className="mt-3 inline-flex min-h-[44px] items-center rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#111827] hover:bg-gray-50"
              >
                Create all as new categories
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => previewAgain(false)}
                className="ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-[#111827] px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Preview again
              </button>
            </section>
          )}

          <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] p-4">
              <h2 className="text-sm font-black text-[#111827]">3. Review — sheet “{preview.sheetName}”</h2>
              <p className="mt-1 text-xs text-[#6B7280]">Rows requiring review: {preview.breakdown.rowsRequiringReview}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {summaryCards.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      setFilter(c.key);
                      setPage(1);
                    }}
                    className={`rounded-md border px-3 py-2 text-left ${filter === c.key ? "border-[#111827] ring-1 ring-[#111827]" : "border-[#E5E7EB]"}`}
                  >
                    <p className="text-xl font-black text-[#111827]">{c.value}</p>
                    <p className="text-[10px] font-bold uppercase leading-tight text-[#6B7280]">{c.label}</p>
                  </button>
                ))}
              </div>
            </div>
            {filteredRows.length === 0 ? (
              <p className="p-6 text-center text-sm text-[#6B7280]">No rows in this view.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-[#F3F4F6] text-left text-[11px] font-bold uppercase tracking-wide text-[#4B5563]">
                    <tr>
                      <th className="px-2.5 py-2">Row</th>
                      <th className="px-2.5 py-2">S. No.</th>
                      <th className="px-2.5 py-2">Item Code</th>
                      <th className="px-2.5 py-2">Material Description</th>
                      <th className="px-2.5 py-2">Unit</th>
                      {shownOptional.map((f) => (
                        <th key={f} className="px-2.5 py-2">{MATERIAL_IMPORT_FIELD_LABELS[f]}</th>
                      ))}
                      <th className="px-2.5 py-2">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {pageRows.map((r) => {
                      const group = STATUS_GROUP[r.status];
                      return (
                        <tr key={r.rowNumber}>
                          <td className="px-2.5 py-1.5 text-xs text-[#6B7280]">{r.rowNumber}</td>
                          <td className="px-2.5 py-1.5 text-xs text-[#6B7280]">{r.serial || "—"}</td>
                          <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-xs text-[#111827]">{r.itemCode || "—"}</td>
                          <td className="min-w-[220px] px-2.5 py-1.5 text-[#111827]">{r.description || "—"}</td>
                          <td className="whitespace-nowrap px-2.5 py-1.5 text-xs">
                            {r.unit || "—"}
                          </td>
                          {shownOptional.map((f) => (
                            <td key={f} className="px-2.5 py-1.5 text-xs text-[#4B5563]">
                              {f === "category" ? (
                                <>
                                  {r.resolvedCategory ?? r.category ?? ""}
                                  {r.categoryState === "new" && <span className="ml-1 font-bold text-[#2563EB]">New</span>}
                                  {r.categoryState === "mapped" && r.category && <span className="block text-[11px] text-[#9CA3AF]">from {r.category}</span>}
                                  {!r.category && !r.resolvedCategory && "—"}
                                </>
                              ) : (
                                r[f as keyof typeof r] || "—"
                              )}
                            </td>
                          ))}
                          <td className="min-w-[200px] px-2.5 py-1.5">
                            <StatusBadge label={GROUP_LABEL[group]} tone={GROUP_TONE[group]} />
                            {r.status !== "valid" && <p className="mt-0.5 text-[11px] leading-tight text-[#6B7280]">{r.message}</p>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-2 border-t border-[#E5E7EB] px-3 py-2 text-xs">
                <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="rounded-md border border-[#E5E7EB] px-2.5 py-1 font-bold disabled:opacity-40">
                  Previous
                </button>
                <span>Page {Math.min(page, totalPages)} of {totalPages}</span>
                <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="rounded-md border border-[#E5E7EB] px-2.5 py-1 font-bold disabled:opacity-40">
                  Next
                </button>
              </div>
            )}
          </section>

          <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black text-[#111827]">4. Confirm import</h2>
            {preview.summary.valid === 0 ? (
              <p className="mt-2 text-sm text-[#4B5563]">No rows are ready to import.</p>
            ) : (
              <>
                <label className="mt-2 flex min-h-[44px] items-start gap-2 text-sm font-semibold text-[#111827]">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    disabled={optionsChanged || needsConfirmation}
                    className="mt-1 h-4 w-4 accent-[#ED1C24]"
                  />
                  Register the {preview.summary.valid} ready material{preview.summary.valid === 1 ? "" : "s"} in Inventory Control with zero
                  stock. {preview.summary.totalRows - preview.summary.valid} other row(s) will not be imported.
                </label>
                <button
                  type="button"
                  onClick={runImport}
                  disabled={!confirmed || importing || optionsChanged || needsConfirmation}
                  className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-[#ED1C24] px-5 text-sm font-bold text-white hover:bg-[#c8181e] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                  {importing ? "Importing…" : `Import ${preview.summary.valid} material${preview.summary.valid === 1 ? "" : "s"}`}
                </button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
