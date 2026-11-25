"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ClipboardCheck, History, Pencil, Search } from "lucide-react";

import { LargeFormModal } from "@/components/ui/large-form-modal";
import {
  keepVerificationOnHoldAction,
  resolveVerificationAction,
  returnVerificationAction,
  saveVerificationCorrectionAction,
  searchVerificationMaterialsAction,
} from "@/app/actions/opening-stock-verification";
import type { VerificationEntry, VerificationList, VerificationMaterialRef } from "@/lib/backend/store/opening-stock-verification";
import { PENDING_STATUSES, STATUS_LABELS, type VerificationStatus } from "@/lib/store/opening-stock-verification-rules";

// Inventory Control → Needs Verification. Written for Maintenance and Store
// staff: one card per material, plain words, large buttons, no tables.

type Filter = "pending" | VerificationStatus;

const STATUS_STYLE: Record<VerificationStatus, string> = {
  needs_verification: "bg-amber-100 text-amber-900",
  correction_in_progress: "bg-blue-100 text-blue-800",
  waiting_for_manager: "bg-purple-100 text-purple-800",
  returned: "bg-red-100 text-[#ED1C24]",
  completed: "bg-green-100 text-green-800",
  excluded: "bg-gray-200 text-[#4B5563]",
};

const ACTION_LABEL: Record<string, string> = {
  draft_saved: "Correction saved as draft",
  submitted: "Submitted for Manager review",
  returned: "Returned for correction",
  kept_on_hold: "Kept on hold",
  posted_existing: "Stock added to existing material",
  registered_new: "Registered as new material",
  registered_different: "Registered as a different material (exception approved)",
  excluded: "Not imported",
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString();

// Same minimum as DIFFERENT_REASON_MIN in lib/store/opening-stock-matching.ts
// (the server checks it again).
const DIFFERENT_REASON_MIN = 15;
// Same as EXACT_MATCH_EVIDENCE_MIN (checked again on the server).
const EXACT_MATCH_EVIDENCE_MIN = 30;

const conflictWords = (c: VerificationEntry["sameReference"][number]) =>
  [c.typeConflict && "item type", c.makeConflict && "make / equipment", c.specConflict && "specification", c.unitCompatibility === "incompatible" && "unit"].filter(Boolean).join(", ");

export function NeedsVerificationView({ list }: { list: VerificationList }) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.entries.filter((e) => {
      if (filter === "pending" ? !PENDING_STATUSES.includes(e.status) : e.status !== filter) return false;
      if (!q) return true;
      const hay = [
        e.original.name, e.effective.name, e.original.partNumber, e.effective.partNumber, String(e.rowNumber),
        e.suggested?.itemCode, e.suggested?.name, e.final?.itemCode, e.final?.materialName, ...e.candidates.map((c) => c.itemCode),
      ].filter(Boolean).join(" ").toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [list.entries, filter, query]);

  const open = openId ? list.entries.find((e) => e.id === openId) ?? null : null;
  const filters: [Filter, string, number][] = [
    ["pending", "All waiting", list.pending],
    ...(Object.keys(STATUS_LABELS) as VerificationStatus[]).map((s) => [s, STATUS_LABELS[s], list.counts[s]] as [Filter, string, number]),
  ];

  return (
    <div className="space-y-4 text-base">
      {notice && (
        <div className="flex items-start gap-2.5 rounded-md border border-green-200 bg-green-50 px-4 py-3" role="status">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" aria-hidden />
          <p className="font-semibold text-green-900">{notice}</p>
        </div>
      )}

      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
        <p className="font-bold text-amber-900">
          {list.pending} material{list.pending !== 1 ? "s" : ""} from the opening stock import must be checked. No stock is recorded for them until a decision is made.
        </p>
        <p className="mt-1 text-sm text-amber-900">
          {list.roles.canApprove
            ? "You can correct details and decide: Use Existing, Register New, Return for Correction, Keep on Hold or Do Not Import."
            : list.roles.canEdit
              ? "You can correct details, save a draft and submit it. The Maintenance Manager then decides and the stock is recorded."
              : "You can view these materials. Maintenance Data Entry corrects them and the Maintenance Manager decides."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {filters.map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={`min-h-11 rounded-full border px-4 text-sm font-bold ${filter === value ? "border-[#ED1C24] bg-[#ED1C24] text-white" : "border-[#E5E7EB] bg-white text-[#111827] hover:bg-gray-50"}`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      <label className="flex min-h-12 items-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-3">
        <Search className="h-5 w-5 shrink-0 text-[#9CA3AF]" aria-hidden />
        <span className="sr-only">Search</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by material name, Item Code, part number or Excel row"
          className="min-h-11 w-full bg-transparent text-base focus:outline-none"
        />
      </label>

      {visible.length === 0 ? (
        <p className="rounded-md border border-[#E5E7EB] bg-white px-4 py-8 text-center font-semibold text-[#4B5563]">
          {list.entries.length === 0 ? "No opening stock has been imported yet." : "No materials match this filter."}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((e) => (
            <EntryCard key={e.id} entry={e} roles={list.roles} onOpen={() => setOpenId(e.id)} />
          ))}
        </ul>
      )}

      {open && (
        <VerificationDialog
          entry={open}
          roles={list.roles}
          onClose={() => setOpenId(null)}
          onDone={(message) => {
            setOpenId(null);
            setNotice(message);
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-sm font-bold ${STATUS_STYLE[status]}`}>{STATUS_LABELS[status]}</span>;
}

function Field({ label, value, changed }: { label: string; value: string; changed?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-[#6B7280]">{label}</dt>
      <dd className={`break-words font-semibold ${changed ? "text-blue-800" : "text-[#111827]"}`}>
        {value || "—"}
        {changed && <span className="ml-1 rounded bg-blue-100 px-1.5 text-xs font-bold text-blue-800">corrected</span>}
      </dd>
    </div>
  );
}

function EntryCard({ entry: e, roles, onOpen }: { entry: VerificationEntry; roles: VerificationList["roles"]; onOpen: () => void }) {
  const pending = PENDING_STATUSES.includes(e.status);
  const canEditNow = roles.canEdit && pending && (e.status !== "waiting_for_manager" || roles.canApprove);
  const qtyChanged = e.effective.quantity !== e.original.quantity;
  const unitChanged = e.effective.unit !== e.original.unit;
  return (
    <li className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-lg font-black text-[#111827]">{e.effective.name}</p>
          {e.effective.name !== e.original.name && <p className="break-words text-sm text-[#4B5563]">Excel: {e.original.name}</p>}
          <p className="text-sm text-[#6B7280]">Excel row {e.rowNumber} · {e.batchReference}</p>
        </div>
        <StatusBadge status={e.status} />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Opening quantity" value={`${e.effective.quantity} ${e.effective.unit}`} changed={qtyChanged || unitChanged} />
        <Field label="Category" value={e.effective.category} changed={e.effective.category !== e.original.category} />
        <Field label="Part number / reference" value={e.effective.partNumber} changed={e.effective.partNumber !== e.original.partNumber} />
        {pending ? (
          <Field label="Suggested existing material" value={e.suggested ? `${e.suggested.itemCode ? e.suggested.itemCode + " — " : ""}${e.suggested.name} (${e.suggested.unit})` : "None found"} />
        ) : (
          <Field label="Final material" value={e.final?.materialName ? `${e.final.itemCode ? e.final.itemCode + " — " : ""}${e.final.materialName}${e.final.quantity !== null ? ` · ${e.final.quantity} ${e.final.unit ?? ""}` : ""}` : e.final?.note ?? "—"} />
        )}
      </dl>
      {qtyChanged && (
        <p className="mt-2 text-sm font-semibold text-blue-800">
          Quantity changed from the Excel value {e.original.quantity} {e.original.unit}
          {pending ? " — needs Manager approval." : e.status === "completed" ? " — approved by the Manager." : "."}
        </p>
      )}

      {e.issue && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 font-black text-amber-900">
            <AlertTriangle className="h-4 w-4" aria-hidden /> {e.issue.label}
          </p>
          <p className="mt-1 text-sm text-amber-900">{e.issue.explanation}</p>
          <p className="mt-1 text-sm font-semibold text-[#111827]">What to do: {e.issue.action}</p>
        </div>
      )}
      {e.reviewNote && e.status === "returned" && <p className="mt-2 text-sm font-semibold text-[#ED1C24]">Manager: {e.reviewNote}</p>}
      {e.correction?.remarks && <p className="mt-2 text-sm text-[#4B5563]">Remarks: {e.correction.remarks}</p>}
      {e.differentProposal && (
        <p className="mt-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-semibold text-purple-900">
          Data Entry proposes: register as a different material{e.differentProposal.reason ? ` — “${e.differentProposal.reason}”` : ""}. The Manager decides.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[#6B7280]">
          Last updated {fmtDate(e.lastUpdatedAt)}{e.lastUpdatedBy ? ` by ${e.lastUpdatedBy}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {canEditNow && (
            <button type="button" onClick={onOpen} className="inline-flex min-h-12 items-center gap-1.5 rounded-md border border-[#111827] bg-white px-4 text-base font-bold text-[#111827] hover:bg-gray-50">
              <Pencil className="h-4 w-4" aria-hidden /> Edit Details
            </button>
          )}
          {roles.canApprove && pending && (
            <button type="button" onClick={onOpen} className="inline-flex min-h-12 items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 text-base font-bold text-white hover:bg-red-700">
              <ClipboardCheck className="h-4 w-4" aria-hidden /> Review &amp; Decide
            </button>
          )}
          {(!pending || (!canEditNow && !roles.canApprove)) && (
            <button type="button" onClick={onOpen} className="inline-flex min-h-12 items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 text-base font-bold text-[#111827] hover:bg-gray-50">
              <History className="h-4 w-4" aria-hidden /> View Details
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

type Decision = "use_existing" | "register_new" | "register_different" | "return" | "hold" | "exclude";

function VerificationDialog({
  entry: e,
  roles,
  onClose,
  onDone,
}: {
  entry: VerificationEntry;
  roles: VerificationList["roles"];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const pending = PENDING_STATUSES.includes(e.status);
  const canEditNow = roles.canEdit && pending && (e.status !== "waiting_for_manager" || roles.canApprove);
  const [form, setForm] = useState({
    materialName: e.effective.name,
    partNumber: e.effective.partNumber,
    category: e.effective.category,
    unit: e.effective.unit,
    quantity: e.effective.quantity,
    remarks: e.correction?.remarks ?? "",
    reason: e.correction?.reason ?? "",
  });
  const [proposed, setProposed] = useState<VerificationMaterialRef | null>(e.correction?.proposed ?? null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<Decision>(e.suggested && e.suggested.unitCompatibility !== "incompatible" && e.candidates.length === 1 ? "use_existing" : "hold");
  const [decisionKey, setDecisionKey] = useState<string>(e.correction?.proposed?.key ?? (e.candidates.find((c) => c.unitCompatibility !== "incompatible")?.key ?? ""));
  const [note, setNote] = useState("");
  const [proposeDifferent, setProposeDifferent] = useState(e.differentProposal !== null);
  const [differentReason, setDifferentReason] = useState(e.differentProposal?.reason ?? "");
  const [confirmDifferent, setConfirmDifferent] = useState(false);
  const [differentExplanation, setDifferentExplanation] = useState("");
  const [exactOverride, setExactOverride] = useState(false);
  const [evidenceType, setEvidenceType] = useState<"specification" | "physical_evidence" | "">("");
  const [evidence, setEvidence] = useState("");
  const isExactMatch = e.exactMatch.length > 0;
  const [searchResults, setSearchResults] = useState<VerificationMaterialRef[]>([]);
  const [searchText, setSearchText] = useState("");

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const qtyNumber = Number(form.quantity);
  const qtyDiff = Number.isFinite(qtyNumber) ? qtyNumber - Number(e.original.quantity) : 0;

  async function save(submit: boolean) {
    setBusy(true);
    setError(null);
    setErrors({});
    const res = await saveVerificationCorrectionAction({
      rowId: e.id,
      version: e.version,
      values: {
        materialName: form.materialName,
        partNumber: form.partNumber,
        category: form.category,
        unit: form.unit,
        quantity: form.quantity.trim() === "" ? null : Number(form.quantity),
        remarks: form.remarks,
      },
      proposedMaterialKey: proposed?.key ?? null,
      reason: form.reason,
      submit,
      proposeDifferent,
      differentReason,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      setErrors(res.fieldErrors ?? {});
      return;
    }
    router.refresh();
    onDone(submit ? `Row ${e.rowNumber} was submitted for Manager review. No stock has been recorded yet.` : `Row ${e.rowNumber}: draft saved. No stock has been recorded.`);
  }

  async function decide() {
    setBusy(true);
    setError(null);
    const res =
      decision === "return"
        ? await returnVerificationAction({ rowId: e.id, version: e.version, note })
        : decision === "hold"
          ? await keepVerificationOnHoldAction({ rowId: e.id, version: e.version, note })
          : await resolveVerificationAction({
              rowId: e.id,
              version: e.version,
              decision:
                decision === "use_existing"
                  ? { action: "use_existing", materialKey: decisionKey }
                  : decision === "register_new"
                    ? { action: "register_new" }
                    : decision === "register_different"
                      ? {
                          action: "register_different",
                          confirmedDifferent: confirmDifferent,
                          reason: differentExplanation,
                          comparedKeys: e.sameReference.map((c) => c.key),
                          ...(isExactMatch && exactOverride && evidenceType ? { exactMatchOverride: { confirmed: true, evidenceType, evidence } } : {}),
                        }
                      : { action: "exclude", reason: note },
              note: note || undefined,
            });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      setErrors(res.fieldErrors ?? {});
      return;
    }
    router.refresh();
    const messages: Record<Decision, string> = {
      use_existing: `Row ${e.rowNumber}: opening stock added to the existing material.`,
      register_new: `Row ${e.rowNumber}: registered as a new material with a new Item Code.`,
      register_different: `Row ${e.rowNumber}: registered as a different material with a new Item Code. The existing material and its Item Code are unchanged.`,
      return: `Row ${e.rowNumber} was returned to Data Entry for correction.`,
      hold: `Row ${e.rowNumber} is kept on hold. No stock was recorded.`,
      exclude: `Row ${e.rowNumber} will not be imported. Its history is kept.`,
    };
    onDone(messages[decision]);
  }

  async function search() {
    if (searchText.trim().length < 2) return;
    setSearchResults(await searchVerificationMaterialsAction(searchText));
  }

  const choices: VerificationMaterialRef[] = [
    ...e.candidates.map((c) => ({ key: c.key, name: c.name, itemCode: c.itemCode, unit: c.unit })),
    ...(proposed && !e.candidates.some((c) => c.key === proposed.key) ? [proposed] : []),
  ];
  const inputCls = "min-h-12 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-base focus:outline-none focus:ring-2 focus:ring-[#ED1C24] disabled:bg-gray-50";
  const fieldErr = (k: string) => errors[k]?.[0] && <p className="mt-1 text-sm font-semibold text-[#ED1C24]">{errors[k][0]}</p>;
  const needsNote = decision === "return" || decision === "exclude";
  const exactRef = e.candidates.some((c) => c.exactReference);

  return (
    <LargeFormModal title={`Excel row ${e.rowNumber} — ${e.effective.name}`} subtitle={`${STATUS_LABELS[e.status]} · ${e.batchReference}`} onClose={onClose}>
      <div className="space-y-5 text-base">
        {error && (
          <div className="rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3 font-semibold text-[#ED1C24]" role="alert">
            {error}
          </div>
        )}

        <section className="rounded-md border border-[#E5E7EB] bg-gray-50 p-4">
          <p className="font-black text-[#111827]">Original Excel details (never changed)</p>
          <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Material name" value={e.original.name} />
            <Field label="Opening quantity" value={`${e.original.quantity} ${e.original.unit}`} />
            <Field label="Category" value={e.original.category} />
            <Field label="Part number / reference" value={e.original.partNumber} />
          </dl>
        </section>

        {e.issue && (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-4">
            <p className="font-black text-amber-900">{e.issue.label}</p>
            <p className="mt-1 text-amber-900">{e.issue.explanation}</p>
            <p className="mt-1 font-semibold text-[#111827]">What to do: {e.issue.action}</p>
          </section>
        )}

        {e.correction && (e.correction.byName || e.correction.reason) && (
          <p className="text-sm text-[#4B5563]">
            Last correction{e.correction.byName ? ` by ${e.correction.byName}` : ""}{e.correction.at ? ` on ${fmtDate(e.correction.at)}` : ""}{e.correction.reason ? ` — reason: ${e.correction.reason}` : ""}
          </p>
        )}

        {canEditNow && (
          <section className="rounded-md border border-[#E5E7EB] p-4">
            <p className="font-black text-[#111827]">Corrected details</p>
            <p className="text-sm text-[#4B5563]">Change only what is wrong. The original Excel values above stay in the record.</p>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="font-bold">Material name / description</span>
                <input className={inputCls} value={form.materialName} onChange={(ev) => set("materialName", ev.target.value)} maxLength={300} />
                {fieldErr("materialName")}
              </label>
              <label className="block">
                <span className="font-bold">Part number / reference</span>
                <input className={inputCls} value={form.partNumber} onChange={(ev) => set("partNumber", ev.target.value)} maxLength={120} />
                {fieldErr("partNumber")}
              </label>
              <label className="block">
                <span className="font-bold">Category</span>
                <input className={inputCls} value={form.category} onChange={(ev) => set("category", ev.target.value)} maxLength={120} />
                {fieldErr("category")}
              </label>
              <label className="block">
                <span className="font-bold">Unit</span>
                <input className={inputCls} value={form.unit} onChange={(ev) => set("unit", ev.target.value)} maxLength={32} list="verification-units" />
                <datalist id="verification-units">
                  {["PCS", "NOS", "SET", "BOX", "PACK", "MTR", "ROLL", "KG", "LTR", "DRUM", "BAG", "PAIR"].map((u) => <option key={u} value={u} />)}
                </datalist>
                {fieldErr("unit")}
              </label>
              <label className="block">
                <span className="font-bold">Opening quantity</span>
                <input className={inputCls} value={form.quantity} onChange={(ev) => set("quantity", ev.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" />
                {qtyDiff !== 0 && Number.isFinite(qtyDiff) && (
                  <p className="mt-1 text-sm font-bold text-blue-800">
                    {qtyDiff > 0 ? "+" : ""}{qtyDiff} compared with the Excel quantity {e.original.quantity}. The Manager must approve this change.
                  </p>
                )}
                {fieldErr("quantity")}
              </label>
              <div className="sm:col-span-2">
                <span className="font-bold">Existing material this row is (optional)</span>
                <div className="mt-1 space-y-2">
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="radio" name="proposed" checked={proposed === null} onChange={() => { setProposed(null); setDirty(true); }} className="h-5 w-5" />
                    <span>Not sure / none</span>
                  </label>
                  {choices.map((c) => (
                    <label key={c.key} className="flex min-h-11 items-start gap-2">
                      <input type="radio" name="proposed" checked={proposed?.key === c.key} onChange={() => { setProposed(c); setDirty(true); }} className="mt-1 h-5 w-5" />
                      <span className="break-words">{c.itemCode ? <b>{c.itemCode}</b> : null} {c.name} <span className="text-[#6B7280]">({c.unit})</span></span>
                    </label>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <input className={`${inputCls} flex-1`} value={searchText} onChange={(ev) => setSearchText(ev.target.value)} placeholder="Search Inventory: name, part number or Item Code" />
                    <button type="button" onClick={search} className="min-h-12 rounded-md bg-[#111827] px-4 font-bold text-white">Search</button>
                  </div>
                  {searchResults.map((c) => (
                    <button key={c.key} type="button" onClick={() => { setProposed(c); setDirty(true); }} className="block min-h-11 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-left hover:bg-gray-50">
                      {c.itemCode ? <b>{c.itemCode}</b> : null} {c.name} <span className="text-[#6B7280]">({c.unit})</span>
                    </button>
                  ))}
                </div>
              </div>
              {e.sameReference.length > 0 && (
                <div className="rounded-md border border-purple-200 bg-purple-50 p-3 sm:col-span-2">
                  <label className="flex min-h-11 items-start gap-2">
                    <input type="checkbox" checked={proposeDifferent} onChange={(ev) => { setProposeDifferent(ev.target.checked); setDirty(true); }} className="mt-1 h-5 w-5" />
                    <span>
                      <b>Propose: register as a different material</b> — only if this is physically a different item from{" "}
                      {e.sameReference.map((c) => c.itemCode ?? c.name).join(", ")}, which has the same part number. The Manager decides.
                      {e.exactMatch.length > 0 && (
                        <span className="mt-1 block text-sm font-semibold text-[#ED1C24]">
                          It matches {e.exactMatch.map((c) => c.itemCode ?? c.name).join(", ")} exactly (unit, type, make, equipment). Describe the measured difference or physical evidence — spelling is not a difference.
                        </span>
                      )}
                    </span>
                  </label>
                  {proposeDifferent && (
                    <label className="mt-2 block">
                      <span className="font-bold">How is it different? (required to submit)</span>
                      <textarea className={`${inputCls} min-h-20 py-2`} value={differentReason} onChange={(ev) => { setDifferentReason(ev.target.value); setDirty(true); }} maxLength={1000} placeholder="Example: checked both on the shelf — this one is the primary filter, 90 mm; the existing one is the secondary, 76 mm" />
                    </label>
                  )}
                  {fieldErr("differentReason")}
                </div>
              )}
              <label className="block sm:col-span-2">
                <span className="font-bold">Remarks</span>
                <textarea className={`${inputCls} min-h-20 py-2`} value={form.remarks} onChange={(ev) => set("remarks", ev.target.value)} maxLength={1000} />
              </label>
              <label className="block sm:col-span-2">
                <span className="font-bold">Reason for correction</span>
                <textarea className={`${inputCls} min-h-20 py-2`} value={form.reason} onChange={(ev) => set("reason", ev.target.value)} maxLength={1000} placeholder="Example: checked the shelf — the correct unit is SET" />
                {fieldErr("reason")}
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => save(false)} className="min-h-12 rounded-md border border-[#111827] bg-white px-5 font-bold text-[#111827] disabled:opacity-50">
                Save Draft
              </button>
              {!roles.canApprove && (
                <button type="button" disabled={busy} onClick={() => save(true)} className="min-h-12 rounded-md bg-[#ED1C24] px-5 font-bold text-white disabled:opacity-50">
                  Submit for Manager Review
                </button>
              )}
              {roles.canApprove && dirty && (
                <button type="button" disabled={busy} onClick={() => save(true)} className="min-h-12 rounded-md bg-[#111827] px-5 font-bold text-white disabled:opacity-50">
                  Save Corrections
                </button>
              )}
            </div>
            <p className="mt-2 text-sm text-[#6B7280]">Saving never records stock.</p>
          </section>
        )}

        {roles.canApprove && pending && (
          <section className="rounded-md border-2 border-[#ED1C24] p-4">
            <p className="font-black text-[#111827]">Manager decision</p>
            <p className="text-sm text-[#4B5563]">
              The material is matched again with the saved details before anything is posted. Quantity to post: <b>{e.effective.quantity} {e.effective.unit}</b>
              {e.effective.quantity !== e.original.quantity && ` (Excel: ${e.original.quantity} ${e.original.unit})`}.
            </p>
            {dirty && <p className="mt-2 font-semibold text-[#ED1C24]">Save the corrections first — the decision uses the saved details.</p>}
            <div className="mt-3 space-y-2">
              <label className="flex min-h-11 items-start gap-2">
                <input type="radio" name="decision" checked={decision === "use_existing"} onChange={() => setDecision("use_existing")} className="mt-1 h-5 w-5" />
                <span><b>Use Existing</b> — keep its Item Code and add the quantity to it</span>
              </label>
              {decision === "use_existing" && (
                <select value={decisionKey} onChange={(ev) => setDecisionKey(ev.target.value)} className={inputCls} aria-label="Existing material">
                  <option value="">Choose the existing material…</option>
                  {choices.map((c) => (
                    <option key={c.key} value={c.key}>{c.itemCode ? `${c.itemCode} — ` : ""}{c.name} ({c.unit})</option>
                  ))}
                  {searchResults.filter((s) => !choices.some((c) => c.key === s.key)).map((c) => (
                    <option key={c.key} value={c.key}>{c.itemCode ? `${c.itemCode} — ` : ""}{c.name} ({c.unit})</option>
                  ))}
                </select>
              )}
              <label className="flex min-h-11 items-start gap-2">
                <input type="radio" name="decision" checked={decision === "register_new"} onChange={() => setDecision("register_new")} disabled={exactRef} className="mt-1 h-5 w-5" />
                <span><b>Register New</b> — create it with a new AMSOS Item Code{exactRef && " (not possible: an existing material already has this part number)"}</span>
              </label>
              {e.sameReference.length > 0 && (
                <label className="flex min-h-11 items-start gap-2">
                  <input type="radio" name="decision" checked={decision === "register_different"} onChange={() => setDecision("register_different")} disabled={Boolean(e.differentBlock)} className="mt-1 h-5 w-5" />
                  <span>
                    <b>Register as Different Material</b> — exception: create a new AMSOS Item Code although the part number matches, because the items are physically different
                    {e.differentBlock && <span className="block text-sm font-semibold text-[#6B7280]">Not possible: {e.differentBlock}</span>}
                  </span>
                </label>
              )}
              {decision === "register_different" && !e.differentBlock && (
                <div className="space-y-3 rounded-md border border-purple-300 bg-purple-50 p-3">
                  <p className="font-black text-purple-900">Compare before deciding</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
                      <p className="text-xs font-bold uppercase text-[#6B7280]">Submitted (this row)</p>
                      <p className="break-words font-bold">{e.effective.name}</p>
                      <p className="text-sm">Part number: {e.effective.partNumber || "—"} · {e.effective.category}</p>
                      <p className="text-sm">Quantity: {e.effective.quantity} {e.effective.unit}</p>
                      {e.effective.name !== e.original.name && <p className="text-sm text-[#6B7280]">Excel: {e.original.name}</p>}
                    </div>
                    {e.sameReference.map((c) => (
                      <div key={c.key} className="rounded-md border border-[#E5E7EB] bg-white p-3">
                        <p className="text-xs font-bold uppercase text-[#6B7280]">
                          Existing — stays unchanged{e.exactMatch.some((x) => x.key === c.key) && <span className="ml-1 rounded bg-red-100 px-1.5 text-red-800">exact match</span>}
                        </p>
                        <p className="break-words font-bold">{c.itemCode ? `${c.itemCode} — ` : ""}{c.name}</p>
                        <p className="text-sm">Unit: {c.unit}</p>
                        <p className="text-sm">Same part number: {c.reasons.join("; ")}</p>
                        <p className="text-sm font-semibold text-purple-900">{conflictWords(c) ? `Differences found: ${conflictWords(c)}` : "No difference found in the descriptions — check the physical items."}</p>
                      </div>
                    ))}
                  </div>
                  {e.differentProposal && (
                    <p className="text-sm text-purple-900">Data Entry&apos;s reason: “{e.differentProposal.reason ?? "—"}”</p>
                  )}
                  <label className="flex min-h-11 items-start gap-2">
                    <input type="checkbox" checked={confirmDifferent} onChange={(ev) => setConfirmDifferent(ev.target.checked)} className="mt-1 h-5 w-5" />
                    <span className="font-semibold">
                      I confirm that the submitted material is physically different from {e.sameReference.map((c) => c.itemCode ?? c.name).join(", ")}. The existing material and its Item Code stay as they are.
                    </span>
                  </label>
                  <label className="block">
                    <span className="font-bold">Explanation (required, at least {DIFFERENT_REASON_MIN} characters)</span>
                    <textarea className={`${inputCls} min-h-20 py-2`} value={differentExplanation} onChange={(ev) => setDifferentExplanation(ev.target.value)} maxLength={1000} placeholder="What makes the two items different" />
                  </label>
                  {isExactMatch && (
                    <div className="space-y-2 rounded-md border-2 border-[#ED1C24] bg-white p-3">
                      <p className="font-black text-[#ED1C24]">Exact match — blocked by default</p>
                      <p className="text-sm text-[#111827]">
                        This row matches {e.exactMatch.map((c) => c.itemCode ?? c.name).join(", ")} exactly: same part number, unit, item type, make and equipment. Different spelling or punctuation is not evidence of a different material. Registering it needs a separate exceptional approval with documented evidence.
                      </p>
                      <label className="flex min-h-11 items-start gap-2">
                        <input type="checkbox" checked={exactOverride} onChange={(ev) => setExactOverride(ev.target.checked)} className="mt-1 h-5 w-5" />
                        <span className="font-semibold">Exceptional approval: despite the exact match, I have verified that the items are physically different.</span>
                      </label>
                      {exactOverride && (
                        <>
                          <div className="flex flex-wrap gap-4">
                            <label className="flex min-h-11 items-center gap-2">
                              <input type="radio" name="evidence-type" checked={evidenceType === "specification"} onChange={() => setEvidenceType("specification")} className="h-5 w-5" />
                              <span>Distinguishing specification</span>
                            </label>
                            <label className="flex min-h-11 items-center gap-2">
                              <input type="radio" name="evidence-type" checked={evidenceType === "physical_evidence"} onChange={() => setEvidenceType("physical_evidence")} className="h-5 w-5" />
                              <span>Physical evidence</span>
                            </label>
                          </div>
                          <label className="block">
                            <span className="font-bold">Documented evidence (required, at least {EXACT_MATCH_EVIDENCE_MIN} characters)</span>
                            <textarea className={`${inputCls} min-h-20 py-2`} value={evidence} onChange={(ev) => setEvidence(ev.target.value)} maxLength={1000} placeholder="Example: measured on the shelf — outer diameter 93 mm vs 76 mm, thread M16x1.5 vs 3/4-16 UNF; photos kept in the store file" />
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              <label className="flex min-h-11 items-start gap-2">
                <input type="radio" name="decision" checked={decision === "return"} onChange={() => setDecision("return")} className="mt-1 h-5 w-5" />
                <span><b>Return for Correction</b> — send it back to Data Entry with an explanation</span>
              </label>
              <label className="flex min-h-11 items-start gap-2">
                <input type="radio" name="decision" checked={decision === "hold"} onChange={() => setDecision("hold")} className="mt-1 h-5 w-5" />
                <span><b>Keep on Hold</b> — leave it pending, no stock</span>
              </label>
              <label className="flex min-h-11 items-start gap-2">
                <input type="radio" name="decision" checked={decision === "exclude"} onChange={() => setDecision("exclude")} className="mt-1 h-5 w-5" />
                <span><b>Do Not Import</b> — exclude it (reason required); its history is kept</span>
              </label>
              <label className="block">
                <span className="font-bold">{needsNote ? "Explanation (required)" : "Note (optional)"}</span>
                <textarea className={`${inputCls} min-h-20 py-2`} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={1000} />
                {fieldErr("note")}
              </label>
            </div>
            <button
              type="button"
              disabled={
                busy ||
                dirty ||
                (decision === "use_existing" && !decisionKey) ||
                (needsNote && note.trim().length < 5) ||
                (decision === "register_different" &&
                  (!confirmDifferent ||
                    differentExplanation.trim().length < DIFFERENT_REASON_MIN ||
                    Boolean(e.differentBlock) ||
                    (isExactMatch && (!exactOverride || !evidenceType || evidence.trim().length < EXACT_MATCH_EVIDENCE_MIN))))
              }
              onClick={decide}
              className="mt-3 min-h-12 rounded-md bg-[#ED1C24] px-6 font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving…" : "Confirm Decision"}
            </button>
          </section>
        )}

        {!pending && e.final && (
          <section className="rounded-md border border-green-200 bg-green-50 p-4">
            <p className="font-black text-green-900">{STATUS_LABELS[e.status]}</p>
            {e.final.materialName ? (
              <p className="mt-1 text-green-900">
                {e.final.itemCode} — {e.final.materialName} · {e.final.quantity} {e.final.unit} recorded
              </p>
            ) : (
              <p className="mt-1 text-[#4B5563]">{e.final.note}</p>
            )}
          </section>
        )}

        <section>
          <p className="font-black text-[#111827]">History</p>
          {e.history.length === 0 ? (
            <p className="text-sm text-[#6B7280]">
              {pending
                ? "Held by the opening stock import. No changes yet."
                : e.resolvedAfterImport
                  ? `Resolved ${fmtDate(e.lastUpdatedAt)}${e.lastUpdatedBy ? ` by ${e.lastUpdatedBy}` : ""} on the import page, before the Needs Verification history was added.`
                  : `Recorded by the opening stock import on ${fmtDate(e.lastUpdatedAt)} — it did not need verification.`}
            </p>
          ) : (
            <ol className="mt-2 space-y-2">
              {e.history.map((h, i) => (
                <li key={i} className="rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
                  <p className="font-bold text-[#111827]">{ACTION_LABEL[h.action] ?? h.action}</p>
                  <p className="text-[#4B5563]">{fmtDate(h.createdAt)} · {h.actorName}</p>
                  {h.note && <p className="text-[#111827]">“{h.note}”</p>}
                  {Array.isArray(h.details.differentFrom) && (
                    <p className="font-semibold text-purple-900">
                      Different from {(h.details.differentFrom as { itemCode: string | null; name: string }[]).map((m) => m.itemCode ?? m.name).join(", ")} (same part number) — existing material unchanged
                    </p>
                  )}
                  {Boolean(h.details.exactMatchOverride) && (
                    <p className="font-semibold text-[#ED1C24]">
                      Exceptional approval (exact match):{" "}
                      {(h.details.exactMatchOverride as { evidenceType: string }).evidenceType === "specification" ? "distinguishing specification" : "physical evidence"} — “{(h.details.exactMatchOverride as { evidence: string }).evidence}”
                    </p>
                  )}
                  {h.details.proposedRegisterAsDifferent === true && <p className="text-purple-900">Proposed: register as a different material</p>}
                  {typeof h.details.approvedQuantity === "number" && (
                    <p className="text-[#4B5563]">
                      Posted {String(h.details.approvedQuantity)} {String(h.details.unit ?? "")} (Excel {String(h.details.submittedQuantity)}{Number(h.details.quantityDifference) ? `, difference ${String(h.details.quantityDifference)}` : ""}){h.details.itemCode ? ` · ${String(h.details.itemCode)}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </LargeFormModal>
  );
}
