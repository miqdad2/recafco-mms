"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import {
  parseAssetExcelForImportAction,
  addAssetsFromExcelAction,
  replaceAssetRegisterAction,
} from "@/app/actions/asset-import";
import type { AssetImportPreview, AssetImportPreviewRow, AssetImportResult } from "@/app/actions/asset-import";

// Asset Register Import Mapping and New Asset Form Update Unit 10G.34, Task
// 2/3/14. Two very different actions live behind this one screen:
//   - "Add these assets" (addAssetsFromExcelAction) — never deletes
//     anything, skips rows that already exist. This is what a plain upload
//     click runs.
//   - "Replace Asset Register" (replaceAssetRegisterAction) — removes the
//     current asset list first. Only reachable by explicitly turning on the
//     Replace toggle, reading the warning, and typing the confirmation
//     phrase (Task 3 — "do not accidentally delete assets on normal upload
//     click").
// Every message on this screen is written for a normal maintenance user —
// no column names, no "mapping", no "category" jargon.
//
// Import Excel Popup Flow Unit 10G.40: `modalMode` is set only when this
// form renders inside the Assets & Equipment page's Import Excel popup
// (LargeFormModal, via app/(dashboard)/assets/page.tsx) — the standalone
// /assets/import page keeps rendering this exact same form with
// modalMode left false, completely unchanged (Task 2/11). None of the
// parse/add/replace server actions below were touched — only what this
// component shows and where a successful import sends the user.

type Step = "upload" | "preview" | "done";

const REPLACE_CONFIRM_PHRASE = "REPLACE";

// Import Assets Page UI Simplification Unit 10G.39, Task 5: the exact
// simple field list shown to a normal maintenance user — matches the same
// field names used on the New Asset / Edit Asset form (Unit 10G.34/10G.38),
// not the underlying Excel header text or database column names.
const EXCEL_COLUMNS = [
  "Asset Type",
  "Make / Asset Name",
  "Model / Year",
  "Plate No.",
  "Chassis No.",
  "Colour",
  "File No.",
  "Department / Location",
  "Responsible Person / Driver",
  "Expires On",
  "Remarks",
];

// Unit 10G.40, Task 4: a compact, always-3-item step indicator shown only
// inside the popup (the standalone page already has its own bigger step
// cards from Unit 10G.39, so it isn't repeated there).
const IMPORT_STEP_LABELS = ["Upload Excel", "Check Preview", "Add or Replace Assets"];

function ImportStepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-md border border-[#E5E7EB] bg-gray-50 p-2.5">
      {IMPORT_STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const complete = n < current;
        return (
          <div key={label} className="flex min-w-0 items-center gap-1.5">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${
                active ? "bg-[#ED1C24] text-white" : complete ? "bg-[#111827] text-white" : "border border-[#E5E7EB] bg-white text-[#9CA3AF]"
              }`}
            >
              {n}
            </span>
            <span className={`truncate text-[11px] font-bold leading-tight ${active ? "text-[#111827]" : "text-[#9CA3AF]"}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function displayValue(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export function AssetImportForm({ modalMode = false, canReplace = false }: { modalMode?: boolean; canReplace?: boolean } = {}) {
  const router = useRouter();
  const modal = useLargeFormModal();
  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<AssetImportPreview | null>(null);
  const [result, setResult] = useState<AssetImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [replaceTyped, setReplaceTyped] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows: AssetImportPreviewRow[] = preview?.rows ?? [];
  const readyRows = rows.filter((r) => !r.isDuplicatePlate && !r.isDuplicateChassis);
  const canConfirmReplace = replaceTyped.trim().toUpperCase() === REPLACE_CONFIRM_PHRASE;

  async function handleUploadSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const res = await parseAssetExcelForImportAction(formData);
      if (res.error) { setError(res.error); return; }
      setPreview(res);
      setStep("preview");
    } catch {
      setError("Something went wrong reading this file. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!preview || readyRows.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await addAssetsFromExcelAction(rows);
      // Task 8 — in the popup, a successful import closes the popup,
      // refreshes the Assets page's own data, and shows the success toast
      // all in one step: navigating to a fresh /assets URL drops
      // ?import_assets=1 (closing the modal), re-runs the Assets page's
      // server-side data fetch (Total Assets / Asset Types / Asset
      // Register all update), and the existing ?success= toast convention
      // (lib/action-messages.ts) shows "Import completed successfully."
      if (modalMode) {
        router.push("/assets?success=import-completed");
        return;
      }
      setResult(res);
      setStep("done");
    } catch {
      setError("Import failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleReplace() {
    if (!preview || !canConfirmReplace) return;
    setLoading(true);
    setError(null);
    try {
      const res = await replaceAssetRegisterAction(rows);
      if (modalMode) {
        router.push("/assets?success=import-completed");
        return;
      }
      setResult(res);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replace failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep("upload");
    setPreview(null);
    setResult(null);
    setError(null);
    setReplaceMode(false);
    setReplaceTyped("");
    setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Done step — unreachable in modalMode (handleAdd/handleReplace return
  //     early via router.push above), still used as-is by the standalone
  //     /assets/import page (Task 2/11). ─────────────────────────────────
  if (step === "done" && result) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" aria-hidden="true" />
            <p className="font-bold text-[#111827]">Import completed successfully.</p>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {result.replaced && (
              <div className="rounded-md border border-[#E5E7EB] bg-white p-3 text-center">
                <dt className="text-xs font-semibold text-[#4B5563]">Old assets removed</dt>
                <dd className="text-2xl font-black text-[#111827]">{result.oldAssetsRemoved}</dd>
              </div>
            )}
            <div className="rounded-md border border-[#E5E7EB] bg-white p-3 text-center">
              <dt className="text-xs font-semibold text-[#4B5563]">Total rows found</dt>
              <dd className="text-2xl font-black text-[#111827]">{result.totalRowsFound}</dd>
            </div>
            <div className="rounded-md border border-green-200 bg-white p-3 text-center">
              <dt className="text-xs font-semibold text-[#4B5563]">Assets imported</dt>
              <dd className="text-2xl font-black text-[#16A34A]">{result.imported}</dd>
            </div>
            <div className="rounded-md border border-[#E5E7EB] bg-white p-3 text-center">
              <dt className="text-xs font-semibold text-[#4B5563]">Skipped rows</dt>
              <dd className="text-2xl font-black text-[#111827]">{result.skipped}</dd>
            </div>
            <div className={`rounded-md border p-3 text-center ${result.needsReview > 0 ? "border-amber-200 bg-white" : "border-[#E5E7EB] bg-white"}`}>
              <dt className="text-xs font-semibold text-[#4B5563]">Needs Review</dt>
              <dd className={`text-2xl font-black ${result.needsReview > 0 ? "text-amber-700" : "text-[#111827]"}`}>{result.needsReview}</dd>
            </div>
            <div className={`rounded-md border p-3 text-center ${result.duplicateWarnings > 0 ? "border-amber-200 bg-white" : "border-[#E5E7EB] bg-white"}`}>
              <dt className="text-xs font-semibold text-[#4B5563]">Duplicate warnings</dt>
              <dd className={`text-2xl font-black ${result.duplicateWarnings > 0 ? "text-amber-700" : "text-[#111827]"}`}>{result.duplicateWarnings}</dd>
            </div>
          </dl>
        </div>

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
  if (step === "preview" && preview) {
    return (
      <div className="space-y-4">
        {modalMode && <ImportStepper current={2} />}

        {/* Task 6 — simple summary: total rows, ready, needs review,
            duplicates. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-black text-[#111827]">{preview.totalRowsFound}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Total rows found</p>
          </div>
          <div className="rounded-md border border-green-200 bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-black text-[#16A34A]">{readyRows.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Assets ready</p>
          </div>
          <div className={`rounded-md border p-4 text-center shadow-sm ${preview.needsReviewCount > 0 ? "border-amber-200 bg-amber-50" : "border-[#E5E7EB] bg-white"}`}>
            <p className={`text-2xl font-black ${preview.needsReviewCount > 0 ? "text-amber-700" : "text-[#111827]"}`}>{preview.needsReviewCount}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Needs Review</p>
          </div>
          <div className={`rounded-md border p-4 text-center shadow-sm ${preview.duplicateMessages.length > 0 ? "border-amber-200 bg-amber-50" : "border-[#E5E7EB] bg-white"}`}>
            <p className={`text-2xl font-black ${preview.duplicateMessages.length > 0 ? "text-amber-700" : "text-[#111827]"}`}>{preview.duplicateMessages.length}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Duplicate warnings</p>
          </div>
        </div>

        {preview.duplicateMessages.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
            <ul className="space-y-1 text-sm text-amber-900">
              {preview.duplicateMessages.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </div>
        )}

        {/* Preview table — Task 6's required columns plus Row/Status, kept
            scrollable inside its own container so it never grows the
            popup's own height. */}
        <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <p className="text-xs font-black uppercase text-[#4B5563]">Preview</p>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Asset Type</th>
                  <th className="px-3 py-2">Make / Asset Name</th>
                  <th className="px-3 py-2">Plate No.</th>
                  <th className="px-3 py-2">Chassis No.</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Responsible Person / Driver</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {rows.map((r) => {
                  const isDup = r.isDuplicatePlate || r.isDuplicateChassis;
                  const needsReview = r.categorySource === "needs_review";
                  return (
                    <tr key={r.rowNum} className={isDup ? "bg-amber-50" : needsReview ? "bg-blue-50" : "hover:bg-gray-50"}>
                      <td className="px-3 py-2 text-[#9CA3AF]">{r.rowNum}</td>
                      <td className="px-3 py-2 font-semibold">{r.leaf}</td>
                      <td className="px-3 py-2 max-w-[14rem] truncate">{displayValue(r.make)}</td>
                      <td className="px-3 py-2">{displayValue(r.plateNumber)}</td>
                      <td className="px-3 py-2">{displayValue(r.chassisNumber)}</td>
                      <td className="px-3 py-2 text-[#4B5563]">{displayValue(r.location)}</td>
                      <td className="px-3 py-2 text-[#4B5563]">{displayValue(r.driver)}</td>
                      <td className="px-3 py-2">
                        {isDup ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Duplicate
                          </span>
                        ) : needsReview ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                            Needs Review
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ready
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

        {/* Task 7 — Add/Replace explanation. The standalone page already
            explains this on its own upload step (Unit 10G.39's "What
            happens after preview?" card), so it's shown here only inside
            the popup, right where the actual choice is made. */}
        {modalMode && (
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-wide text-[#9CA3AF]">
              Step 3 · Add or Replace Assets
            </p>
            <div className={`grid gap-2 ${canReplace ? "sm:grid-cols-2" : ""}`}>
              <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
                <p className="text-xs font-bold text-[#111827]">Add to current list</p>
                <p className="mt-1 text-xs leading-5 text-[#4B5563]">
                  Adds assets from Excel without deleting the current list.
                </p>
              </div>
              {canReplace && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-bold text-[#111827]">Replace Asset Register</p>
                  <p className="mt-1 text-xs leading-5 text-[#4B5563]">
                    Removes the current asset list and uses only the uploaded Excel list.
                  </p>
                </div>
              )}
            </div>
            {canReplace && (
              <p className="flex items-start gap-2 text-xs font-semibold text-red-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Use Replace only when this Excel is the latest full maintenance asset list.
              </p>
            )}
          </div>
        )}

        {/* Replace mode toggle + warning — Unit 10H.2 production-readiness
            review: replaceAssetRegisterAction deletes work orders, purchase
            requests, and notifications system-wide, not just old assets, so
            this whole control is now Super Admin-only (canReplace), not
            just gated by assets.manage. Non-Super-Admin users only ever see
            "Add to current list" above — no toggle they can't actually use. */}
        {canReplace && (
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-[#E5E7EB] accent-[#ED1C24]"
                checked={replaceMode}
                onChange={(e) => { setReplaceMode(e.target.checked); setReplaceTyped(""); }}
              />
              <span>
                <span className="block text-sm font-bold text-[#111827]">Replace Asset Register</span>
                <span className="block text-xs text-[#4B5563]">
                  Remove the current asset list and replace it with only the assets in this file, instead of adding to the current list.
                </span>
              </span>
            </label>

            {replaceMode && (
              <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden="true" />
                  <p className="text-sm font-semibold text-red-900">
                    This will permanently delete the current asset list AND every Job Card, materials request, purchase request, and notification in the system, then replace the asset list with the uploaded Excel list. This cannot be undone. Continue?
                  </p>
                </div>
                <label className="mt-3 block text-xs font-bold text-red-900">
                  Type REPLACE to confirm
                  <input
                    type="text"
                    value={replaceTyped}
                    onChange={(e) => setReplaceTyped(e.target.value)}
                    className="focus-ring mt-1 block w-40 rounded-md border border-red-300 px-2 py-1.5 text-sm"
                    placeholder="REPLACE"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden="true" />
            <p className="text-sm font-semibold text-[#ED1C24]">{error}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {replaceMode ? (
            <Button onClick={handleReplace} disabled={loading || !canConfirmReplace}>
              {loading ? "Replacing…" : `Replace Asset Register (${rows.length})`}
            </Button>
          ) : readyRows.length > 0 ? (
            <Button onClick={handleAdd} disabled={loading}>
              {loading ? "Importing…" : `Add ${readyRows.length} asset${readyRows.length !== 1 ? "s" : ""}`}
            </Button>
          ) : (
            <p className="text-sm font-semibold text-[#ED1C24]">No rows are ready to add — all are duplicates.</p>
          )}
          <Button variant="secondary" onClick={reset} disabled={loading}>
            Start over
          </Button>
          {modalMode && (
            <Button type="button" variant="ghost" onClick={() => modal?.requestClose()} disabled={loading}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Upload step ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {modalMode && <ImportStepper current={1} />}

      {error && (
        <div className="flex items-start gap-2.5 rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden="true" />
          <p className="text-sm font-semibold text-[#ED1C24]">{error}</p>
        </div>
      )}

      {/* Task 3/5 — upload area */}
      <form onSubmit={handleUploadSubmit} className="rounded-md border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center gap-4 rounded-md border-2 border-dashed border-[#E5E7EB] p-8 text-center">
          <div className="rounded-md bg-[#111827] p-4">
            <FileSpreadsheet className="h-8 w-8 text-white" aria-hidden="true" />
          </div>
          <div>
            <p className="text-base font-bold text-[#111827]">Upload maintenance asset Excel</p>
            <p className="mt-1 text-sm text-[#4B5563]">Choose the latest maintenance asset list in .xlsx format.</p>
            <p className="mt-1 text-xs font-semibold text-[#9CA3AF]">Accepted file type: .xlsx only</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            name="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="block w-full max-w-xs rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
            required
          />
          {fileName && (
            <p className="text-sm font-semibold text-[#111827]">
              Selected file: <span className="text-[#ED1C24]">{fileName}</span>
            </p>
          )}
        </div>

        {/* Task 4/5 — preview expectation, reduces fear of accidentally
            replacing data before the user has even uploaded anything. */}
        <p className="mt-3 text-center text-xs text-[#6B7280] sm:text-left">
          After upload, you can check the assets before saving.
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          {modalMode && (
            <Button type="button" variant="ghost" onClick={() => modal?.requestClose()} disabled={loading}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={loading} className="gap-2">
            <Upload className="h-4 w-4" aria-hidden="true" />
            {loading ? "Reading file…" : "Upload and Preview"}
          </Button>
        </div>
      </form>

      {/* Task 5/6 (Unit 10G.39) — full explanatory cards. Left out of the
          popup so it doesn't get too long (Task 4/9 of this unit); the
          popup shows the Add/Replace explanation later, right at the
          Add/Replace step instead (see the preview step above). */}
      {!modalMode && (
        <>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-[#111827]">Excel columns used</p>
            <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm text-[#374151] sm:grid-cols-2">
              {EXCEL_COLUMNS.map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ED1C24]" aria-hidden="true" />
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-[#6B7280]">
              Plate numbers and chassis numbers are kept exactly as written.
            </p>
          </div>

          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-[#111827]">What happens after preview?</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-[#E5E7EB] p-3">
                <p className="text-sm font-bold text-[#111827]">Add to current list</p>
                <p className="mt-1 text-xs leading-5 text-[#4B5563]">
                  Adds the assets from Excel without deleting the current list.
                </p>
              </div>
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-bold text-[#111827]">Replace Asset Register</p>
                <p className="mt-1 text-xs leading-5 text-[#4B5563]">
                  Removes the current asset list and uses only the uploaded Excel list.
                </p>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs font-semibold text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Use Replace only when this Excel is the latest full maintenance asset list.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
