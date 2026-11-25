"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Search } from "lucide-react";

import {
  getOpeningStockBatchAction,
  resolveHeldOpeningStockRowsAction,
  searchOpeningStockMaterialsAction,
  type OpeningStockMaterialOption,
} from "@/app/actions/opening-stock-import";
import type { OpeningStockBatchRow, OpeningStockBatchView, OpeningStockResolveResult } from "@/lib/backend/store/opening-stock-import";
import type { RowDecision } from "@/lib/store/opening-stock-matching";
import { ErrorBox, ResultCards, ResultTable } from "@/components/store/opening-stock-import-shared";

// One import batch: its result, and its held rows. An approver (System
// Administrator / Maintenance Manager) resolves held rows here — Use existing,
// Register as new, or Do not import (with a reason) — without uploading the
// file again. Rows already resolved are never posted twice.

type Choice = { value: string; reason: string };

export function OpeningStockBatchPanel({ batchReference, onClose }: { batchReference: string; onClose: () => void }) {
  const [batch, setBatch] = useState<OpeningStockBatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [picked, setPicked] = useState<Record<string, OpeningStockMaterialOption>>({});
  const [searchRow, setSearchRow] = useState<number | null>(null);
  const [saved, setSaved] = useState<OpeningStockResolveResult | null>(null);

  const apply = useCallback((res: Awaited<ReturnType<typeof getOpeningStockBatchAction>>) => {
    if (res.ok) setBatch(res.data);
    else setError(res.error);
    setLoading(false);
  }, []);

  async function load() {
    setLoading(true);
    apply(await getOpeningStockBatchAction(batchReference));
  }

  useEffect(() => {
    let alive = true;
    getOpeningStockBatchAction(batchReference).then((res) => {
      if (alive) apply(res);
    });
    return () => {
      alive = false;
    };
  }, [batchReference, apply]);

  const held = batch?.rows.filter((r) => r.outcome === "held") ?? [];
  const decided = Object.entries(choices).filter(([, c]) => c.value && c.value !== "hold");
  const missingReason = decided.some(([, c]) => c.value === "exclude" && c.reason.trim().length < 5);

  async function save() {
    const decisions: Record<number, RowDecision> = {};
    for (const [row, c] of decided) {
      decisions[Number(row)] = c.value.startsWith("use:")
        ? { action: "use_existing", materialKey: c.value.slice(4) }
        : c.value === "exclude"
          ? { action: "exclude", reason: c.reason }
          : { action: "register_new" };
    }
    setLoading(true);
    setError(null);
    try {
      const res = await resolveHeldOpeningStockRowsAction(batchReference, decisions);
      if (!res.ok) { setError(res.error); setLoading(false); return; }
      setSaved(res.data);
      setChoices({});
      await load();
    } catch {
      setError("The connection was interrupted. Open the batch again: rows already saved are shown as resolved and are never posted twice.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#111827] hover:bg-gray-50">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to import
      </button>

      {error && <ErrorBox message={error} />}
      {!batch && loading && <p className="text-sm text-[#4B5563]">Loading batch…</p>}

      {batch && (
        <>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <p className="font-bold text-[#111827]">
              Import batch <span className="font-mono">{batch.batchReference}</span>
            </p>
            <p className="mt-1 text-xs text-[#4B5563]">
              {batch.fileName} · {new Date(batch.createdAt).toLocaleString()} · {batch.createdByName} · {batch.totalRows} rows · quantity posted {batch.postedQuantity}
            </p>
            <ResultCards r={batch} />
          </div>

          {saved && (
            <div className="flex items-start gap-2.5 rounded-md border border-green-200 bg-green-50 px-4 py-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
              <p className="text-sm font-semibold text-green-900">
                {saved.resolved.length} held row{saved.resolved.length !== 1 ? "s" : ""} saved.
                {saved.alreadyResolved.length > 0 && ` Row ${saved.alreadyResolved.join(", ")} had already been resolved and was left unchanged.`} {saved.stillHeld} still held.
              </p>
            </div>
          )}

          {held.length > 0 && (
            <div className="overflow-hidden rounded-md border border-amber-300 bg-white shadow-sm">
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-black uppercase text-amber-900">Held for review — {held.length} row{held.length !== 1 ? "s" : ""}, no stock recorded</p>
                {!batch.canResolve && <p className="mt-1 text-xs font-semibold text-amber-800">Only the System Administrator or Maintenance Manager can resolve held rows.</p>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-240 text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Material Name (file)</th>
                      <th className="px-3 py-2">Qty</th>
                      <th className="px-3 py-2">Why it is held</th>
                      <th className="px-3 py-2">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {held.map((r) => (
                      <HeldRow
                        key={r.rowNumber}
                        row={r}
                        canResolve={batch.canResolve}
                        choice={choices[r.rowNumber] ?? { value: "hold", reason: "" }}
                        picked={picked}
                        searching={searchRow === r.rowNumber}
                        onChoice={(c) => {
                          if (c.value === "search") { setSearchRow(r.rowNumber); return; }
                          setChoices((prev) => ({ ...prev, [r.rowNumber]: c }));
                        }}
                        onPick={(o) => {
                          setPicked((p) => ({ ...p, [o.key]: o }));
                          setChoices((prev) => ({ ...prev, [r.rowNumber]: { value: `use:${o.key}`, reason: "" } }));
                          setSearchRow(null);
                        }}
                        onCloseSearch={() => setSearchRow(null)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {batch.canResolve && (
                <div className="flex flex-wrap items-center gap-3 border-t border-[#E5E7EB] p-4">
                  <button
                    type="button"
                    onClick={save}
                    disabled={loading || decided.length === 0 || missingReason}
                    className="min-h-11 rounded-md bg-[#ED1C24] px-5 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? "Saving…" : `Save decisions (${decided.length})`}
                  </button>
                  <p className="text-xs text-[#4B5563]">
                    Saved rows post their stock immediately, in one transaction. Rows left on “Keep on hold” stay held.
                    {missingReason && " Give a reason (at least 5 characters) for every row you do not import."}
                  </p>
                </div>
              )}
            </div>
          )}

          <ResultTable rows={batch.rows} />
        </>
      )}
    </div>
  );
}

function HeldRow({
  row,
  canResolve,
  choice,
  picked,
  searching,
  onChoice,
  onPick,
  onCloseSearch,
}: {
  row: OpeningStockBatchRow;
  canResolve: boolean;
  choice: Choice;
  picked: Record<string, OpeningStockMaterialOption>;
  searching: boolean;
  onChoice: (c: Choice) => void;
  onPick: (o: OpeningStockMaterialOption) => void;
  onCloseSearch: () => void;
}) {
  const current = row.current;
  const candidates = current?.candidates ?? [];
  const pickedKey = choice.value.startsWith("use:") && !candidates.some((c) => `use:${c.key}` === choice.value) ? choice.value.slice(4) : null;
  const sameRef = candidates.find((c) => c.exactReference);
  return (
    <>
      <tr className="bg-amber-50/40">
        <td className="whitespace-nowrap px-3 py-2 align-top text-[#9CA3AF]">{row.rowNumber}</td>
        <td className="min-w-48 max-w-64 px-3 py-2 align-top font-semibold text-[#111827]">{row.sourceName}</td>
        <td className="whitespace-nowrap px-3 py-2 align-top font-semibold text-[#111827]">{row.sourceQuantity} {row.sourceUnit}</td>
        <td className="min-w-72 px-3 py-2 align-top text-xs text-[#4B5563]">{current?.message ?? row.message}</td>
        <td className="min-w-80 px-3 py-2 align-top">
          <select
            aria-label={`Decision for row ${row.rowNumber}`}
            value={choice.value}
            disabled={!canResolve}
            onChange={(e) => onChoice({ value: e.target.value, reason: choice.reason })}
            className="min-h-11 w-full rounded-md border border-[#E5E7EB] bg-white px-2 text-sm font-semibold text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]"
          >
            <option value="hold">Keep on hold</option>
            {candidates.map((c) => {
              const blocked = c.unitCompatibility === "incompatible" || c.archived || c.openingStockQuantity > 0 || c.postedByImport;
              const why =
                c.unitCompatibility === "incompatible" ? ` — stocked in ${c.unit}, cannot use`
                  : c.archived ? " — archived, cannot use"
                    : c.openingStockQuantity > 0 || c.postedByImport ? " — already has opening stock"
                      : c.unitCompatibility === "counting_equivalent" ? ` — recorded in ${c.unit}`
                        : "";
              return (
                <option key={c.key} value={`use:${c.key}`} disabled={blocked}>
                  Use existing: {c.name}{c.itemCode ? ` [${c.itemCode}]` : ""}{why}
                </option>
              );
            })}
            {pickedKey && picked[pickedKey] && <option value={`use:${pickedKey}`}>Use existing: {picked[pickedKey].name} ({picked[pickedKey].unit})</option>}
            {/* A material already carrying this exact part number is never registered again. */}
            {!sameRef && <option value="register_new">Register as new material</option>}
            <option value="exclude">Do not import (give a reason)</option>
            <option value="search">Search Inventory…</option>
          </select>
          {sameRef && sameRef.unitCompatibility === "incompatible" && (
            <p className="mt-1 text-xs font-semibold text-amber-800">
              {sameRef.itemCode ?? sameRef.name} has this part number but is stocked in {sameRef.unit}. Correct the unit first (file or Edit Material) — a
              duplicate material is not created.
            </p>
          )}
          {choice.value === "exclude" && (
            <input
              value={choice.reason}
              onChange={(e) => onChoice({ value: "exclude", reason: e.target.value })}
              maxLength={500}
              placeholder="Reason, e.g. same item as row 47"
              aria-label={`Reason for not importing row ${row.rowNumber}`}
              className="mt-2 min-h-11 w-full rounded-md border border-[#E5E7EB] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
            />
          )}
        </td>
      </tr>
      {searching && (
        <tr className="bg-white">
          <td colSpan={5} className="px-3 py-3">
            <MaterialSearch sourceUnit={row.sourceUnit} onPick={onPick} onClose={onCloseSearch} />
          </td>
        </tr>
      )}
    </>
  );
}

function MaterialSearch({ sourceUnit, onPick, onClose }: { sourceUnit: string; onPick: (o: OpeningStockMaterialOption) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OpeningStockMaterialOption[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    try {
      setResults(await searchOpeningStockMaterialsAction(query));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-[#E5E7EB] p-3">
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Inventory by name, part number or Item Code"
          className="min-h-11 flex-1 rounded-md border border-[#E5E7EB] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24]"
        />
        <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-[#111827] px-4 text-sm font-bold text-white disabled:opacity-60">
          <Search className="h-4 w-4" aria-hidden /> {busy ? "Searching…" : "Search"}
        </button>
        <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-[#E5E7EB] px-4 text-sm font-bold text-[#4B5563]">
          Cancel
        </button>
      </form>
      {results.length > 0 && (
        <ul className="mt-2 divide-y divide-[#E5E7EB]">
          {results.map((o) => (
            <li key={o.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-semibold text-[#111827]">{o.name}</span>{" "}
                <span className="text-[#4B5563]">({o.unit}{o.itemCode ? `, ${o.itemCode}` : ""}, balance {o.balance})</span>
              </span>
              <button type="button" onClick={() => onPick(o)} className="min-h-11 rounded-md border border-[#ED1C24] px-3 text-xs font-bold text-[#ED1C24] hover:bg-red-50">
                Use this material
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-[#9CA3AF]">
        The row is in {sourceUnit || "—"}. A material in another unit is refused when you save (only PCS and Nos count as the same unit).
      </p>
    </div>
  );
}
