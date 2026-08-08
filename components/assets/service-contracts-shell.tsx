"use client";

import { useState, useEffect, useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  X,
  XCircle,
} from "lucide-react";

import {
  createServiceContractAction,
  type ServiceContractState,
} from "@/app/actions/service-contracts";
import { PageHeader } from "@/components/ui/page-header";
import { PageNavigationActions } from "@/components/layout/page-navigation-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

// ── Prop types (plain JSON-safe) ───────────────────────────────────────────────

export type AssetOption = {
  id: string;
  asset_code: string;
  asset_name: string;
};

export type ContractRow = {
  id: string;
  asset_id: string;
  asset_code: string | null;
  asset_name: string | null;
  contract_title: string;
  service_company: string;
  contract_number: string | null;
  start_date: string;
  end_date: string;
  renewal_date: string | null;
  service_frequency: string;
  status_label: string;
  status_tone: "green" | "amber" | "red" | "gray";
  days_until_expiry: number;
};

export interface ServiceContractsShellProps {
  contracts: ContractRow[];
  assets: AssetOption[];
  activeCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  autoOpen: boolean;
  preselectedAssetId: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FREQUENCIES = [
  "One-time",
  "Monthly",
  "Quarterly",
  "Half-yearly",
  "Yearly",
  "As needed",
] as const;

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";

const lbl = "block text-xs font-bold text-[#4B5563] mb-1";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(iso));
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  tone,
  icon: Icon,
}: {
  title: string;
  value: number;
  tone: "green" | "amber" | "red";
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const bg = { green: "bg-[#16A34A]", amber: "bg-[#F59E0B]", red: "bg-[#ED1C24]" }[tone];
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-md p-2 text-white ${bg}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <span className="text-2xl font-black text-[#111827]">{value}</span>
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
        aria-labelledby="sc-modal-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <h2 id="sc-modal-title" className="text-base font-black text-[#111827]">
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

// ── New Contract form (inside modal) ──────────────────────────────────────────

function NewContractForm({
  assets,
  preselectedAssetId,
  onClose,
  onSuccess,
}: {
  assets: AssetOption[];
  preselectedAssetId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction, isPending] = useActionState<ServiceContractState, FormData>(
    createServiceContractAction,
    null
  );
  const [assetId, setAssetId] = useState(preselectedAssetId ?? "");

  useEffect(() => {
    if (state?.ok) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  return (
    <form action={formAction} className="space-y-4">
      {state?.ok === false && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </div>
      )}

      {/* Asset */}
      <div>
        <label htmlFor="sc-asset" className={lbl}>
          Asset / Equipment <span className="text-[#ED1C24]">*</span>
        </label>
        {assets.length === 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            No assets available. Create or import assets before adding service contracts.
          </p>
        ) : (
          <select
            id="sc-asset"
            name="asset_id"
            required
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className={inp}
            disabled={isPending}
          >
            <option value="">Select asset / equipment…</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.asset_code} — {a.asset_name}
              </option>
            ))}
          </select>
        )}
        <input type="hidden" name="asset_id" value={assetId} />
      </div>

      {/* Contract title */}
      <div>
        <label htmlFor="sc-title" className={lbl}>
          Contract title <span className="text-[#ED1C24]">*</span>
        </label>
        <input
          id="sc-title"
          type="text"
          name="contract_title"
          required
          placeholder="e.g. Annual Maintenance Agreement"
          className={inp}
          disabled={isPending}
        />
      </div>

      {/* Contract number + Service company — 2 columns */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sc-num" className={lbl}>Contract number</label>
          <input
            id="sc-num"
            type="text"
            name="contract_number"
            placeholder="Optional"
            className={inp}
            disabled={isPending}
          />
        </div>
        <div>
          <label htmlFor="sc-company" className={lbl}>
            Service company <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id="sc-company"
            type="text"
            name="service_company"
            required
            placeholder="Provider name"
            className={inp}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Contact person + Phone */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sc-contact" className={lbl}>Contact person</label>
          <input
            id="sc-contact"
            type="text"
            name="contact_person"
            placeholder="Optional"
            className={inp}
            disabled={isPending}
          />
        </div>
        <div>
          <label htmlFor="sc-phone" className={lbl}>Phone</label>
          <input
            id="sc-phone"
            type="tel"
            name="phone"
            placeholder="Optional"
            className={inp}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Email */}
      <div>
        <label htmlFor="sc-email" className={lbl}>Email</label>
        <input
          id="sc-email"
          type="email"
          name="email"
          placeholder="Optional"
          className={inp}
          disabled={isPending}
        />
      </div>

      {/* Start date + End date */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sc-start" className={lbl}>
            Start date <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id="sc-start"
            type="date"
            name="start_date"
            required
            className={inp}
            disabled={isPending}
          />
        </div>
        <div>
          <label htmlFor="sc-end" className={lbl}>
            End date <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id="sc-end"
            type="date"
            name="end_date"
            required
            className={inp}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Renewal date + Service frequency */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sc-renewal" className={lbl}>Renewal date</label>
          <input
            id="sc-renewal"
            type="date"
            name="renewal_date"
            className={inp}
            disabled={isPending}
          />
        </div>
        <div>
          <label htmlFor="sc-freq" className={lbl}>Service frequency</label>
          <select
            id="sc-freq"
            name="service_frequency"
            className={inp}
            disabled={isPending}
            defaultValue="One-time"
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Scope of service */}
      <div>
        <label htmlFor="sc-scope" className={lbl}>Scope of service</label>
        <textarea
          id="sc-scope"
          name="scope_of_service"
          rows={2}
          placeholder="What is covered under this contract?"
          className={cn(inp, "resize-none")}
          disabled={isPending}
        />
      </div>

      {/* Remarks */}
      <div>
        <label htmlFor="sc-remarks" className={lbl}>Remarks</label>
        <textarea
          id="sc-remarks"
          name="remarks"
          rows={2}
          placeholder="Optional notes"
          className={cn(inp, "resize-none")}
          disabled={isPending}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-[#F3F4F6] pt-4">
        <button
          type="submit"
          disabled={isPending || assets.length === 0}
          className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Saving…" : "Save Service Contract"}
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
  );
}

