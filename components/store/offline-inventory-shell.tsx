"use client";

import { useState, useEffect, useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUpFromLine,
  CheckCircle2,
  Loader2,
  Package,
  Plus,
  X,
} from "lucide-react";

import {
  receiveOfflineMaterialAction,
  issueOfflineMaterialAction,
  type OfflineMovementState,
} from "@/app/actions/offline-inventory";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PartOption = {
  id: string;
  part_name: string;
  part_number: string | null;
  unit_of_measure: string;
};

export type WorkOrderOption = {
  id: string;
  work_order_number: string | null;
};

export type MovementRow = {
  id: string;
  movement_type: string;
  movement_date: string;
  part_name: string | null;
  part_number_display: string | null;
  manual_material_name: string | null;
  quantity: number;
  unit: string;
  counterparty: string | null;
  reference_number: string | null;
  related_work_order_id: string | null;
  work_order_number: string | null;
  remarks: string | null;
  created_by_name: string;
};

export type BalanceItem = {
  key: string;
  part_id: string | null;
  display_name: string;
  part_number: string | null;
  manual_material_name: string | null;
  unit: string;
  total_received: number;
  total_issued: number;
  balance: number;
  last_movement_date: string;
};

export interface OfflineInventoryShellProps {
  movements: MovementRow[];
  parts: PartOption[];
  workOrders: WorkOrderOption[];
  balanceItems: BalanceItem[];
  totalReceived: number;
  totalIssued: number;
  balance: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; tone: "green" | "red" | "blue" | "amber" }> = {
  RECEIVED:   { label: "Received",   tone: "green" },
  ISSUED:     { label: "Issued",     tone: "red" },
  RETURNED:   { label: "Returned",   tone: "blue" },
  ADJUSTMENT: { label: "Adjustment", tone: "amber" },
};

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";

const lbl = "block text-xs font-bold text-[#4B5563] mb-1";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

type Tone5 = "green" | "red" | "blue" | "amber" | "gray";

