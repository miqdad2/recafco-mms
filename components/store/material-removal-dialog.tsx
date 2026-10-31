"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Archive, Ban, Loader2, Trash2, X } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  executeMaterialRemovalAction,
  previewMaterialRemovalAction,
} from "@/app/actions/material-master";
import type {
  MaterialRemovalPreview,
  MaterialRemovalResult,
} from "@/lib/backend/store/material-master";

// Super Admin delete / archive review for one or many materials. Step 1
// loads what would happen to each one from the server (nothing is changed);
// step 2 runs only after the administrator ticks the confirmation and
// presses the button once (it is disabled while running); step 3 shows the
// server's per-material result. Blocked materials are never sent.

const outcomeTone = {
  delete: "red",
  archive: "amber",
  blocked: "gray",
  already_archived: "gray",
  not_found: "gray",
} as const;

const outcomeLabel = {
  delete: "Permanently delete",
  archive: "Archive (keeps history)",
  blocked: "Blocked",
  already_archived: "Already archived",
  not_found: "Not found",
} as const;

const resultTone = {
  deleted: "green",
  archived: "green",
  blocked: "gray",
  changed: "amber",
  not_found: "gray",
  already_archived: "gray",
  failed: "red",
} as const;

const resultLabel = {
  deleted: "Deleted",
  archived: "Archived",
  blocked: "Not removed",
  changed: "Changed — not removed",
  not_found: "Not found",
  already_archived: "Already archived",
  failed: "Failed",
} as const;

