"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, PauseCircle, Upload, XCircle } from "lucide-react";

import { confirmOpeningStockImportAction, previewOpeningStockImportAction } from "@/app/actions/opening-stock-import";
import type {
  OpeningStockBatchSummary,
  OpeningStockImportResult,
  OpeningStockPreview,
  OpeningStockPreviewRow,
} from "@/lib/backend/store/opening-stock-import";
import type { ProposedAction } from "@/lib/store/opening-stock-matching";
import { OpeningStockBatchPanel } from "@/components/store/opening-stock-batch-panel";
import { ErrorBox, ResultCards, ResultTable, TONES } from "@/components/store/opening-stock-import-shared";

type Step = "upload" | "preview" | "done";
type Filter = "all" | ProposedAction;

// What the import will do with each row, in staff language.
const PLAN: Record<ProposedAction, { label: string; badge: string }> = {
  post_existing: { label: "Import to existing", badge: "bg-green-100 text-green-700" },
  register_new: { label: "Register new", badge: "bg-blue-100 text-blue-700" },
  hold: { label: "Hold for review", badge: "bg-amber-100 text-amber-800" },
  none: { label: "Failed", badge: "bg-red-100 text-[#ED1C24]" },
};

export function OpeningStockImportForm({ recentBatches, canApprove }: { recentBatches: OpeningStockBatchSummary[]; canApprove: boolean }) {
  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<OpeningStockPreview | null>(null);
  const [result, setResult] = useState<OpeningStockImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileObj = useRef<File | null>(null);
  const submissionId = useRef<string>("");

  const rows = useMemo(() => preview?.rows ?? [], [preview]);
  const plan = useMemo(() => {
    const p: Record<ProposedAction, { rows: number; qty: number }> = {
      post_existing: { rows: 0, qty: 0 },
      register_new: { rows: 0, qty: 0 },
      hold: { rows: 0, qty: 0 },
      none: { rows: 0, qty: 0 },
    };
    for (const r of rows) {
      p[r.proposedAction].rows += 1;
      p[r.proposedAction].qty += r.quantity ?? 0;
    }
    return p;
  }, [rows]);
  const visible = filter === "all" ? rows : rows.filter((r) => r.proposedAction === filter);

  async function handleParse(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const file = formData.get("file");
    setLoading(true);
    setError(null);
    setConfirmed(false);
    try {
      const res = await previewOpeningStockImportAction(formData);
      if (!res.ok) { setError(res.error); return; }
      fileObj.current = file instanceof File ? file : null;
      // One id per checked file: a retry or double click returns the first result.
      submissionId.current = crypto.randomUUID();
      setPreview(res.data);
      setFilter("all");
      setStep("preview");
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!preview || !fileObj.current || !confirmed) return;
    setLoading(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", fileObj.current);
    fd.set("decisions", "{}");
    fd.set("client_submission_id", submissionId.current);
    fd.set("fingerprint", preview.fingerprint);
    try {
      const res = await confirmOpeningStockImportAction(fd);
      if (!res.ok) { setError(res.error); return; }
      setResult(res.data);
      setStep("done");
    } catch {
      setError("The connection was interrupted. Press Import again: if the import was already saved, its result is shown and nothing is posted twice.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep("upload");
    setPreview(null);
    setResult(null);
    setError(null);
    setConfirmed(false);
    fileObj.current = null;
    if (fileRef.current) fileRef.current.value = "";
  }

  if (openBatch) {
    return <OpeningStockBatchPanel batchReference={openBatch} onClose={() => setOpenBatch(null)} />;
  }

  // ── Done step ──────────────────────────────────────────────────────────────
  if (step === "done" && result) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" aria-hidden />
            <p className="font-bold text-[#111827]">{result.alreadyProcessed ? "This import was already completed" : "Import complete"}</p>
          </div>
          <p className="mt-2 text-xs text-[#4B5563]">
            Import batch reference: <span className="font-mono font-bold text-[#111827]">{result.batchReference}</span>
          </p>
          <ResultCards r={result} />
          <p className="mt-3 text-xs font-semibold text-[#4B5563]">
            {result.totalRows} rows in the file — every row and its quantity is kept in the import record. Quantity added now: {result.postedQuantity}.
          </p>
          {result.held > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-sm font-semibold text-amber-900">
                {result.held} row{result.held !== 1 ? "s are" : " is"} held — no stock was recorded for {result.held !== 1 ? "them" : "it"}.
                {canApprove ? "" : " The System Administrator or Maintenance Manager resolves held rows."}
              </p>
              <button type="button" onClick={() => setOpenBatch(result.batchReference)} className="min-h-11 rounded-md bg-[#111827] px-4 text-sm font-bold text-white">
                {canApprove ? "Resolve held rows" : "View held rows"}
              </button>
            </div>
          )}
        </div>

        <ResultTable rows={result.rows} />

        <div className="flex flex-wrap gap-3">
          <Link
            href="/store/offline-inventory"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[#ED1C24] bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            View Offline Inventory Control
          </Link>
          <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50">
            Import another file
          </button>
        </div>
      </div>
    );
  }

  // ── Preview step ──────────────────────────────────────────────────────────
  if (step === "preview" && preview) {
    const total = rows.length;
    return (
      <div className="space-y-4">
        {preview.previousBatch && (
          <div className="flex flex-wrap items-start gap-2.5 rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden />
            <p className="flex-1 text-sm font-semibold text-[#ED1C24]">
              This file was already imported (batch {preview.previousBatch.batchReference}, {new Date(preview.previousBatch.importedAt).toLocaleString()}). It cannot be
              imported again. Held rows are resolved from that batch.
            </p>
            <button type="button" onClick={() => setOpenBatch(preview.previousBatch!.batchReference)} className="min-h-11 rounded-md bg-[#111827] px-4 text-sm font-bold text-white">
              Open batch
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <FilterCard active={filter === "all"} onClick={() => setFilter("all")} value={total} label="Total rows" tone="plain" />
          <FilterCard active={filter === "post_existing"} onClick={() => setFilter("post_existing")} value={plan.post_existing.rows} label="Import to existing" tone="green" />
          <FilterCard active={filter === "register_new"} onClick={() => setFilter("register_new")} value={plan.register_new.rows} label="Register new" tone="blue" />
          <FilterCard active={filter === "hold"} onClick={() => setFilter("hold")} value={plan.hold.rows} label="Hold for review" tone="amber" />
          <FilterCard active={filter === "none"} onClick={() => setFilter("none")} value={plan.none.rows} label="Failed" tone="red" />
        </div>

        <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          <p className="text-sm font-semibold text-amber-900">
            Clear rows are imported now: an existing material is used only when its name or exact part number, type, make and unit agree; a row is
            registered as new only when nothing in Inventory resembles it. Every other row is held with no stock, to be resolved later from this batch.
            Units are never converted (PCS and Nos count as the same unit).
          </p>
        </div>

        <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <p className="text-xs font-black uppercase text-[#4B5563]">
              {visible.length} of {total} rows — {preview.fileName}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-240 text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Material Name</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">What will happen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {visible.map((r) => <PreviewRow key={r.rowNumber} row={r} />)}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="font-bold text-amber-900">What this import will do</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            <li>Add opening stock to <strong>{plan.post_existing.rows}</strong> existing materials (quantity {plan.post_existing.qty}).</li>
            <li>Register <strong>{plan.register_new.rows}</strong> new materials with new Item Codes (quantity {plan.register_new.qty}).</li>
            <li>Hold <strong>{plan.hold.rows}</strong> rows for review — no stock now (quantity {plan.hold.qty} kept in the record).</li>
            <li>Record <strong>{plan.none.rows}</strong> failed rows that cannot post stock.</li>
            <li className="font-semibold">All {total} rows and their quantities are kept in the import record. This cannot be undone automatically.</li>
          </ul>
          {!preview.previousBatch && (
            <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-amber-900 select-none">
              <input type="checkbox" className="h-4 w-4 rounded border-amber-400 accent-[#ED1C24]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I have reviewed the rows above and want to import this file.
            </label>
          )}
        </div>

        {error && <ErrorBox message={error} />}

        <div className="flex flex-wrap gap-3">
          {!preview.previousBatch && (
            <button
              type="button"
              onClick={handleImport}
              disabled={loading || !confirmed}
              className="min-h-11 rounded-md bg-[#ED1C24] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Importing…" : "Import"}
            </button>
          )}
          <button
            type="button"
            onClick={reset}
            disabled={loading}
            className="min-h-11 rounded-md border border-[#E5E7EB] bg-white px-5 py-2.5 text-sm font-bold text-[#4B5563] hover:bg-gray-50 disabled:opacity-50"
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
      {error && <ErrorBox message={error} />}

      <form onSubmit={handleParse} className="rounded-md border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="flex flex-col items-center gap-4 rounded-md border-2 border-dashed border-[#E5E7EB] p-8 text-center">
          <div className="rounded-md bg-[#111827] p-3">
            <FileSpreadsheet className="h-6 w-6 text-white" aria-hidden />
          </div>
          <div>
            <p className="font-bold text-[#111827]">Upload Excel file</p>
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
          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#ED1C24] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            <Upload className="h-4 w-4" aria-hidden />
            {loading ? "Checking file…" : "Check file"}
          </button>
        </div>
      </form>

      {recentBatches.length > 0 && (
        <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <p className="text-xs font-black uppercase text-[#4B5563]">Recent opening stock imports</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-180 text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Existing / New</th>
                  <th className="px-3 py-2">Held</th>
                  <th className="px-3 py-2">Failed</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {recentBatches.map((b) => (
                  <tr key={b.batchReference}>
                    <td className="px-3 py-2 font-mono text-xs text-[#111827]">{b.batchReference}<div className="font-sans text-[#9CA3AF]">{new Date(b.createdAt).toLocaleString()} · {b.createdByName}</div></td>
                    <td className="px-3 py-2 text-[#4B5563]">{b.fileName}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[#4B5563]">{b.postedExisting} / {b.registeredNew}</td>
                    <td className={`whitespace-nowrap px-3 py-2 font-bold ${b.held > 0 ? "text-amber-700" : "text-[#9CA3AF]"}`}>{b.held}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[#4B5563]">{b.failed}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => setOpenBatch(b.batchReference)} className="min-h-11 rounded-md border border-[#E5E7EB] px-3 text-xs font-bold text-[#111827] hover:bg-gray-50">
                        {b.held > 0 && canApprove ? "Resolve held rows" : "Open"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                ["Material Name", true],
                ["Category", true],
                ["Part Number", false],
                ["SS Rec. Code", false],
                ["Opening Quantity", true],
                ["Unit", true],
                ["Location / Bin", false],
                ["Remarks", false],
              ].map(([col, req]) => (
                <tr key={String(col)}>
                  <td className="px-3 py-2 font-semibold">{col}</td>
                  <td className="px-3 py-2">{req ? <span className="font-bold text-[#ED1C24]">Required</span> : <span className="text-[#9CA3AF]">Optional</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[#9CA3AF]">
          Headers are matched case-insensitively. Only the first sheet is used. Opening Quantity must be a whole number greater than 0. Unit must be one of the
          allowed units (PCS, SET, BOX, PACK, MTR, ROLL, KG, LTR, DRUM, BAG, PAIR, NOS) or a unit already used in Inventory.
        </p>
      </div>
    </div>
  );
}

function FilterCard({ value, label, tone, active, onClick }: { value: number; label: string; tone: keyof typeof TONES; active: boolean; onClick: () => void }) {
  const t = value > 0 ? TONES[tone] : TONES.plain;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`min-h-11 rounded-md border p-4 text-center shadow-sm transition ${t.box} ${active ? "ring-2 ring-[#ED1C24]" : "hover:opacity-90"}`}>
      <p className={`text-2xl font-black ${t.text}`}>{value}</p>
      <p className="mt-1 text-xs font-semibold text-[#4B5563]">{label}</p>
    </button>
  );
}

function PreviewRow({ row }: { row: OpeningStockPreviewRow }) {
  const plan = PLAN[row.proposedAction];
  const rowClass = row.proposedAction === "none" ? "bg-red-50" : row.proposedAction === "hold" ? "bg-amber-50/60" : "";
  return (
    <tr className={rowClass}>
      <td className="whitespace-nowrap px-3 py-2 align-top text-[#9CA3AF]">{row.rowNumber}</td>
      <td className="min-w-48 max-w-64 px-3 py-2 align-top font-semibold text-[#111827]">{row.materialName || <span className="text-[#ED1C24]">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-2 align-top font-semibold text-[#111827]">{row.quantityText || "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 align-top text-[#4B5563]">{row.unit || "—"}</td>
      <td className="whitespace-nowrap px-3 py-2 align-top text-[#4B5563]">{row.category || "—"}</td>
      <td className="px-3 py-2 align-top">
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${plan.badge}`}>
          {row.proposedAction === "hold" ? <PauseCircle className="h-3 w-3" aria-hidden /> : row.proposedAction === "none" ? <XCircle className="h-3 w-3" aria-hidden /> : <CheckCircle2 className="h-3 w-3" aria-hidden />}
          {plan.label}
        </span>
      </td>
      <td className="min-w-88 px-3 py-2 align-top text-xs text-[#4B5563]">{row.message}</td>
    </tr>
  );
}
