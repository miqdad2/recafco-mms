"use client";

import Link from "next/link";

import { LargeFormModal, useLargeFormModal } from "@/components/ui/large-form-modal";
import { StatusBadge } from "@/components/ui/status-badge";

// Vehicle Expiry Alerts Modal Unit 10B.1.
//
// Reuses the existing LargeFormModal shell (Task 1 — "do not create a
// completely different modal style") the same way the Materials
// Request/Add Material/Receive/Issue popups already do: the Manager
// dashboard (a Server Component) passes `closeHref` so the modal navigates
// back to the plain dashboard URL on close, exactly like the dashboard's
// own `?new_job_card=1`/`?sendPreview=` modals already work.
//
// Data is passed in fully pre-computed and serialized — this component does
// no fetching of its own. The dashboard already computes the complete
// `mgVehicleAlerts` list (Unit 10) for the KPI card and the top-3 snapshot;
// this modal just renders the same list in full (Task 2/7 — no new query).

export type VehicleExpiryAlertRow = {
  assetId: string;
  assetCode: string;
  assetName: string;
  plateNumber: string | null;
  document: "Insurance" | "Registration";
  expiryDateLabel: string;
  daysRemaining: number;
  expired: boolean;
};

function alertStatus(row: VehicleExpiryAlertRow): { label: string; tone: "red" | "amber" } {
  if (row.expired) return { label: "Expired", tone: "red" };
  if (row.daysRemaining === 0) return { label: "Expires Today", tone: "red" };
  if (row.daysRemaining <= 7) return { label: `${row.daysRemaining}d left`, tone: "red" };
  return { label: `${row.daysRemaining}d left`, tone: "amber" };
}

function AlertRow({ row }: { row: VehicleExpiryAlertRow }) {
  const status = alertStatus(row);
  return (
    <div className="flex flex-col gap-2 border-b border-[#EEF2F6] py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-[#111827]">
          {row.assetCode} <span className="font-normal text-[#6B7280]">— {row.assetName}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-[#6B7280]">
          {row.plateNumber ? `Plate ${row.plateNumber} · ` : ""}
          {row.document} · Expires {row.expiryDateLabel}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge label={status.label} tone={status.tone} />
        <Link
          href={`/assets/${row.assetId}`}
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-3 text-xs font-bold text-[#111827] transition hover:border-[#ED1C24] hover:text-[#ED1C24]"
        >
          View Vehicle
        </Link>
      </div>
    </div>
  );
}

// Footer buttons ("Open Vehicles Page" / "Close", Task 5) live inside the
// modal body (LargeFormModal has no separate footer slot) — the same
// pattern every other form wrapped in this shell already uses via
// useLargeFormModal() for its own Cancel/Close action.
function ModalFooter({ vehiclesPageHref }: { vehiclesPageHref: string }) {
  const modal = useLargeFormModal();
  return (
    <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[#EEF2F6] pt-4 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={() => modal?.requestClose()}
        className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
      >
        Close
      </button>
      <Link
        href={vehiclesPageHref}
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white transition hover:bg-[#c8181e]"
      >
        Open Vehicles Page
      </Link>
    </div>
  );
}

const VEHICLES_PAGE_HREF = "/assets/vehicles?insurance=expiring_15&registration=expiring_15";

export function VehicleExpiryModal({ alerts, closeHref }: { alerts: VehicleExpiryAlertRow[]; closeHref: string }) {
  return (
    <LargeFormModal
      title="Vehicle Expiry Alerts"
      subtitle="Registration and insurance documents expiring within 15 days."
      closeHref={closeHref}
    >
      {alerts.length === 0 ? (
        // Task 4 — empty state.
        <div className="flex flex-col items-center gap-1.5 py-10 text-center">
          <p className="text-sm font-semibold text-[#111827]">No vehicle documents expiring within 15 days.</p>
          <p className="text-xs text-[#6B7280]">You are currently up to date.</p>
        </div>
      ) : (
        <div>
          {alerts.map((row) => (
            <AlertRow key={`${row.assetId}-${row.document}`} row={row} />
          ))}
        </div>
      )}
      <ModalFooter vehiclesPageHref={VEHICLES_PAGE_HREF} />
    </LargeFormModal>
  );
}