function qty(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function MaterialRemovalDialog({
  keys,
  canViewCosts,
  onClose,
  onDone,
}: {
  keys: string[];
  canViewCosts: boolean;
  onClose: () => void;
  // Called once after a run that changed anything, before results show.
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<MaterialRemovalPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<MaterialRemovalResult[] | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    let alive = true;
    previewMaterialRemovalAction(keys).then((r) => {
      if (!alive) return;
      if (r.ok) setPreview(r.data);
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [keys]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !runningRef.current) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const actionable = (preview ?? []).filter((p) => p.outcome === "delete" || p.outcome === "archive");
  const counts = {
    delete: (preview ?? []).filter((p) => p.outcome === "delete").length,
    archive: (preview ?? []).filter((p) => p.outcome === "archive").length,
    blocked: (preview ?? []).filter((p) => p.outcome !== "delete" && p.outcome !== "archive").length,
  };

  async function run() {
    if (runningRef.current || actionable.length === 0 || !acknowledged) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    const r = await executeMaterialRemovalAction({
      requests: actionable.map((p) => ({ key: p.key, expectedOutcome: p.outcome })),
      reason: reason.trim() || null,
      confirmed: true,
    });
    runningRef.current = false;
    setRunning(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // Blocked rows were never sent — show them in the result list too.
    const sent = new Set(actionable.map((p) => p.key));
    const notSent: MaterialRemovalResult[] = (preview ?? [])
      .filter((p) => !sent.has(p.key))
      .map((p) => ({
        key: p.key,
        display_name: p.display_name,
        status: p.outcome === "already_archived" ? "already_archived" : p.outcome === "not_found" ? "not_found" : "blocked",
        message: p.reasons.join("; "),
      }));
    setResults([...r.data, ...notSent]);
    if (r.data.some((x) => x.status === "deleted" || x.status === "archived")) onDone();
  }

  const succeeded = results?.filter((r) => r.status === "deleted" || r.status === "archived").length ?? 0;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" aria-hidden="true" onClick={() => !running && onClose()} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="material-removal-heading"
          className="flex max-h-[90vh] w-[min(96vw,980px)] flex-col rounded-xl bg-white shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[#E5E7EB] px-5 py-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">System Administrator</p>
              <h2 id="material-removal-heading" className="mt-0.5 text-lg font-black text-[#111827]">
                {results ? "Delete Result" : keys.length === 1 ? "Delete Material" : `Delete Selected Materials (${keys.length})`}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={running}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[#4B5563] hover:bg-gray-100 disabled:opacity-40"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-[#B91C1C]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            {results ? (
              <>
                <p className="text-sm font-semibold text-[#111827]">
                  {succeeded} of {results.length} material{results.length === 1 ? "" : "s"} removed.
                  {succeeded < results.length && " The others were not changed — see each row."}
                </p>
                <ul className="divide-y divide-[#F3F4F6] rounded-md border border-[#E5E7EB]">
                  {results.map((r) => (
                    <li key={r.key} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-[#111827]">{r.display_name}</span>
                        <span className="block text-xs text-[#6B7280]">{r.message}</span>
                      </span>
                      <span className="shrink-0">
                        <StatusBadge label={resultLabel[r.status]} tone={resultTone[r.status]} />
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : preview === null && !error ? (
              <div className="flex items-center gap-2 py-8 text-sm text-[#4B5563]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Checking stock and references…
              </div>
            ) : preview ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-md border border-[#E5E7EB] px-3 py-2">
                    <p className="text-xl font-black text-[#111827]">{preview.length}</p>
                    <p className="text-[11px] font-bold uppercase text-[#6B7280]">Selected</p>
                  </div>
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                    <p className="flex items-center gap-1 text-xl font-black text-[#B91C1C]"><Trash2 className="h-4 w-4" aria-hidden />{counts.delete}</p>
                    <p className="text-[11px] font-bold uppercase text-[#B91C1C]">Permanent delete</p>
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="flex items-center gap-1 text-xl font-black text-amber-700"><Archive className="h-4 w-4" aria-hidden />{counts.archive}</p>
                    <p className="text-[11px] font-bold uppercase text-amber-700">Archive only</p>
                  </div>
                  <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
                    <p className="flex items-center gap-1 text-xl font-black text-[#4B5563]"><Ban className="h-4 w-4" aria-hidden />{counts.blocked}</p>
                    <p className="text-[11px] font-bold uppercase text-[#4B5563]">Blocked</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-md border border-[#E5E7EB]">
                  <table className="w-full text-[13px]">
                    <thead className="bg-[#F3F4F6] text-left text-[11px] font-bold uppercase tracking-wide text-[#4B5563]">
                      <tr>
                        <th className="px-2.5 py-2">Material</th>
                        <th className="px-2.5 py-2">Item Code</th>
                        <th className="whitespace-nowrap px-2.5 py-2 text-right">Current Balance</th>
                        {canViewCosts && <th className="whitespace-nowrap px-2.5 py-2 text-right">Stock Value (KWD)</th>}
                        <th className="px-2.5 py-2">References / Dependencies</th>
                        <th className="px-2.5 py-2">Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {preview.map((p) => (
                        <tr key={p.key}>
                          <td className="min-w-[140px] px-2.5 py-1.5 font-semibold text-[#111827]">{p.display_name}</td>
                          <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-xs text-[#4B5563]">{p.item_code ?? "—"}</td>
                          <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-bold">{qty(p.balance)} {p.unit}</td>
                          {canViewCosts && (
                            <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs">
                              {p.stock_value !== null ? p.stock_value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "—"}
                            </td>
                          )}
                          <td className="min-w-[180px] px-2.5 py-1.5 text-xs text-[#4B5563]">{p.reasons.join("; ")}</td>
                          <td className="whitespace-nowrap px-2.5 py-1.5">
                            <StatusBadge label={outcomeLabel[p.outcome]} tone={outcomeTone[p.outcome]} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="space-y-1 text-xs text-[#4B5563]">
                  <li><strong className="text-[#111827]">Permanently delete</strong> — unused, zero stock, no references. Removed from Inventory Control; an audit record keeps its identity.</li>
                  <li><strong className="text-[#111827]">Archive</strong> — zero stock but has history or references. Hidden from Inventory Control and new material selections; every movement and reference stays. Restore from Archived Materials.</li>
                  <li><strong className="text-[#111827]">Blocked</strong> — has stock (or a negative balance). Stock is never erased here: issue or adjust it through the normal process first.</li>
                </ul>

                {actionable.length > 0 ? (
                  <>
                    <div>
                      <label htmlFor="removal-reason" className="mb-1 block text-xs font-bold text-[#4B5563]">Reason (optional, saved with the archive and audit record)</label>
                      <textarea
                        id="removal-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={500}
                        rows={2}
                        className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
                      />
                    </div>
                    <label className="flex min-h-[44px] items-start gap-2 text-sm font-semibold text-[#111827]">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                        className="mt-1 h-4 w-4 accent-[#ED1C24]"
                      />
                      I have reviewed the outcome for each material above. Delete {counts.delete} and archive {counts.archive}
                      {counts.blocked > 0 ? `; ${counts.blocked} blocked will not be changed.` : "."}
                    </label>
                  </>
                ) : (
                  <p className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-semibold text-[#4B5563]">
                    None of the selected materials can be removed right now.
                  </p>
                )}
              </>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-[#E5E7EB] px-5 py-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={running}
              className="min-h-[44px] rounded-md border border-[#E5E7EB] bg-white px-5 text-sm font-bold text-[#4B5563] hover:bg-gray-50 disabled:opacity-40"
            >
              {results ? "Close" : "Cancel"}
            </button>
            {!results && actionable.length > 0 && (
              <button
                type="button"
                onClick={run}
                disabled={!acknowledged || running}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-5 text-sm font-bold text-white hover:bg-[#c8181e] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                {running ? "Working…" : `Confirm: Delete ${counts.delete} / Archive ${counts.archive}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