function SummaryCard({
  title,
  value,
  tone,
  icon: Icon,
}: {
  title: string;
  value: number;
  tone: Tone5;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const bg: Record<Tone5, string> = {
    green: "bg-[#16A34A]",
    red:   "bg-[#ED1C24]",
    blue:  "bg-[#2563EB]",
    amber: "bg-[#F59E0B]",
    gray:  "bg-[#111827]",
  };
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-md p-2 text-white ${bg[tone]}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <span className="text-2xl font-black text-[#111827]">
          {value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </span>
      </div>
      <p className="mt-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">{title}</p>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <h2 id="modal-title" className="text-base font-black text-[#111827]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[#9CA3AF] transition hover:bg-gray-100 hover:text-[#4B5563]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ── Receive Modal ─────────────────────────────────────────────────────────────

function ReceiveModal({
  parts,
  workOrders,
  onClose,
  onSuccess,
}: {
  parts: PartOption[];
  workOrders: WorkOrderOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, isPending] = useActionState<OfflineMovementState, FormData>(
    receiveOfflineMaterialAction,
    null
  );
  const [partId, setPartId]               = useState("");
  const [unit, setUnit]                   = useState("PCS");
  const [manualPartNum, setManualPartNum] = useState("");

  useEffect(() => {
    if (state?.ok) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  const isManual    = partId === "" || partId === "__manual__";
  const currentPart = parts.find((p) => p.id === partId) ?? null;

  function onPartChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setPartId(id);
    if (id === "" || id === "__manual__") {
      setUnit("PCS");
      setManualPartNum("");
    } else {
      const p = parts.find((p) => p.id === id);
      if (p) {
        setUnit(p.unit_of_measure);
        setManualPartNum(p.part_number ?? "");
      }
    }
  }

  return (
    <Modal title="Receive Material" onClose={isPending ? () => undefined : onClose}>
      <form action={formAction} className="space-y-4">
        {state?.ok === false && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{state.error}</span>
          </div>
        )}

        {/* Date */}
        <div>
          <label htmlFor="r-date" className={lbl}>
            Movement Date <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id="r-date"
            type="date"
            name="movement_date"
            required
            defaultValue={todayStr()}
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Part selector */}
        <div>
          <label htmlFor="r-part" className={lbl}>
            Material / Spare Part <span className="text-[#ED1C24]">*</span>
          </label>
          <select
            id="r-part"
            name="part_id"
            value={partId}
            onChange={onPartChange}
            className={inp}
            disabled={isPending}
          >
            <option value="">Select from spare parts master…</option>
            <option value="__manual__">— Enter material name manually —</option>
            {parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.part_name}{p.part_number ? ` (${p.part_number})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Manual name — only shown when not using master */}
        {isManual && (
          <div>
            <label htmlFor="r-manual-name" className={lbl}>
              Manual material name <span className="text-[#ED1C24]">*</span>
            </label>
            <input
              id="r-manual-name"
              type="text"
              name="manual_material_name"
              required
              placeholder="e.g. Hydraulic Hose 12 mm"
              className={inp}
              disabled={isPending}
            />
          </div>
        )}

        {/* Part number */}
        <div>
          <label htmlFor="r-partnum" className={lbl}>
            Part number
            {!isManual && <span className="ml-1 font-normal text-[#9CA3AF]">(auto-filled)</span>}
          </label>
          <input
            id="r-partnum"
            type="text"
            name="manual_part_number"
            value={isManual ? manualPartNum : (currentPart?.part_number ?? "")}
            onChange={isManual ? (e) => setManualPartNum(e.target.value) : undefined}
            readOnly={!isManual}
            placeholder="Optional"
            className={cn(inp, !isManual && "bg-gray-50 text-[#6B7280] cursor-default")}
            disabled={isPending}
          />
        </div>

        {/* Qty + Unit */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="r-qty" className={lbl}>
              Quantity <span className="text-[#ED1C24]">*</span>
            </label>
            <input
              id="r-qty"
              type="number"
              name="quantity"
              min="0.001"
              step="0.001"
              required
              placeholder="0.000"
              className={inp}
              disabled={isPending}
            />
          </div>
          <div>
            <label htmlFor="r-unit" className={lbl}>
              Unit <span className="text-[#ED1C24]">*</span>
            </label>
            <input
              id="r-unit"
              type="text"
              name="unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              required
              placeholder="PCS"
              className={inp}
              disabled={isPending}
            />
          </div>
        </div>

        {/* Received from */}
        <div>
          <label htmlFor="r-from" className={lbl}>Received from</label>
          <input
            id="r-from"
            type="text"
            name="counterparty"
            placeholder="Supplier / sender name"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Reference number */}
        <div>
          <label htmlFor="r-ref" className={lbl}>Reference number</label>
          <input
            id="r-ref"
            type="text"
            name="reference_number"
            placeholder="e.g. LPO-2026-001, DO-123"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Related job card */}
        <div>
          <label htmlFor="r-wo" className={lbl}>Related Job Card</label>
          <select id="r-wo" name="related_work_order_id" className={inp} disabled={isPending}>
            <option value="">No job card</option>
            {workOrders.map((wo) => (
              <option key={wo.id} value={wo.id}>
                {wo.work_order_number ?? `Job Card ${wo.id.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Remarks */}
        <div>
          <label htmlFor="r-remarks" className={lbl}>Remarks</label>
          <textarea
            id="r-remarks"
            name="remarks"
            rows={2}
            placeholder="Optional notes"
            className={cn(inp, "resize-none")}
            disabled={isPending}
          />
        </div>

        <div className="flex items-center gap-2 border-t border-[#F3F4F6] pt-4">
          <button
            type="submit"
            disabled={isPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? "Saving…" : "Save Received Material"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Issue Modal ───────────────────────────────────────────────────────────────

function IssueModal({
  availableItems,
  workOrders,
  preselectedKey,
  onClose,
  onSuccess,
}: {
  availableItems: BalanceItem[];
  workOrders: WorkOrderOption[];
  preselectedKey: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, isPending] = useActionState<OfflineMovementState, FormData>(
    issueOfflineMaterialAction,
    null
  );
  const [selectedKey, setSelectedKey] = useState(preselectedKey ?? "");

  useEffect(() => {
    if (state?.ok) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  const selectedItem = availableItems.find((b) => b.key === selectedKey) ?? null;

  // No available balance — show informational state instead of a form
  if (availableItems.length === 0) {
    return (
      <Modal title="Issue Material" onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <Package className="h-10 w-10 text-[#9CA3AF]" aria-hidden />
          <div>
            <p className="font-bold text-[#111827]">No materials available to issue</p>
            <p className="mt-1 text-sm text-[#4B5563]">
              Receive materials first before issuing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#E5E7EB] bg-white px-5 py-2 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Issue Material" onClose={isPending ? () => undefined : onClose}>
      <form action={formAction} className="space-y-4">
        {state?.ok === false && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{state.error}</span>
          </div>
        )}

        {/* Hidden identity fields — auto-set from the selected balance item */}
        <input type="hidden" name="part_id"              value={selectedItem?.part_id ?? ""} />
        <input type="hidden" name="manual_material_name" value={selectedItem?.manual_material_name ?? ""} />
        <input type="hidden" name="unit"                 value={selectedItem?.unit ?? "PCS"} />

        {/* Date */}
        <div>
          <label htmlFor="i-date" className={lbl}>
            Movement Date <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id="i-date"
            type="date"
            name="movement_date"
            required
            defaultValue={todayStr()}
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Available material selector */}
        <div>
          <label htmlFor="i-material" className={lbl}>
            Available Material <span className="text-[#ED1C24]">*</span>
          </label>
          <select
            id="i-material"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            className={inp}
            disabled={isPending}
          >
            <option value="">Select available material…</option>
            {availableItems.map((item) => (
              <option key={item.key} value={item.key}>
                {item.display_name}
                {item.part_number ? ` (${item.part_number})` : ""}{" "}
                — Available:{" "}
                {item.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })} {item.unit}
              </option>
            ))}
          </select>
          {selectedItem && (
            <p className="mt-1.5 text-xs font-semibold text-[#16A34A]">
              Available balance:{" "}
              {selectedItem.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })}{" "}
              {selectedItem.unit}
            </p>
          )}
        </div>

        {/* Qty + Unit (unit is read-only from the selected item) */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="i-qty" className={lbl}>
              Quantity <span className="text-[#ED1C24]">*</span>
            </label>
            <input
              id="i-qty"
              type="number"
              name="quantity"
              min="0.001"
              step="0.001"
              max={selectedItem ? selectedItem.balance : undefined}
              required
              placeholder="0.000"
              className={inp}
              disabled={isPending || !selectedItem}
            />
          </div>
          <div>
            <label htmlFor="i-unit" className={lbl}>Unit</label>
            <input
              id="i-unit"
              type="text"
              value={selectedItem?.unit ?? ""}
              readOnly
              placeholder="—"
              className={cn(inp, "bg-gray-50 text-[#6B7280] cursor-default")}
              disabled={isPending}
            />
          </div>
        </div>

        {/* Issued to */}
        <div>
          <label htmlFor="i-to" className={lbl}>
            Issued / Sent to <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id="i-to"
            type="text"
            name="counterparty"
            required
            placeholder="Technician, location, or department"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Purpose */}
        <div>
          <label htmlFor="i-purpose" className={lbl}>Purpose</label>
          <input
            id="i-purpose"
            type="text"
            name="purpose"
            placeholder="e.g. Equipment repair, PM work"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Related job card */}
        <div>
          <label htmlFor="i-wo" className={lbl}>Related Job Card</label>
          <select id="i-wo" name="related_work_order_id" className={inp} disabled={isPending}>
            <option value="">No job card</option>
            {workOrders.map((wo) => (
              <option key={wo.id} value={wo.id}>
                {wo.work_order_number ?? `Job Card ${wo.id.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Receiver name */}
        <div>
          <label htmlFor="i-receiver" className={lbl}>Receiver name</label>
          <input
            id="i-receiver"
            type="text"
            name="receiver_name"
            placeholder="Name of person receiving"
            className={inp}
            disabled={isPending}
          />
        </div>

        {/* Remarks */}
        <div>
          <label htmlFor="i-remarks" className={lbl}>Remarks</label>
          <textarea
            id="i-remarks"
            name="remarks"
            rows={2}
            placeholder="Optional notes"
            className={cn(inp, "resize-none")}
            disabled={isPending}
          />
        </div>

        <div className="flex items-center gap-2 border-t border-[#F3F4F6] pt-4">
          <button
            type="submit"
            disabled={isPending || !selectedItem}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#111827] py-2.5 text-sm font-bold text-white transition hover:bg-gray-700 disabled:opacity-60"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? "Saving…" : "Save Issued Material"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main Shell ────────────────────────────────────────────────────────────────

export function OfflineInventoryShell({
  movements,
  parts,
  workOrders,
  balanceItems,
  totalReceived,
  totalIssued,
  balance,
}: OfflineInventoryShellProps) {
  const router = useRouter();

  const [openModal, setOpenModal]         = useState<null | "receive" | "issue">(null);
  const [issuePreselect, setIssuePreselect] = useState<string | null>(null);
  const [successMsg, setSuccessMsg]       = useState<string | null>(null);
  const [activeTab, setActiveTab]         = useState<"balance" | "movements">("balance");

  const availableItems     = balanceItems.filter((b) => b.balance > 0);
  const hasAvailableBalance = availableItems.length > 0;
  const isEmpty            = movements.length === 0 && balanceItems.length === 0;

  function handleSuccess(type: "receive" | "issue") {
    setOpenModal(null);
    setIssuePreselect(null);
    setSuccessMsg(
      type === "receive"
        ? "Material received and recorded."
        : "Material issued and recorded."
    );
    router.refresh();
    const t = setTimeout(() => setSuccessMsg(null), 5000);
    return () => clearTimeout(t);
  }

  function openIssueModal(key?: string) {
    setIssuePreselect(key ?? null);
    setOpenModal("issue");
  }

  const balanceTone: Tone5 = balance < 0 ? "red" : balance === 0 ? "gray" : "green";

  return (
    <>
      <PageHeader
        title="Offline Inventory Control"
        description="Track materials received, issued, and current offline balance for maintenance department use."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpenModal("receive")}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Receive Material
            </button>
            <button
              type="button"
              onClick={() => openIssueModal()}
              disabled={!hasAvailableBalance}
              title={!hasAvailableBalance ? "No materials with available balance" : undefined}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold text-[#111827] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowUpFromLine className="h-4 w-4" aria-hidden />
              Issue Material
            </button>
          </div>
        }
      />

      <div className="space-y-4 p-4 lg:p-6">

        {/* Success banner */}
        {successMsg && (
          <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
            <span className="font-semibold text-green-700">{successMsg}</span>
          </div>
        )}

        {/* KPI cards — Received, Issued, Balance */}
        <section className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <SummaryCard
            title="Total Received"
            value={totalReceived}
            tone="green"
            icon={ArrowDownToLine}
          />
          <SummaryCard
            title="Total Issued"
            value={totalIssued}
            tone="red"
            icon={ArrowUpFromLine}
          />
          <SummaryCard
            title="Current Balance"
            value={Math.max(0, balance)}
            tone={balanceTone}
            icon={ArrowDownUp}
          />
        </section>

        {/* Empty state */}
        {isEmpty ? (
          <div className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex flex-col items-center gap-6 px-4 py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#E5E7EB] bg-[#F5F6F8]">
                <Package className="h-8 w-8 text-[#9CA3AF]" aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-black text-[#111827]">
                  No offline inventory movements yet
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                  Receive materials to start tracking maintenance inventory.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setOpenModal("receive")}
                  className="inline-flex items-center gap-2 rounded-md bg-[#ED1C24] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#c8181e]"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Receive Material
                </button>
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-5 py-2.5 text-sm font-bold text-[#111827] opacity-50 cursor-not-allowed"
                >
                  <ArrowUpFromLine className="h-4 w-4" aria-hidden />
                  Issue Material
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Tabbed content */
          <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">

            {/* Tab headers */}
            <div className="flex border-b border-[#E5E7EB]">
              {(["balance", "movements"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-3.5 text-sm font-bold transition ${
                    activeTab === tab
                      ? "border-b-2 border-[#ED1C24] text-[#ED1C24]"
                      : "text-[#4B5563] hover:text-[#111827]"
                  }`}
                >
                  {tab === "balance" ? "Balance" : "Movements"}
                </button>
              ))}
            </div>

            {/* Balance tab */}
            {activeTab === "balance" && (
              balanceItems.length === 0 ? (
                <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
                  <Package className="h-8 w-8 text-[#9CA3AF]" aria-hidden />
                  <p className="text-sm text-[#4B5563]">No materials received yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                      <tr>
                        <th className="px-4 py-3">Material</th>
                        <th className="px-4 py-3">Part No.</th>
                        <th className="px-4 py-3">Unit</th>
                        <th className="px-4 py-3 text-right">Total Received</th>
                        <th className="px-4 py-3 text-right">Total Issued</th>
                        <th className="px-4 py-3 text-right">Balance</th>
                        <th className="px-4 py-3">Last Movement</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {balanceItems.map((item) => (
                        <tr key={item.key} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-semibold text-[#111827]">
                            {item.display_name}
                          </td>
                          <td className="px-4 py-3 text-xs text-[#4B5563]">
                            {item.part_number ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-[#4B5563]">{item.unit}</td>
                          <td className="px-4 py-3 text-right font-semibold text-[#16A34A]">
                            {item.total_received.toLocaleString("en-US", {
                              maximumFractionDigits: 3,
                            })}
                          </td>
                          <td className="px-4 py-3 text-right text-[#ED1C24]">
                            {item.total_issued.toLocaleString("en-US", {
                              maximumFractionDigits: 3,
                            })}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span
                              className={`font-black ${
                                item.balance > 0
                                  ? "text-[#111827]"
                                  : item.balance < 0
                                  ? "text-[#ED1C24]"
                                  : "text-[#9CA3AF]"
                              }`}
                            >
                              {item.balance.toLocaleString("en-US", {
                                maximumFractionDigits: 3,
                              })}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4B5563]">
                            {fmtDate(item.last_movement_date)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setActiveTab("movements")}
                                className="text-xs font-bold text-[#4B5563] hover:text-[#111827] hover:underline"
                              >
                                View
                              </button>
                              {item.balance > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openIssueModal(item.key)}
                                  className="rounded-md bg-[#111827] px-2.5 py-1 text-xs font-bold text-white hover:bg-gray-700"
                                >
                                  Issue
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* Movements tab */}
            {activeTab === "movements" && (
              movements.length === 0 ? (
                <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
                  <Package className="h-8 w-8 text-[#9CA3AF]" aria-hidden />
                  <p className="text-sm text-[#4B5563]">No movements recorded yet.</p>
                </div>
              ) : (
                <>
                  <div className="border-b border-[#E5E7EB] px-5 py-3">
                    <p className="text-xs text-[#4B5563]">
                      {movements.length} record{movements.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                        <tr>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Material</th>
                          <th className="px-4 py-3">Part No.</th>
                          <th className="px-4 py-3">Qty</th>
                          <th className="px-4 py-3">Unit</th>
                          <th className="px-4 py-3">Reference</th>
                          <th className="px-4 py-3">Job Card</th>
                          <th className="px-4 py-3">Entered By</th>
                          <th className="px-4 py-3">Remarks</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F3F4F6]">
                        {movements.map((m) => {
                          const meta = TYPE_META[m.movement_type] ?? TYPE_META.RECEIVED;
                          const name = m.manual_material_name ?? m.part_name ?? "—";
                          return (
                            <tr key={m.id} className="hover:bg-gray-50">
                              <td className="whitespace-nowrap px-4 py-3 text-[#111827]">
                                {fmtDate(m.movement_date)}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge label={meta.label} tone={meta.tone} />
                              </td>
                              <td className="px-4 py-3 font-semibold text-[#111827]">{name}</td>
                              <td className="px-4 py-3 text-xs text-[#4B5563]">
                                {m.part_number_display ?? "—"}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 font-bold text-[#111827]">
                                {m.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })}
                              </td>
                              <td className="px-4 py-3 text-[#4B5563]">{m.unit}</td>
                              <td className="px-4 py-3 text-xs text-[#4B5563]">
                                {m.reference_number ?? "—"}
                              </td>
                              <td className="px-4 py-3">
                                {m.related_work_order_id ? (
                                  <Link
                                    href={`/maintenance/work-orders/${m.related_work_order_id}`}
                                    className="text-xs font-bold text-[#ED1C24] hover:underline"
                                  >
                                    {m.work_order_number ?? "View"}
                                  </Link>
                                ) : (
                                  <span className="text-[#9CA3AF]">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-[#4B5563]">
                                {m.created_by_name}
                              </td>
                              <td className="max-w-[200px] truncate px-4 py-3 text-xs text-[#4B5563]">
                                {m.remarks ?? "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            )}

          </div>
        )}
      </div>

      {/* Modals */}
      {openModal === "receive" && (
        <ReceiveModal
          parts={parts}
          workOrders={workOrders}
          onClose={() => setOpenModal(null)}
          onSuccess={() => handleSuccess("receive")}
        />
      )}
      {openModal === "issue" && (
        <IssueModal
          availableItems={availableItems}
          workOrders={workOrders}
          preselectedKey={issuePreselect}
          onClose={() => {
            setOpenModal(null);
            setIssuePreselect(null);
          }}
          onSuccess={() => handleSuccess("issue")}
        />
      )}
    </>
  );
}
