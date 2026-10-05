"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus } from "lucide-react";

import {
  sendAssetToSiteAction,
  receiveAssetBackAction,
  type AssetMovementActionState,
} from "@/app/actions/asset-movements";
import { createAssetLocationAction } from "@/app/actions/asset-locations";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import { assetLocationOptionLabel, type AssetLocationOption } from "@/lib/assets/asset-location-types";

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";
const lbl = "block text-xs font-bold text-[#4B5563] mb-1";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ErrorBanner({ state }: { state: AssetMovementActionState }) {
  if (state?.ok !== false) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{state.error}</span>
    </div>
  );
}

// Task 2 — Send to Site form. Sent By is always the current user (set
// server-side in the action, never a form field).
// Site Locations — "To Location / Site" is a dropdown of the active
// approved locations (`locations`), not free text. `canManageLocations`
// (Manager / Super Admin) adds the Manage locations link and the inline
// "+ Add Location" quick add, which selects the new location on save.
export function SendToSiteForm({
  assetId,
  dismissHref,
  locations,
  canManageLocations,
}: {
  assetId: string;
  dismissHref: string;
  locations: AssetLocationOption[];
  canManageLocations: boolean;
}) {
  const router = useRouter();
  const modal = useLargeFormModal();
  const [state, formAction, isPending] = useActionState<AssetMovementActionState, FormData>(
    sendAssetToSiteAction,
    null
  );
  // Locations added through the quick add, on top of the server's list.
  const [addedLocations, setAddedLocations] = useState<AssetLocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickCode, setQuickCode] = useState("");
  const [quickError, setQuickError] = useState<string | null>(null);
  const [isAdding, startAdding] = useTransition();

  const options = [...locations, ...addedLocations.filter((a) => !locations.some((l) => l.id === a.id))].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // The quick-add fields carry no `name`, so they are never part of the
  // Send to Site submission; the location is created by its own action.
  function saveQuickLocation() {
    setQuickError(null);
    const data = new FormData();
    data.set("name", quickName);
    data.set("code", quickCode);
    startAdding(async () => {
      const result = await createAssetLocationAction(null, data);
      if (result?.ok && result.location) {
        const created = result.location;
        setAddedLocations((current) => [...current, created]);
        setLocationId(created.id);
        setQuickAddOpen(false);
        setQuickName("");
        setQuickCode("");
      } else {
        setQuickError(result?.ok === false ? result.error : "Could not add the location. Please try again.");
      }
    });
  }

  useEffect(() => {
    if (state?.ok) router.push(dismissHref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="asset_id" value={assetId} />
      <ErrorBanner state={state} />

      <div>
        <label htmlFor="sts-to-location" className={lbl}>
          To Location / Site <span className="text-[#ED1C24]">*</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="sts-to-location"
            name="asset_location_id"
            required
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={`${inp} min-w-0 flex-1`}
            disabled={isPending}
          >
            <option value="">Select location / site</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {assetLocationOptionLabel(option)}
              </option>
            ))}
          </select>
          {canManageLocations && !quickAddOpen && (
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              disabled={isPending}
              className="inline-flex min-h-[38px] items-center gap-1 whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-bold text-[#111827] hover:bg-gray-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add Location
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-[#6B7280]">
          {options.length === 0 ? "No active locations yet. " : ""}
          Locations are managed from Site Locations.
          {canManageLocations && (
            <>
              {" "}
              <Link href="/asset-locations" target="_blank" className="font-bold text-[#ED1C24] hover:underline">
                Manage locations
              </Link>
            </>
          )}
        </p>

        {canManageLocations && quickAddOpen && (
          <div className="mt-2 space-y-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
            <p className="text-xs font-black uppercase tracking-wide text-[#4B5563]">Add Location</p>
            {quickError && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                {quickError}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="sts-quick-name" className={lbl}>
                  Location / Site Name <span className="text-[#ED1C24]">*</span>
                </label>
                <input
                  id="sts-quick-name"
                  type="text"
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Salmi 1604"
                  className={inp}
                  disabled={isAdding}
                />
              </div>
              <div>
                <label htmlFor="sts-quick-code" className={lbl}>Location Code</label>
                <input
                  id="sts-quick-code"
                  type="text"
                  value={quickCode}
                  onChange={(e) => setQuickCode(e.target.value)}
                  maxLength={40}
                  placeholder="Optional"
                  className={inp}
                  disabled={isAdding}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setQuickAddOpen(false);
                  setQuickError(null);
                }}
                disabled={isAdding}
                className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-bold text-[#4B5563] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveQuickLocation}
                disabled={isAdding || quickName.trim() === ""}
                className="rounded-md bg-[#111827] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#2b2b2b] disabled:opacity-60"
              >
                {isAdding ? "Saving…" : "Save Location"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sts-sent-date" className={lbl}>
            Sent Date <span className="text-[#ED1C24]">*</span>
          </label>
          <input id="sts-sent-date" type="date" name="sent_date" required defaultValue={todayStr()} className={inp} disabled={isPending} />
        </div>
        <div>
          <label htmlFor="sts-expected-return" className={lbl}>Expected Return Date</label>
          <input id="sts-expected-return" type="date" name="expected_return_date" className={inp} disabled={isPending} />
        </div>
      </div>

      <div>
        <label htmlFor="sts-responsible" className={lbl}>Responsible Person / Driver</label>
        <input id="sts-responsible" type="text" name="responsible_person" placeholder="Name of person taking the asset" className={inp} disabled={isPending} />
      </div>

      <div>
        <label htmlFor="sts-purpose" className={lbl}>Purpose / Work Description</label>
        <textarea id="sts-purpose" name="purpose" rows={2} placeholder="What the asset is needed for at the site" className={inp} disabled={isPending} />
      </div>

      <div>
        <label htmlFor="sts-remarks" className={lbl}>Remarks</label>
        <textarea id="sts-remarks" name="remarks" rows={2} className={inp} disabled={isPending} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => (modal ? modal.requestClose() : router.push(dismissHref))}
          className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e] disabled:opacity-60"
          disabled={isPending}
        >
          {isPending ? "Sending…" : "Send to Site"}
        </button>
      </div>
    </form>
  );
}

// Task 3 — Receive Back form. Received By is always the current user (set
// server-side in the action, never a form field).
export function ReceiveBackForm({
  assetId,
  movementId,
  defaultReturnLocation,
  dismissHref,
}: {
  assetId: string;
  movementId: string;
  defaultReturnLocation: string;
  dismissHref: string;
}) {
  const router = useRouter();
  const modal = useLargeFormModal();
  const [state, formAction, isPending] = useActionState<AssetMovementActionState, FormData>(
    receiveAssetBackAction,
    null
  );

  useEffect(() => {
    if (state?.ok) router.push(dismissHref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="movement_id" value={movementId} />
      <ErrorBanner state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rb-return-date" className={lbl}>
            Return Date <span className="text-[#ED1C24]">*</span>
          </label>
          <input id="rb-return-date" type="date" name="return_date" required defaultValue={todayStr()} className={inp} disabled={isPending} />
        </div>
        <div>
          <label htmlFor="rb-return-location" className={lbl}>
            Return Location <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id="rb-return-location"
            type="text"
            name="return_location"
            required
            defaultValue={defaultReturnLocation}
            className={inp}
            disabled={isPending}
          />
        </div>
      </div>

      <div>
        <label htmlFor="rb-remarks" className={lbl}>Remarks</label>
        <textarea id="rb-remarks" name="remarks" rows={2} placeholder="Condition on return, notes, etc." className={inp} disabled={isPending} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => (modal ? modal.requestClose() : router.push(dismissHref))}
          className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e] disabled:opacity-60"
          disabled={isPending}
        >
          {isPending ? "Saving…" : "Receive Back"}
        </button>
      </div>
    </form>
  );
}
