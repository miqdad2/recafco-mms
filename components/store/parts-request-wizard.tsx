"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, X } from "lucide-react";

import { createPartsRequestAction } from "@/app/actions/phase4";
import {
  searchOfflineInventoryMaterialsForPartsRequestAction,
  getPartsRequestWizardFlagsAction,
} from "@/app/actions/offline-inventory";
import type { OfflineInventorySearchMatch } from "@/lib/store/offline-inventory-data";
import { GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE } from "@/components/store/general-inventory-units";
import {
  basisUnit,
  computeRequestLine,
  formatKwd,
  isLargeEstimatedTotal,
  largeTotalAckKey,
  type PriceBasis,
} from "@/lib/materials/request-pricing";
import { PriceBasisField, PriceBasisWarnings } from "@/components/store/price-basis-field";
import { AttachmentUploadFields } from "@/components/files/attachment-upload-fields";
import { StatusBadge } from "@/components/ui/status-badge";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import {
  ATTACHMENT_FILE_ACCEPT,
  MAX_ATTACHMENT_ROWS,
  PARTS_REQUEST_ATTACHMENT_CATEGORIES,
} from "@/lib/files/attachment-constants";

// Job Card Materials Request UX and Existing Inventory Selection Fix.
//
// Task 1 — the Select Job Card dropdown below is a standard, fully-
// controlled <select value=... onChange=...>: selectedWo/the warning text/
// the Next button's own validate() all read the SAME selectedWoId state in
// the SAME render pass. The "first selection is lost" bug reported against
// it was not in this file — it came from LargeFormModal's dirty tracking
// re-rendering this form between the select's native `input` and `change`
// events (see the note in components/ui/large-form-modal.tsx), fixed there.
//
// Tasks 2–11 — Requested Materials is rewritten from a fixed-8-row HTML
// table (3 default rows, a plain text Part/Material input, a free-typed
// "Unit" field that was never actually read server-side) into a dynamic
// list of material rows (1 default row; Add Row up to MAX_ITEM_ROWS;
// Remove on any row, never below 1). Job Card Materials Request Table
// Layout and Inventory Search Fix: those rows are laid out as a compact
// table again (one line per material), replacing the large
// one-card-per-material layout. Material Request Purchase-First Unit and
// Flexible Price Basis: each line is entered as Requested Purchase Qty +
// Purchase Unit with a Price Basis, and a second row under it holds Stock
// Unit, Conversion Quantity (only when the units differ), Calculated Stock
// Quantity and a calculation preview.
// Each row has a debounced Offline Inventory
// autocomplete — same 300ms-debounce/stale-response-guard pattern already
// established in the New Job Card wizard's own Required Materials step
// (components/work-orders/work-order-wizard.tsx), reused here via a new,
// more broadly-gated pair of actions (searchOfflineInventoryMaterialsFor
// PartsRequestAction / getPartsRequestWizardFlagsAction) since that
// wizard's own actions gate on work_orders.manage only, which Technician
// (parts_requests.create only) lacks.
//
// Inventory-First Material Request Workflow: selecting a suggestion locks
// in either the match's own part_id (catalog-backed) or its manual
// buildBalanceKey() identity (inventoryMaterialKey), and its Purchase Unit,
// Stock Unit and conversion from the material's Inventory unit setup
// (read-only; changed only in Inventory). A name not in Inventory shows a
// "Material not found" panel with Add New Material; only a Manager / Super
// Admin (canRequestUnlinked) may request it anyway, with one plain unit.
// Everything here is a request line only — no inventory
// balance, no stock movement, nothing auto-received; that still happens
// later, through Receive Materials.

const MAX_ITEM_ROWS = 8;

function unitOptionList() {
  return [...GENERAL_INVENTORY_UNIT_OPTIONS, CUSTOM_UNIT_VALUE];
}
function unitLabel(value: string) {
  return value === CUSTOM_UNIT_VALUE ? "OTHER / CUSTOM" : value;
}
// "" (the "Select unit" placeholder) while nothing is chosen yet — an empty
// unit only maps to OTHER / CUSTOM once the user has actually picked that
// option (custom), so a fresh row never looks like it already has a unit.
function unitSelectValue(unit: string, custom: boolean): string {
  if (custom) return CUSTOM_UNIT_VALUE;
  if (unit === "") return "";
  return (GENERAL_INVENTORY_UNIT_OPTIONS as readonly string[]).includes(unit) ? unit : CUSTOM_UNIT_VALUE;
}
function fmt(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 1000) / 1000).toString() : "0";
}
function stockStatusLabel(status: OfflineInventorySearchMatch["stock_status"]): string {
  const labels: Record<OfflineInventorySearchMatch["stock_status"], string> = {
    ok: "OK",
    low_stock: "Low Stock",
    out_of_stock: "Out of Stock",
    negative: "Negative Stock",
  };
  return labels[status];
}
function stockStatusTone(status: OfflineInventorySearchMatch["stock_status"]): "green" | "amber" | "red" {
  if (status === "ok") return "green";
  if (status === "low_stock") return "amber";
  return "red";
}

type RequestedMaterialRowState = {
  description: string;
  partNumber: string;
  ssRecCode: string;
  // Material Request Purchase-First Unit and Flexible Price Basis: qty is
  // the Requested Purchase Qty, in purchaseUnit; unit is the Stock Unit
  // (how inventory tracks it). The saved quantity_requested is the
  // calculated stock quantity (lib/materials/request-pricing.ts).
  qty: string;
  // Task 5/6 — the Stock Unit. Locked (plain text) once a row is linked to
  // an existing match, until an authorized user unlocks it (unitLocked).
  unit: string;
  unitLocked: boolean;
  // True once the user picks OTHER / CUSTOM and types their own unit.
  unitCustom: boolean;
  remarks: string;
  // Task 3/4/10 — link state. matchKey is the full Offline Inventory
  // identity (OfflineInventorySearchMatch.key) of the selected suggestion;
  // matchPartId is that same match's own part_id when it is catalog-backed
  // (null for a manual/non-catalog match). Both null means "New Material
  // Request" — not linked to inventory.
  matchKey: string | null;
  matchPartId: string | null;
  balance: number | null;
  // The matched material's own Stock Unit — the balance is always shown in
  // this unit, even if an authorized user later changes the Stock Unit.
  balanceUnit: string;
  stockStatus: OfflineInventorySearchMatch["stock_status"] | null;
  suggestions: OfflineInventorySearchMatch[];
  showSuggestions: boolean;
  loading: boolean;
  searched: boolean;
  // Inventory-First Material Request Workflow: purchaseUnit / unit /
  // conversionQty are copied from the selected material's Inventory unit
  // setup and shown read-only — never set up in this form. conversionQty
  // (stock units inside 1 purchase unit) only applies when the two differ.
  purchaseUnit: string;
  purchaseUnitCustom: boolean;
  conversionQty: string;
  // Manager / Super Admin only: request a material that is not in
  // Inventory, with one plain unit (purchaseUnit = unit, no conversion).
  unlinkedOverride: boolean;
  // Optional; blank means "not priced yet", never submitted/shown as 0.
  // priceBasis says which unit the price is per.
  unitPrice: string;
  // null until the user picks it — required when the purchase and stock
  // units differ (no silent default); automatic when they are the same.
  priceBasis: PriceBasis | null;
  // "I confirm the price basis is correct" for a large total, keyed to the
  // exact price/basis/total it was given for (largeTotalAckKey).
  largeTotalAckKey: string | null;
};