// ── Main shell ────────────────────────────────────────────────────────────────

export function ServiceContractsShell({
  contracts,
  assets,
  activeCount,
  expiringSoonCount,
  expiredCount,
  autoOpen,
  preselectedAssetId,
}: ServiceContractsShellProps) {
  const router = useRouter();
  const [openModal, setOpenModal]   = useState(autoOpen);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function handleSuccess() {
    setOpenModal(false);
    setSuccessMsg("Service contract saved successfully.");
    router.refresh();
    const t = setTimeout(() => setSuccessMsg(null), 5000);
    return () => clearTimeout(t);
  }

  return (
    <>
      <PageHeader
        title="Service Contracts"
        description="Track service contracts linked to assets — service provider, coverage, expiry dates, and renewal schedules."
        actions={
          <>
            {/* Missing Page Navigation Buttons Fix Unit 10E.3, Task 3. */}
            <PageNavigationActions secondaryLinks={[{ label: "Assets & Equipment", href: "/assets" }]} />
            <button
              type="button"
              onClick={() => setOpenModal(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New Service Contract
            </button>
          </>
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

        {/* KPI cards */}
        <section className="grid gap-3 grid-cols-3">
          <KpiCard title="Active Contracts" value={activeCount}       tone="green" icon={CheckCircle2} />
          <KpiCard title="Expiring Soon"    value={expiringSoonCount} tone="amber" icon={AlertTriangle} />
          <KpiCard title="Expired"          value={expiredCount}      tone="red"   icon={XCircle} />
        </section>

        {/* Table or empty state */}
        {contracts.length === 0 ? (
          <div className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex flex-col items-center gap-6 px-4 py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#E5E7EB] bg-[#F5F6F8]">
                <FileText className="h-8 w-8 text-[#9CA3AF]" aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-black text-[#111827]">No service contracts yet</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">
                  Create a service contract linked to an asset to track the provider, expiry, and renewal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenModal(true)}
                className="inline-flex items-center gap-2 rounded-md bg-[#ED1C24] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#c8181e]"
              >
                <Plus className="h-4 w-4" aria-hidden />
                New Service Contract
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] px-5 py-3">
              <h2 className="text-sm font-bold text-[#111827]">All Contracts</h2>
              <p className="text-xs text-[#4B5563]">
                {contracts.length} contract{contracts.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-left text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                  <tr>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Contract Title</th>
                    <th className="px-4 py-3">Asset</th>
                    <th className="px-4 py-3">Service Company</th>
                    <th className="px-4 py-3">Start</th>
                    <th className="px-4 py-3">End / Expiry</th>
                    <th className="px-4 py-3">Renewal</th>
                    <th className="px-4 py-3">Frequency</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {contracts.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <StatusBadge label={c.status_label} tone={c.status_tone} />
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#111827]">
                        {c.contract_title}
                      </td>
                      <td className="px-4 py-3">
                        {c.asset_code ? (
                          <Link
                            href={`/assets/${c.asset_id}?tab=service-contracts`}
                            className="text-xs font-bold text-[#ED1C24] hover:underline"
                          >
                            {c.asset_code} — {c.asset_name}
                          </Link>
                        ) : (
                          <span className="text-[#9CA3AF]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#111827]">{c.service_company}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#4B5563]">
                        {fmtDate(c.start_date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={
                            c.status_label === "Expired"
                              ? "font-bold text-[#ED1C24]"
                              : c.status_label === "Expiring Soon"
                              ? "font-bold text-[#F59E0B]"
                              : "text-[#4B5563]"
                          }
                        >
                          {fmtDate(c.end_date)}
                          {c.status_label === "Expiring Soon" && (
                            <span className="ml-1 text-xs text-[#F59E0B]">
                              ({c.days_until_expiry}d)
                            </span>
                          )}
                          {c.status_label === "Expired" && (
                            <span className="ml-1 text-xs text-[#ED1C24]">
                              ({Math.abs(c.days_until_expiry)}d ago)
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#4B5563]">
                        {fmtDate(c.renewal_date)}
                      </td>
                      <td className="px-4 py-3 text-[#4B5563]">{c.service_frequency}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/assets/${c.asset_id}?tab=service-contracts`}
                          className="text-xs font-bold text-[#ED1C24] hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {openModal && (
        <Modal title="New Service Contract" onClose={() => setOpenModal(false)}>
          <NewContractForm
            assets={assets}
            preselectedAssetId={preselectedAssetId}
            onClose={() => setOpenModal(false)}
            onSuccess={handleSuccess}
          />
        </Modal>
      )}
    </>
  );
}
