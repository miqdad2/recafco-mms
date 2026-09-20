"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";

import {
  sendAssetToSiteAction,
  receiveAssetBackAction,
  type AssetMovementActionState,
} from "@/app/actions/asset-movements";
import { useLargeFormModal } from "@/components/ui/large-form-modal";

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
export function SendToSiteForm({ assetId, dismissHref }: { assetId: string; dismissHref: string }) {
  const router = useRouter();
  const modal = useLargeFormModal();
  const [state, formAction, isPending] = useActionState<AssetMovementActionState, FormData>(
    sendAssetToSiteAction,
    null
  );

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
        <input
          id="sts-to-location"
          type="text"
          name="to_location"
          required
          placeholder="e.g. Site A — Shuwaikh Project"
          className={inp}
          disabled={isPending}
        />
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