function emptyMaterialRow(): RequestedMaterialRowState {
  return {
    description: "",
    partNumber: "",
    ssRecCode: "",
    qty: "",
    // A new material starts in PCS (the user can change it); selecting an
    // existing material replaces it with that material's own stock unit.
    unit: "PCS",
    unitLocked: false,
    unitCustom: false,
    remarks: "",
    matchKey: null,
    matchPartId: null,
    balance: null,
    balanceUnit: "",
    stockStatus: null,
    suggestions: [],
    showSuggestions: false,
    loading: false,
    searched: false,
    // Same unit as the Stock Unit by default (conversion 1).
    purchaseUnit: "PCS",
    purchaseUnitCustom: false,
    conversionQty: "",
    unlinkedOverride: false,
    unitPrice: "",
    priceBasis: null,
    largeTotalAckKey: null,
  };
}

// Live figures for one row — the same computeRequestLine() the server uses
// to save it. basis is the effective one: with a single unit both bases
// mean the same thing, so it is purchase_unit.
function rowFigures(row: RequestedMaterialRowState) {
  const priceText = row.unitPrice.trim();
  const price = priceText !== "" && Number.isFinite(Number(priceText)) ? Number(priceText) : null;
  const figures = computeRequestLine({
    purchaseQty: Number(row.qty) || 0,
    purchaseUnit: row.purchaseUnit,
    stockUnit: row.unit,
    conversion: row.conversionQty.trim() ? Number(row.conversionQty) : null,
    price,
    basis: row.priceBasis,
  });
  // With two units the basis stays null (and there is no total) until the
  // user picks it; with one unit it is purchase_unit automatically.
  const basis: PriceBasis | null = figures.unitsDiffer ? row.priceBasis : "purchase_unit";
  const total = basis === null ? null : figures.total;
  const largeTotal = basis !== null && isLargeEstimatedTotal(total, price);
  const largeTotalAcked = largeTotal && row.largeTotalAckKey === largeTotalAckKey(price!, basis!, total!);
  // Inventory-first: a row is usable only when linked to an Inventory
  // material, or a Manager override row with a unit chosen.
  const usable = row.matchKey !== null || (row.unlinkedOverride && row.unit.trim() !== "");
  return { ...figures, total, price, basis, largeTotal, largeTotalAcked, usable };
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({
  current,
  labels,
}: {
  current: number;
  labels: string[];
}) {
  return (
    <nav aria-label="Wizard progress" className="mb-8">
      <ol className="flex items-start">
        {labels.map((label, idx) => {
          const n = idx + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-start">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
                    done
                      ? "border-[#ED1C24] bg-[#ED1C24] text-white"
                      : active
                        ? "border-[#ED1C24] bg-white text-[#ED1C24]"
                        : "border-[#E5E7EB] bg-white text-[#9CA3AF]"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" aria-hidden="true" /> : n}
                </div>
                <span
                  className={`mt-1 hidden text-center text-[10px] font-semibold leading-tight sm:block ${
                    active ? "text-[#ED1C24]" : done ? "text-[#111827]" : "text-[#9CA3AF]"
                  }`}
                >
                  {label}
                </span>
              </div>
              {n < labels.length && (
                <div
                  className={`mx-1 mt-4 h-0.5 flex-1 transition-colors ${
                    done ? "bg-[#ED1C24]" : "bg-[#E5E7EB]"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Shared style tokens ───────────────────────────────────────────────────────

const inp =
  "focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm";
const miniInp = "w-full rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-sm outline-none focus:border-[#ED1C24]";
const th = "border border-[#E5E7EB] px-1.5 py-1.5";
const td = "border border-[#E5E7EB] p-1.5 align-top";

// ── Main wizard export ────────────────────────────────────────────────────────

export type AssetSummary = {
  asset_code: string;
  asset_name: string;
  location: string | null;
  category: string | null;
  status: string;
};

export type WorkOrderOption = {
  id: string;
  work_order_number: string | null;
  ordered_by: string | null;
  worker_type: string | null;
  maintenance_type: string | null;
  operator_complaint: string | null;
  created_at: string;
  assets: AssetSummary | null;
};

// Large Popup Conversion: `modalMode` is set when this wizard is rendered
// inside <LargeFormModal> from the Materials Requests page instead of its
// own /store/parts-requests/new page — drops the outer page-level width
// wrapper and adds a Cancel button routed through the modal's dirty-aware
// close. Submission itself is unchanged (a plain form POST to
// createPartsRequestAction, which redirects to /store/parts-requests on
// success either way — that naturally drops the ?newRequest= query param
// and closes the modal).
export function PartsRequestWizard({
  workOrders,
  preselectedWorkOrderId,
  preselectedWorkOrder,
  modalMode = false,
}: {
  workOrders: WorkOrderOption[];
  preselectedWorkOrderId?: string;
  preselectedWorkOrder?: WorkOrderOption | null;
  modalMode?: boolean;
}) {
  const modal = useLargeFormModal();
  const isPreselected = !!preselectedWorkOrderId;

  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [selectedWoId, setSelectedWoId] = useState(preselectedWorkOrderId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewData, setReviewData] = useState<Record<string, string>>({});
  const [reviewFiles, setReviewFiles] = useState<Record<string, File>>({});

  // Task 2 — one empty row by default, not three.
  const [rows, setRows] = useState<RequestedMaterialRowState[]>(() => [emptyMaterialRow()]);
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const searchSeq = useRef<Record<number, number>>({});

  // Task 8/9 — resolved once on mount; both default to false (no price
  // columns, unit always locked) until resolved, so neither flashes on
  // briefly for a viewer who turns out not to have it. canEnterPrices is the
  // material-request-price permission (Manager, Super Admin, Data Entry),
  // not general cost visibility.
  const [canEnterPrices, setCanEnterPrices] = useState(false);
  // Manager / Super Admin: may request a material not in Inventory.
  const [canRequestUnlinked, setCanRequestUnlinked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPartsRequestWizardFlagsAction()
      .then((flags) => {
        if (!cancelled) {
          setCanEnterPrices(flags.canEnterPrices);
          setCanRequestUnlinked(flags.canRequestUnlinked);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timers = searchTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  // Resolve the selected work order: use preselected prop if provided, else find in list
  const selectedWo: WorkOrderOption | null = isPreselected
    ? (preselectedWorkOrder ?? null)
    : (workOrders.find((w) => w.id === selectedWoId) ?? null);

  const selectedAsset = selectedWo?.assets ?? null;

  const stepLabels = isPreselected
    ? ["Job Card Context", "Requested Materials", "Attachments", "Review & Submit"]
    : ["Select Job Card", "Requested Materials", "Attachments", "Review & Submit"];

  function updateRow(index: number, patch: Partial<RequestedMaterialRowState>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    // A row-level validation message is stale as soon as the user edits a
    // row; it is re-checked on the next Next click.
    setErrors((prev) => (prev.items ? { ...prev, items: "" } : prev));
  }

  function addRow() {
    setRows((prev) => (prev.length >= MAX_ITEM_ROWS ? prev : [...prev, emptyMaterialRow()]));
  }

  // Task 2 — remove any row; never below 1 (the button itself is hidden at
  // length 1, this is the defensive backstop).
  function removeRow(index: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
    if (searchTimers.current[index]) clearTimeout(searchTimers.current[index]);
  }

  function handleMaterialNameChange(index: number, value: string) {
    // Task 4 — editing the description after a match was selected clears
    // the link entirely; the row goes back to "New Material Request" until
    // re-matched (or the user keeps typing/picks a new unit themselves).
    // Qty defaults to 1 the first time a name is typed into an empty row
    // (same quality-of-life default the New Job Card wizard's own Required
    // Materials step already uses) — never overrides a quantity the user
    // already entered, and clearing the name back to blank does not clear
    // a quantity they already typed.
    const currentQty = rows[index]?.qty ?? "";
    const shouldDefaultQty = value.trim() !== "" && currentQty.trim() === "";
    updateRow(index, {
      description: value,
      matchKey: null,
      matchPartId: null,
      balance: null,
      balanceUnit: "",
      stockStatus: null,
      unitLocked: false,
      showSuggestions: true,
      ...(shouldDefaultQty ? { qty: "1" } : {}),
    });

    if (searchTimers.current[index]) clearTimeout(searchTimers.current[index]);

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      updateRow(index, { suggestions: [], loading: false, searched: false });
      return;
    }

    updateRow(index, { loading: true });
    const seq = (searchSeq.current[index] ?? 0) + 1;
    searchSeq.current[index] = seq;

    searchTimers.current[index] = setTimeout(async () => {
      try {
        const results = await searchOfflineInventoryMaterialsForPartsRequestAction(trimmed);
        // Ignore stale responses from an earlier keystroke that resolved late.
        if (searchSeq.current[index] !== seq) return;
        updateRow(index, { suggestions: results, loading: false, searched: true });
      } catch {
        if (searchSeq.current[index] !== seq) return;
        updateRow(index, { suggestions: [], loading: false, searched: true });
      }
    }, 300);
  }

  function handleSelectSuggestion(index: number, match: OfflineInventorySearchMatch) {
    // Task 3 — save the inventory material id (part_id for a catalog match,
    // the manual identity key otherwise), show the badge, show balance, and
    // auto-fill Part No./SS Rec. Code/Unit from the match — Unit never
    // defaults to PCS unless the match's own unit genuinely is PCS. Task 6
    // — locks the unit immediately on match. Selecting a suggestion counts
    // as entering a material name too, for the same Qty-defaults-to-1 rule.
    const currentQty = rows[index]?.qty ?? "";
    const shouldDefaultQty = currentQty.trim() === "";
    updateRow(index, {
      description: match.display_name,
      partNumber: match.part_number ?? "",
      ssRecCode: match.ss_rec_code ?? "",
      unit: match.unit,
      unitLocked: true,
      unitCustom: false,
      // Inventory-First: Purchase Unit and conversion come from the
      // material's Inventory unit setup; no setup = bought in its stock unit.
      purchaseUnit: match.purchase_unit ?? match.unit,
      purchaseUnitCustom: false,
      conversionQty: match.purchase_unit && match.conversion_quantity ? String(match.conversion_quantity) : "",
      unlinkedOverride: false,
      matchKey: match.key,
      matchPartId: match.part_id,
      balance: match.balance,
      balanceUnit: match.unit,
      stockStatus: match.stock_status,
      suggestions: [],
      showSuggestions: false,
      searched: false,
      ...(shouldDefaultQty ? { qty: "1" } : {}),
    });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};

    if (step === 1 && !isPreselected && !selectedWoId) {
      errs.work_order_id = "Please select a job card.";
    }

    if (step === 2) {
      const described = rows.filter((r) => r.description.trim());
      if (described.length === 0) {
        errs.items = "Please add at least one part or material.";
      } else {
        for (const r of described) {
          const name = r.description.trim();
          const qty = Number(r.qty);
          const f = rowFigures(r);
          if (r.matchKey === null && !r.unlinkedOverride) {
            errs.items = `"${name}" is not in Inventory. Add this material in Inventory first, then create the request.`;
          } else if (!(qty > 0)) {
            errs.items = `Enter requested purchase quantity for "${name}".`;
          } else if (!Number.isInteger(qty)) {
            errs.items = `Requested Purchase Qty for "${name}" must be a whole number.`;
          } else if (!f.usable) {
            errs.items = `Select a unit for "${name}".`;
          } else if (f.stockQty !== null && !Number.isInteger(Math.round(f.stockQty * 1e6) / 1e6)) {
            // Job Card materials are issued in whole stock units.
            errs.items = `Calculated Stock Quantity for "${name}" must be a whole number of ${r.unit}.`;
          } else if (canEnterPrices && f.price !== null && f.price < 0) {
            errs.items = "Estimated price must be 0 or greater.";
          } else if (canEnterPrices && f.price !== null && f.basis === null) {
            errs.items = `Select whether the price for "${name}" is for 1 ${r.purchaseUnit} or 1 ${r.unit}.`;
          } else if (canEnterPrices && f.largeTotal && !f.largeTotalAcked) {
            errs.items = `Estimated total for "${name}" is ${formatKwd(f.total!)} KWD. Please confirm the price basis is correct.`;
          }
          if (errs.items) break;
        }
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleNext() {
    if (!validate()) return;
    const next = step + 1;
    if (next === 4) {
      const form = formRef.current;
      if (form) {
        const fd = new FormData(form);
        const obj: Record<string, string> = {};
        const files: Record<string, File> = {};
        fd.forEach((v, k) => {
          if (v instanceof File) {
            if (v.size > 0) files[k] = v;
          } else if (String(v).trim()) {
            obj[k] = String(v);
          }
        });
        setReviewData(obj);
        setReviewFiles(files);
      }
    }
    setStep(next);
  }

  function handleBack() {
    setErrors({});
    setStep((p) => Math.max(p - 1, 1));
  }

  // #, Part / Material, Part No., SS Rec. Code, Requested Purchase Qty,
  // Purchase Unit, Remarks, Action — plus Estimated Unit Price, Price Basis
  // and Estimated Total for a price-permitted viewer.
  const columnCount = canEnterPrices ? 11 : 8;

  const reviewItems = rows.filter((r) => r.description.trim());

  const reviewAttachments = Array.from({ length: MAX_ATTACHMENT_ROWS }, (_, i) => {
    const file = reviewFiles[`pr_attachment_file_${i}`];
    if (!file) return null;
    return {
      category: reviewData[`pr_attachment_category_${i}`] || PARTS_REQUEST_ATTACHMENT_CATEGORIES[0],
      fileName: file.name,
      remarks: reviewData[`pr_attachment_remarks_${i}`] ?? "",
    };
  }).filter((a): a is { category: string; fileName: string; remarks: string } => a !== null);

  // Task 11 — Manager/Super Admin cost summary, only over rows that have
  // both a description and a real (non-blank) unit price; a fully unpriced
  // set reads "Not available" rather than a misleading 0.000 KWD.
  const pricedReviewTotals = reviewItems.map((r) => rowFigures(r).total).filter((t): t is number => t !== null);
  const reviewHasUnpriced = reviewItems.some((r) => rowFigures(r).total === null);
  const reviewEstimatedTotal = pricedReviewTotals.reduce((sum, t) => sum + t, 0);

  return (
    <div className={modalMode ? "" : "mx-auto max-w-3xl"}>
      <StepIndicator current={step} labels={stepLabels} />

      <form ref={formRef} action={createPartsRequestAction}>
        {/* Always include work_order_id — via hidden input (pre-selected) or select (normal) */}
        {isPreselected && (
          <input type="hidden" name="work_order_id" value={selectedWoId} />
        )}

        {/* ── Step 1: Job Card Context / Select Job Card ─────────────────── */}
        <div className={step !== 1 ? "hidden" : ""}>
          <PRCard
            title={isPreselected ? "Job Card Context" : "Select Job Card"}
            description={
              isPreselected
                ? "This materials request is linked to the job card below."
                : "Asset details will load automatically from the linked job card."
            }
          >
            {/* Pre-selected: show read-only context */}
            {isPreselected ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[#ED1C24]/30 bg-red-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#ED1C24]">
                    Job Card
                  </p>
                  <p className="mt-1 font-bold text-[#111827]">
                    {selectedWo?.work_order_number ?? "Draft"}
                    {selectedWo?.ordered_by ? ` — ${selectedWo.ordered_by}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {selectedWo?.maintenance_type && (
                      <PRChip>{selectedWo.maintenance_type}</PRChip>
                    )}
                    {selectedWo?.worker_type && <PRChip>{selectedWo.worker_type}</PRChip>}
                  </div>
                  {selectedWo?.operator_complaint && (
                    <p className="mt-2 text-xs italic text-[#4B5563]">
                      {selectedWo.operator_complaint}
                    </p>
                  )}
                </div>

                {selectedAsset && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-green-700">
                      Linked Asset / Machine
                    </p>
                    <p className="mt-1 font-bold text-[#111827]">
                      {selectedAsset.asset_code} — {selectedAsset.asset_name}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {selectedAsset.category && <PRChip>{selectedAsset.category}</PRChip>}
                      {selectedAsset.location && <PRChip>{selectedAsset.location}</PRChip>}
                      <PRStatusBadge status={selectedAsset.status} />
                    </div>
                  </div>
                )}

                <p className="text-xs text-[#9CA3AF]">
                  Click Next to add the materials needed for this job card.
                </p>
              </div>
            ) : (
              /* Normal flow: show work order dropdown — Task 1: a plain,
                 fully controlled <select>. selectedWo/the warning below/the
                 Next button's own validate() all derive from the SAME
                 selectedWoId state in the SAME render, so the very first
                 onChange already carries the fully up-to-date value — there
                 is no separate "confirm" step and nothing here depends on a
                 previous render's stale value. */
              <div>
                <label className="block">
                  <PRLabel label="Job Card" required />
                  <select
                    name="work_order_id"
                    className={inp}
                    value={selectedWoId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedWoId(nextId);
                      if (nextId) setErrors((prev) => ({ ...prev, work_order_id: "" }));
                    }}
                  >
                    <option value="">— Select a job card —</option>
                    {workOrders.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.work_order_number ?? "Draft"} — {w.ordered_by}
                        {w.maintenance_type ? ` [${w.maintenance_type}]` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {errors.work_order_id && (
                  <p className="mt-1 text-xs text-[#DC2626]">{errors.work_order_id}</p>
                )}

                {selectedWo && (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">
                        Job Card
                      </p>
                      <p className="mt-1 font-bold text-[#111827]">
                        {selectedWo.work_order_number ?? "Draft"} — {selectedWo.ordered_by}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {selectedWo.maintenance_type && (
                          <PRChip>{selectedWo.maintenance_type}</PRChip>
                        )}
                        {selectedWo.worker_type && <PRChip>{selectedWo.worker_type}</PRChip>}
                      </div>
                      {selectedWo.operator_complaint && (
                        <p className="mt-2 text-xs italic text-[#4B5563]">
                          {selectedWo.operator_complaint}
                        </p>
                      )}
                    </div>

                    {selectedAsset && (
                      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-green-700">
                          Linked Asset
                        </p>
                        <p className="mt-1 font-bold text-[#111827]">
                          {selectedAsset.asset_code} — {selectedAsset.asset_name}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {selectedAsset.category && <PRChip>{selectedAsset.category}</PRChip>}
                          {selectedAsset.location && <PRChip>{selectedAsset.location}</PRChip>}
                          <PRStatusBadge status={selectedAsset.status} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!selectedWo && (
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    Select a job card above to view its linked asset details.
                  </p>
                )}
              </div>
            )}
          </PRCard>
        </div>

        {/* ── Step 2: Requested Materials ─────────────────────────────────── */}
        <div className={step !== 2 ? "hidden" : ""}>
          <PRCard
            title="Requested Materials"
            description="List the materials required for this job card."
          >
            {/* Compact RO context reminder */}
            {selectedWo && (
              <div className="mb-4 rounded-md border-l-4 border-[#ED1C24] bg-red-50 px-4 py-3">
                <p className="text-xs font-bold text-[#ED1C24]">
                  {selectedWo.work_order_number ?? "Draft"} — {selectedWo.ordered_by}
                </p>
                {selectedAsset && (
                  <p className="mt-0.5 text-xs text-[#4B5563]">
                    Asset: {selectedAsset.asset_code} — {selectedAsset.asset_name}
                    {selectedAsset.location ? ` · ${selectedAsset.location}` : ""}
                    {selectedWo.maintenance_type ? ` · ${selectedWo.maintenance_type}` : ""}
                  </p>
                )}
                {!selectedAsset && selectedWo.maintenance_type && (
                  <p className="mt-0.5 text-xs text-[#4B5563]">{selectedWo.maintenance_type}</p>
                )}
              </div>
            )}

            <div className="mb-4">
              <label className="block">
                <PRLabel label="Overall remarks" hint="optional" />
                <input
                  name="remarks"
                  className={inp}
                  placeholder="General notes for this materials request…"
                />
              </label>
            </div>

            <p className="mb-2 text-xs text-[#6B7280]">
              Type in Part / Material to search Inventory by name, part number, or SS Rec. Code. Enter the quantity in the
              Purchase Unit (how the supplier sells it); the Stock Unit and conversion are under each line.
            </p>

            {/* Compact table entry (one line per material) — the same row
                state, autocomplete, conversion and cost logic as before, laid
                out as a table instead of one large card per material.
                overflow-x-auto only below lg: at lg+ the modal is wide enough
                for every column, and leaving overflow visible there keeps the
                autocomplete list from being clipped by a scroll container. */}
            <div className="overflow-x-auto lg:overflow-visible">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-[#F9FAFB] text-[10px] font-black uppercase tracking-wide text-[#6B7280]">
                    <th className={cn(th, "w-8 text-center")}>#</th>
                    <th className={th}>Part / Material</th>
                    <th className={cn(th, "w-28")}>Part No.</th>
                    <th className={cn(th, "w-28")}>SS Rec. Code</th>
                    <th className={cn(th, "w-20")}>Requested Purchase Qty</th>
                    <th className={cn(th, "w-32")}>
                      Purchase Unit
                      <span className="block text-[9px] font-semibold normal-case tracking-normal text-[#9CA3AF]">
                        How the supplier sells it.
                      </span>
                    </th>
                    {canEnterPrices && <th className={cn(th, "w-32")}>Estimated Price (KWD)</th>}
                    {canEnterPrices && <th className={cn(th, "w-40")}>Price Basis</th>}
                    {canEnterPrices && <th className={cn(th, "w-28")}>Estimated Total</th>}
                    <th className={cn(th, "w-36")}>Remarks</th>
                    <th className={cn(th, "w-16 text-center")}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const isExisting = row.matchKey !== null;
                    const hasDescription = row.description.trim().length > 0;
                    const figures = rowFigures(row);

                    return (
                      <Fragment key={i}>
                        <tr>
                          <td className={cn(td, "text-center text-xs font-bold text-[#9CA3AF]")}>{i + 1}</td>

                          {/* Part / Material — search, link badge, balance */}
                          <td className={cn(td, "relative min-w-[220px]")}>
                            <input
                              name={`description_${i}`}
                              aria-label={`Part / Material ${i + 1}`}
                              value={row.description}
                              onChange={(e) => handleMaterialNameChange(i, e.target.value)}
                              onFocus={() => updateRow(i, { showSuggestions: true })}
                              onBlur={() => updateRow(i, { showSuggestions: false })}
                              autoComplete="off"
                              placeholder="Search or type material…"
                              className={miniInp}
                            />
                            <input type="hidden" name={`part_id_${i}`} value={row.matchPartId ?? ""} />
                            <input type="hidden" name={`inventory_material_key_${i}`} value={!row.matchPartId && row.matchKey ? row.matchKey : ""} />

                            {row.showSuggestions && (row.loading || row.suggestions.length > 0 || row.searched) && (
                              <div className="absolute left-1.5 top-full z-20 -mt-1 w-[min(28rem,80vw)] rounded-md border border-[#E5E7EB] bg-white shadow-lg">
                                {row.loading ? (
                                  <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-[#6B7280]">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                    Searching Inventory…
                                  </div>
                                ) : row.suggestions.length === 0 ? (
                                  <p className="px-3 py-2.5 text-xs text-[#9CA3AF]">
                                    No match in Inventory. This will be saved as a New Material request.
                                  </p>
                                ) : (
                                  <ul className="max-h-64 divide-y divide-[#F3F4F6] overflow-y-auto">
                                    {row.suggestions.map((s) => (
                                      <li key={s.key}>
                                        <button
                                          type="button"
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            handleSelectSuggestion(i, s);
                                          }}
                                          className="block w-full px-3 py-2 text-left hover:bg-gray-50"
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-bold text-[#111827]">
                                              {s.display_name}
                                              <span className="font-normal text-[#4B5563]">
                                                {" "}— Balance {fmt(s.balance)} {s.unit}
                                              </span>
                                            </p>
                                            <StatusBadge label={stockStatusLabel(s.stock_status)} tone={stockStatusTone(s.stock_status)} />
                                          </div>
                                          {(s.part_number || s.ss_rec_code) && (
                                            <p className="mt-0.5 text-[11px] text-[#6B7280]">
                                              {s.part_number ? `Part No: ${s.part_number}` : ""}
                                              {s.part_number && s.ss_rec_code ? " • " : ""}
                                              {s.ss_rec_code ? `SS Rec. Code: ${s.ss_rec_code}` : ""}
                                            </p>
                                          )}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}

                            {hasDescription && (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <StatusBadge
                                  label={isExisting ? "Existing Inventory" : row.unlinkedOverride ? "Not in Inventory (override)" : "Not in Inventory"}
                                  tone={isExisting ? "green" : "amber"}
                                />
                                {isExisting && row.stockStatus && (
                                  <StatusBadge label={stockStatusLabel(row.stockStatus)} tone={stockStatusTone(row.stockStatus)} />
                                )}
                                {isExisting && row.balance !== null && (
                                  <span className="text-[11px] text-[#6B7280]">
                                    Balance: {fmt(row.balance)} {row.balanceUnit}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* readOnly (not disabled) for a linked row: a
                              disabled input is left out of the submitted
                              form, which would drop the auto-filled value. */}
                          <td className={td}>
                            <input
                              name={`part_number_${i}`}
                              aria-label={`Part No. ${i + 1}`}
                              value={row.partNumber}
                              onChange={(e) => updateRow(i, { partNumber: e.target.value })}
                              readOnly={isExisting}
                              className={cn(miniInp, isExisting && "bg-gray-50 text-[#6B7280]")}
                            />
                          </td>
                          <td className={td}>
                            <input
                              name={`ss_rec_code_${i}`}
                              aria-label={`SS Rec. Code ${i + 1}`}
                              value={row.ssRecCode}
                              onChange={(e) => updateRow(i, { ssRecCode: e.target.value })}
                              readOnly={isExisting}
                              className={cn(miniInp, isExisting && "bg-gray-50 text-[#6B7280]")}
                            />
                          </td>

                          <td className={td}>
                            <input
                              name={`purchase_quantity_${i}`}
                              aria-label={`Requested Purchase Qty ${i + 1}`}
                              type="number"
                              step="1"
                              min="1"
                              value={row.qty}
                              onChange={(e) => updateRow(i, { qty: e.target.value })}
                              className={miniInp}
                            />
                          </td>

                          {/* Purchase Unit — from the material's Inventory unit
                              setup (read-only); only a Manager override row
                              for a material not in Inventory picks one plain
                              unit (no conversion). */}
                          <td className={td}>
                            {isExisting ? (
                              <p className={cn(miniInp, "bg-gray-50 font-semibold text-[#111827]")}>{row.purchaseUnit || "—"}</p>
                            ) : row.unlinkedOverride ? (
                              <>
                                <select
                                  aria-label={`Unit ${i + 1}`}
                                  value={unitSelectValue(row.unit, row.unitCustom)}
                                  onChange={(e) =>
                                    updateRow(
                                      i,
                                      e.target.value === CUSTOM_UNIT_VALUE
                                        ? { unit: "", unitCustom: true, purchaseUnit: "" }
                                        : { unit: e.target.value, unitCustom: false, purchaseUnit: e.target.value }
                                    )
                                  }
                                  className={miniInp}
                                >
                                  <option value="" disabled hidden>
                                    Select unit
                                  </option>
                                  {unitOptionList().map((u) => (
                                    <option key={u} value={u}>
                                      {unitLabel(u)}
                                    </option>
                                  ))}
                                </select>
                                {unitSelectValue(row.unit, row.unitCustom) === CUSTOM_UNIT_VALUE && (
                                  <input
                                    aria-label={`Custom Unit ${i + 1}`}
                                    value={row.unit}
                                    onChange={(e) => updateRow(i, { unit: e.target.value, purchaseUnit: e.target.value })}
                                    placeholder="e.g. Bundle"
                                    className={cn(miniInp, "mt-1")}
                                  />
                                )}
                              </>
                            ) : (
                              <p className={cn(miniInp, "border-transparent text-[#9CA3AF]")}>—</p>
                            )}
                            {/* What the server reads; it re-takes the units from
                                Inventory for a linked material. */}
                            <input type="hidden" name={`purchase_unit_${i}`} value={row.purchaseUnit} />
                            <input type="hidden" name={`unit_${i}`} value={row.unit} />
                            {figures.unitsDiffer && figures.conversion !== null && (
                              <input type="hidden" name={`conversion_quantity_${i}`} value={figures.conversion} />
                            )}
                            {!isExisting && row.unlinkedOverride && (
                              <input type="hidden" name={`unlinked_override_${i}`} value="1" />
                            )}
                          </td>

                          {canEnterPrices && (
                            <td className={td}>
                              <input
                                name={`unit_price_${i}`}
                                aria-label={`Estimated Price ${i + 1}`}
                                type="number"
                                min="0"
                                step="0.001"
                                placeholder={
                                  figures.basis
                                    ? `Price for 1 ${basisUnit(figures.basis, row.purchaseUnit, row.unit) || "unit"}`
                                    : "Price, then choose its unit"
                                }
                                value={row.unitPrice}
                                onChange={(e) => updateRow(i, { unitPrice: e.target.value })}
                                disabled={!hasDescription}
                                className={miniInp}
                              />
                              {figures.price !== null && figures.basis && (
                                <p className="mt-0.5 text-[10px] font-semibold text-[#111827]">
                                  for 1 {basisUnit(figures.basis, row.purchaseUnit, row.unit)}
                                </p>
                              )}
                            </td>
                          )}
                          {canEnterPrices && (
                            <td className={td}>
                              <PriceBasisField
                                name={`price_basis_${i}`}
                                purchaseUnit={row.purchaseUnit}
                                stockUnit={row.unit}
                                unitsDiffer={figures.unitsDiffer}
                                value={figures.basis}
                                onChange={(basis) => updateRow(i, { priceBasis: basis })}
                                needsChoice={figures.price !== null && figures.basis === null}
                                label={`Price Basis ${i + 1}`}
                              />
                            </td>
                          )}
                          {canEnterPrices && (
                            <td className={cn(td, "text-xs font-semibold text-[#111827]")}>
                              {!hasDescription
                                ? "—"
                                : figures.total !== null
                                  ? `${formatKwd(figures.total)} KWD`
                                  : figures.price === null
                                    ? "Not priced yet"
                                    : "Choose price basis"}
                            </td>
                          )}

                          <td className={td}>
                            <input
                              name={`remarks_${i}`}
                              aria-label={`Remarks ${i + 1}`}
                              value={row.remarks}
                              onChange={(e) => updateRow(i, { remarks: e.target.value })}
                              className={miniInp}
                            />
                          </td>

                          <td className={cn(td, "text-center")}>
                            {rows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeRow(i)}
                                aria-label={`Remove material ${i + 1}`}
                                title="Remove row"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#DC2626] hover:bg-red-50"
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Inventory unit setup (read-only) or the "not found"
                            panel, under the row. */}
                        {hasDescription && (
                          <tr className="bg-[#F9FAFB]">
                            <td className={td} />
                            <td className={td} colSpan={columnCount - 1}>
                              {isExisting ? (
                                <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs text-[#111827]">
                                  <div>
                                    <span className="block text-[11px] font-semibold text-[#4B5563]">Purchase Unit</span>
                                    <p className="mt-0.5 text-sm font-semibold">{row.purchaseUnit}</p>
                                  </div>
                                  <div>
                                    <span className="block text-[11px] font-semibold text-[#4B5563]">Stock Unit</span>
                                    <p className="mt-0.5 text-sm font-semibold">{row.unit}</p>
                                  </div>
                                  <div>
                                    <span className="block text-[11px] font-semibold text-[#4B5563]">Conversion</span>
                                    <p className="mt-0.5 text-sm font-semibold">
                                      {figures.unitsDiffer && figures.conversion !== null
                                        ? `1 ${row.purchaseUnit} = ${fmt(figures.conversion)} ${row.unit}`
                                        : "Same unit (1)"}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="block text-[11px] font-semibold text-[#4B5563]">Expected Stock After Receiving</span>
                                    <p className="mt-0.5 text-sm font-bold">
                                      {figures.stockQty !== null && Number(row.qty) > 0 ? `${fmt(figures.stockQty)} ${row.unit}` : "—"}
                                    </p>
                                  </div>
                                  {canEnterPrices && figures.price !== null && (
                                    <div className="min-w-[230px] rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs leading-relaxed">
                                      <p>Requested: <span className="font-bold">{row.qty || 0} {row.purchaseUnit}</span></p>
                                      {figures.unitsDiffer && figures.conversion !== null && (
                                        <p>
                                          Conversion: <span className="font-bold">1 {row.purchaseUnit} = {fmt(figures.conversion)} {row.unit}</span>
                                        </p>
                                      )}
                                      <p>
                                        Expected stock after receiving:{" "}
                                        <span className="font-bold">{figures.stockQty !== null ? `${fmt(figures.stockQty)} ${row.unit}` : "—"}</span>
                                      </p>
                                      <p>
                                        Price:{" "}
                                        <span className="font-bold">
                                          {figures.basis
                                            ? `${formatKwd(figures.price)} KWD for 1 ${basisUnit(figures.basis, row.purchaseUnit, row.unit)}`
                                            : `${formatKwd(figures.price)} KWD — choose 1 ${row.purchaseUnit} or 1 ${row.unit}`}
                                        </span>
                                      </p>
                                      <p>
                                        Estimated Total: <span className="font-bold">{figures.total !== null ? `${formatKwd(figures.total)} KWD` : "—"}</span>
                                      </p>
                                    </div>
                                  )}
                                  {canEnterPrices && (
                                    <div className="basis-full">
                                      <PriceBasisWarnings
                                        purchaseUnit={row.purchaseUnit}
                                        stockUnit={row.unit}
                                        unitsDiffer={figures.unitsDiffer}
                                        conversion={figures.conversion}
                                        price={figures.price}
                                        basis={figures.basis}
                                        total={figures.total}
                                        largeTotal={figures.largeTotal}
                                        acknowledged={figures.largeTotalAcked}
                                        onAcknowledge={(checked) =>
                                          updateRow(i, {
                                            largeTotalAckKey:
                                              checked && figures.basis && figures.total !== null && figures.price !== null
                                                ? largeTotalAckKey(figures.price, figures.basis, figures.total)
                                                : null,
                                          })
                                        }
                                      />
                                    </div>
                                  )}
                                  {row.matchKey && (
                                    <a
                                      href={`/store/offline-inventory?material=${encodeURIComponent(row.matchKey)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="ml-auto self-center font-semibold text-[#2563EB] hover:underline"
                                    >
                                      Edit units in Inventory
                                    </a>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <div role="alert" className="rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                                    <p className="font-black">Material not found in Inventory.</p>
                                    <p className="mt-0.5">
                                      Add this material in Inventory first so purchase unit, stock unit, and conversion are recorded
                                      correctly. Then search for it again here.
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <a
                                        href="/store/offline-inventory/add-material"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex min-h-9 items-center rounded-md bg-[#ED1C24] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#c8181e]"
                                      >
                                        Add New Material
                                      </a>
                                      <button
                                        type="button"
                                        onClick={() => handleMaterialNameChange(i, row.description)}
                                        className="inline-flex min-h-9 items-center rounded-md border border-amber-400 bg-white px-4 py-1.5 text-sm font-bold text-amber-900 hover:bg-amber-100"
                                      >
                                        Search again
                                      </button>
                                      <span className="text-xs">Add New Material opens in a new tab, so this request is kept.</span>
                                    </div>
                                    {canRequestUnlinked && (
                                      <label className="mt-2 flex items-center gap-2 border-t border-amber-200 pt-2 text-xs font-semibold">
                                        <input
                                          type="checkbox"
                                          checked={row.unlinkedOverride}
                                          onChange={(e) => updateRow(i, { unlinkedOverride: e.target.checked })}
                                          className="h-4 w-4 accent-[#ED1C24]"
                                        />
                                        Manager override: request without an Inventory link (one unit, no conversion). Use only for
                                        emergencies.
                                      </label>
                                    )}
                                  </div>
                                  {row.unlinkedOverride && (
                                    <p className="mt-1.5 text-xs text-[#4B5563]">
                                      Requested: <span className="font-bold">{row.qty || 0} {row.unit || "—"}</span> · Not linked to
                                      Inventory — the material is registered when it is received.
                                    </p>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {errors.items && (
              <p className="mt-3 text-xs text-[#DC2626]">{errors.items}</p>
            )}

            <p className="mt-3 text-xs text-[#9CA3AF]">
              SS Rec. Code is reserved for SAP material/reference mapping.
            </p>

            {rows.length < MAX_ITEM_ROWS && (
              <button
                type="button"
                onClick={addRow}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B5563] hover:bg-[#F3F4F6]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add Row
              </button>
            )}
          </PRCard>
        </div>

        {/* ── Step 3: Attachments ─────────────────────────────────── */}
        <div className={step !== 3 ? "hidden" : ""}>
          <PRCard
            title="Attachments"
            description="Optional — upload request documents, supplier references, material photos, PDFs, Excel files, or supporting files."
          >
            <AttachmentUploadFields
              namePrefix="pr_attachment"
              categories={PARTS_REQUEST_ATTACHMENT_CATEGORIES}
              defaultCategory="Request Document"
              accept={ATTACHMENT_FILE_ACCEPT}
              maxRows={MAX_ATTACHMENT_ROWS}
            />
            <p className="mt-4 text-xs text-[#9CA3AF]">
              Accepted: PDF, JPG, JPEG, PNG, WEBP, XLS, XLSX, DOC, DOCX
            </p>
          </PRCard>
        </div>

        {/* ── Step 4: Review & Submit ────────────────────────────────────── */}
        <div className={step !== 4 ? "hidden" : ""}>
          <PRCard
            title="Review & Submit"
            description="Confirm all details before submitting the materials request."
          >
            <div className="space-y-5">
              <PRReviewSection title="Job Card">
                {selectedWo ? (
                  <div>
                    <p className="font-bold text-[#111827]">
                      {selectedWo.work_order_number ?? "Draft"} — {selectedWo.ordered_by}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {selectedWo.maintenance_type && (
                        <PRChip>{selectedWo.maintenance_type}</PRChip>
                      )}
                      {selectedWo.worker_type && <PRChip>{selectedWo.worker_type}</PRChip>}
                    </div>
                    {selectedAsset && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold text-[#4B5563]">
                          Asset: {selectedAsset.asset_code} — {selectedAsset.asset_name}
                        </p>
                        {selectedAsset.location && (
                          <p className="text-xs text-[#4B5563]">
                            Location: {selectedAsset.location}
                          </p>
                        )}
                      </div>
                    )}
                    {selectedWo.operator_complaint && (
                      <p className="mt-2 text-xs italic text-[#4B5563]">
                        {selectedWo.operator_complaint}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm italic text-[#9CA3AF]">No job card selected</p>
                )}
              </PRReviewSection>

              {/* Task 11 — each item shown as either "Existing Inventory
                  Material" with its Requested/Current Balance, or "New
                  Material Request" with "Not linked to inventory yet". */}
              {reviewItems.length > 0 ? (
                <PRReviewSection title="Requested Materials">
                  <ul className="divide-y divide-[#F3F4F6]">
                    {reviewItems.map((it, i) => {
                      const isExisting = it.matchKey !== null;
                      const f = rowFigures(it);
                      return (
                        <li key={i} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex items-center justify-between gap-2">
                            <StatusBadge
                              label={isExisting ? "Existing Inventory" : "Not in Inventory (Manager override)"}
                              tone={isExisting ? "green" : "amber"}
                            />
                          </div>
                          <p className="mt-1 font-bold text-[#111827]">{it.description}</p>
                          <p className="text-xs text-[#4B5563]">
                            Requested Purchase Qty: {it.qty || 0} {it.purchaseUnit || "—"}
                            {f.stockQty !== null && <> · Expected stock after receiving: {fmt(f.stockQty)} {it.unit}</>}
                          </p>
                          {f.unitsDiffer && f.conversion !== null && (
                            <p className="text-xs text-[#4B5563]">
                              Conversion: 1 {it.purchaseUnit} = {fmt(f.conversion)} {it.unit}
                            </p>
                          )}
                          {canEnterPrices && f.price !== null && f.total !== null && (
                            <p className="text-xs text-[#4B5563]">
                              Estimated Price: {formatKwd(f.price)} KWD for 1 {basisUnit(f.basis!, it.purchaseUnit, it.unit)} · Estimated
                              Total: {formatKwd(f.total)} KWD
                            </p>
                          )}
                          {isExisting ? (
                            <p className="text-xs text-[#4B5563]">
                              Current Balance: {it.balance !== null ? `${fmt(it.balance)} ${it.balanceUnit}` : "—"}
                            </p>
                          ) : (
                            <p className="text-xs italic text-[#9CA3AF]">Not linked to inventory yet</p>
                          )}
                          {(it.partNumber || it.ssRecCode) && (
                            <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
                              {it.partNumber ? `Part No: ${it.partNumber}` : ""}
                              {it.partNumber && it.ssRecCode ? " · " : ""}
                              {it.ssRecCode ? `SS Rec. Code: ${it.ssRecCode}` : ""}
                            </p>
                          )}
                          {it.remarks && (
                            <p className="mt-0.5 text-xs text-[#4B5563]"><strong>Remarks:</strong> {it.remarks}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {reviewData.remarks && (
                    <p className="mt-3 text-xs text-[#4B5563]">
                      <strong>Overall remarks:</strong> {reviewData.remarks}
                    </p>
                  )}
                  {/* Task 11 — Data Entry gets no cost summary at all; Manager/
                      Super Admin only, and only if cost permission exists. */}
                  {canEnterPrices && (
                    <div className="mt-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                      <p className="text-sm font-bold text-[#111827]">
                        Estimated Cost Summary:{" "}
                        {pricedReviewTotals.length > 0 ? `${formatKwd(reviewEstimatedTotal)} KWD` : "Not available"}
                      </p>
                      {reviewHasUnpriced && pricedReviewTotals.length > 0 && (
                        <p className="mt-1 text-xs text-amber-700">
                          Some material lines are not priced yet. Estimated total excludes them.
                        </p>
                      )}
                    </div>
                  )}
                </PRReviewSection>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm text-amber-700">
                    No materials have been added. Go back to Step 2 to add materials.
                  </p>
                </div>
              )}

              <PRReviewSection title="Attachments">
                {reviewAttachments.length > 0 ? (
                  <ul className="divide-y divide-[#F3F4F6]">
                    {reviewAttachments.map((a, i) => (
                      <li key={i} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                        <span className="text-xs font-bold uppercase tracking-wide text-[#9CA3AF]">{a.category}</span>
                        <span className="text-sm font-semibold text-[#111827]">{a.fileName}</span>
                        {a.remarks && <span className="text-xs text-[#4B5563]">{a.remarks}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm italic text-[#9CA3AF]">No attachments added.</p>
                )}
              </PRReviewSection>
            </div>

            <div className="mt-6 border-t border-[#E5E7EB] pt-5">
              <button
                type="submit"
                className="focus-ring w-full rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-[#c8181e]"
              >
                Submit Materials Request
              </button>
              <p className="mt-2 text-center text-xs text-[#9CA3AF]">
                A reference number will be generated on submission. Inventory balance does not change until materials are received.
              </p>
            </div>
          </PRCard>
        </div>

        {/* ── Navigation ────────────────────────────────────────────────── */}
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] shadow-sm transition hover:bg-[#F3F4F6]"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </button>
            )}
            {modalMode && (
              <button
                type="button"
                onClick={() => modal?.requestClose()}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#ED1C24] shadow-sm transition hover:bg-red-50"
              >
                Cancel
              </button>
            )}
          </div>
          {step < 4 && (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e]"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ── Local sub-components ──────────────────────────────────────────────────────

function cn(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function PRCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="mb-5 border-b border-[#E5E7EB] pb-4">
        <h2 className="text-base font-bold text-[#111827]">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-[#4B5563]">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function PRLabel({
  label,
  required,
  hint,
}: {
  label: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <span className="block text-sm font-semibold text-[#111827]">
      {label}
      {required && <span className="ml-0.5 text-[#ED1C24]"> *</span>}
      {hint && <span className="ml-2 text-xs font-normal text-[#9CA3AF]">{hint}</span>}
    </span>
  );
}

function PRReviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#9CA3AF]">
        {title}
      </h3>
      <div className="rounded-md border border-[#E5E7EB] p-4">{children}</div>
    </section>
  );
}

function PRChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[#E5E7EB] bg-white px-2.5 py-0.5 text-xs font-semibold text-[#4B5563]">
      {children}
    </span>
  );
}

function PRStatusBadge({ status }: { status: string }) {
  const cls =
    status === "Breakdown"
      ? "bg-red-100 text-red-700"
      : status === "Active" || status === "In Use"
        ? "bg-green-100 text-green-700"
        : "bg-gray-100 text-gray-700";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${cls}`}>{status}</span>
  );
}
