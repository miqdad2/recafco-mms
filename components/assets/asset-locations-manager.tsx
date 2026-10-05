"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, MapPin, Pencil, Plus, Trash2, X } from "lucide-react";

import {
  createAssetLocationAction,
  deleteAssetLocationAction,
  setAssetLocationActiveAction,
  updateAssetLocationAction,
  type AssetLocationActionState,
} from "@/app/actions/asset-locations";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AssetLocationRow } from "@/lib/assets/asset-location-types";
import { formatDate } from "@/lib/utils";

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";
const lbl = "block text-xs font-bold text-[#4B5563] mb-1";
const rowBtn =
  "inline-flex min-h-[32px] items-center gap-1 whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827] hover:bg-gray-50 disabled:opacity-50";

// Add / Edit Location modal. `location` null = add.
function LocationFormModal({ location, onClose }: { location: AssetLocationRow | null; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<AssetLocationActionState, FormData>(
    location ? updateAssetLocationAction : createAssetLocationAction,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="asset-location-modal-heading"
          className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
            <h2 id="asset-location-modal-heading" className="text-lg font-black text-[#111827]">
              {location ? "Edit Location" : "Add Location"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-2 text-[#6B7280] hover:bg-gray-100 hover:text-[#111827]"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <form action={formAction} className="space-y-4 overflow-y-auto px-5 py-4">
            {location && <input type="hidden" name="id" value={location.id} />}
            {state?.ok === false && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{state.error}</span>
              </div>
            )}

            <div>
              <label htmlFor="al-name" className={lbl}>
                Location / Site Name <span className="text-[#ED1C24]">*</span>
              </label>
              <input
                id="al-name"
                name="name"
                type="text"
                required
                maxLength={120}
                defaultValue={location?.name ?? ""}
                placeholder="e.g. Salmi 1604"
                className={inp}
                disabled={isPending}
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="al-code" className={lbl}>Location Code</label>
              <input
                id="al-code"
                name="code"
                type="text"
                maxLength={40}
                defaultValue={location?.code ?? ""}
                placeholder="e.g. SALMI-1604"
                className={inp}
                disabled={isPending}
              />
            </div>

            <div>
              <label htmlFor="al-remarks" className={lbl}>Remarks</label>
              <textarea id="al-remarks" name="remarks" rows={2} defaultValue={location?.remarks ?? ""} className={inp} disabled={isPending} />
            </div>

            {location && (
              <p className="text-xs text-[#6B7280]">
                Renaming does not change asset movements already recorded — they keep the name used at the time.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#c8181e] disabled:opacity-60"
              >
                {isPending ? "Saving…" : location ? "Save Changes" : "Add Location"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// Site Locations page body: the list, Add / Edit modal, Activate /
// Deactivate, and Delete (only offered for a location no movement used).
export function AssetLocationsManager({ rows }: { rows: AssetLocationRow[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ location: AssetLocationRow | null } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<AssetLocationActionState>, successText: string) {
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (result?.ok) {
        setNotice({ ok: true, text: successText });
        router.refresh();
      } else {
        setNotice({ ok: false, text: result?.error ?? "Something went wrong. Please try again." });
      }
      setConfirmDeleteId(null);
    });
  }

  const activeCount = rows.filter((r) => r.is_active).length;

  return (
    <div className="space-y-3 p-3 lg:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[#4B5563]">
          {rows.length} location{rows.length === 1 ? "" : "s"} · {activeCount} active · {rows.length - activeCount} inactive
        </p>
        <button
          type="button"
          onClick={() => setModal({ location: null })}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white hover:bg-[#c8181e]"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add Location
        </button>
      </div>

      {notice && (
        <p
          role={notice.ok ? "status" : "alert"}
          className={`rounded-md border px-4 py-2.5 text-sm font-semibold ${
            notice.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {notice.text}
        </p>
      )}

      <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <MapPin className="h-6 w-6 text-[#9CA3AF]" aria-hidden />
            </div>
            <p className="text-base font-bold text-[#111827]">No locations yet</p>
            <p className="max-w-sm text-sm text-[#4B5563]">
              Add the sites and projects assets are sent to. They appear in the Send to Site dropdown.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b-2 border-[#E5E7EB] bg-[#F3F4F6] text-xs font-bold uppercase tracking-wide text-[#4B5563]">
                <tr>
                  <th className="px-3 py-2.5">Location / Site Name</th>
                  <th className="px-3 py-2.5">Code</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Remarks</th>
                  <th className="px-3 py-2.5">Created / Updated</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {rows.map((row) => (
                  <tr key={row.id} className={row.is_active ? "" : "bg-gray-50/60"}>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-[#111827]">{row.name}</p>
                      {row.usage_count > 0 && (
                        <p className="text-xs text-[#6B7280]">
                          Used in {row.usage_count} movement{row.usage_count === 1 ? "" : "s"}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[#4B5563]">{row.code ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <StatusBadge label={row.is_active ? "Active" : "Inactive"} tone={row.is_active ? "green" : "gray"} />
                    </td>
                    <td className="max-w-[240px] px-3 py-2.5 text-xs text-[#4B5563]">{row.remarks ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[#4B5563]">
                      <p>{formatDate(row.created_at)}</p>
                      {row.updated_at.slice(0, 10) !== row.created_at.slice(0, 10) && (
                        <p className="text-[#6B7280]">Updated {formatDate(row.updated_at)}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {confirmDeleteId === row.id ? (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <span className="text-xs font-semibold text-[#111827]">Delete this location?</span>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => run(() => deleteAssetLocationAction(row.id), `Deleted "${row.name}".`)}
                            className="inline-flex min-h-[32px] items-center rounded-md bg-[#ED1C24] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#c8181e] disabled:opacity-50"
                          >
                            Yes, delete
                          </button>
                          <button type="button" disabled={isPending} onClick={() => setConfirmDeleteId(null)} className={rowBtn}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button type="button" disabled={isPending} onClick={() => setModal({ location: row })} className={rowBtn}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () => setAssetLocationActiveAction(row.id, !row.is_active),
                                row.is_active ? `Deactivated "${row.name}".` : `Activated "${row.name}".`
                              )
                            }
                            className={rowBtn}
                          >
                            {row.is_active ? "Deactivate" : "Activate"}
                          </button>
                          {/* Offered for every row; the server refuses a used
                              location and says to deactivate it instead. */}
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              setNotice(null);
                              setConfirmDeleteId(row.id);
                            }}
                            className={`${rowBtn} hover:border-[#ED1C24] hover:text-[#ED1C24]`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-[#6B7280]">
        Only active locations appear in the Send to Site dropdown. A location already used in an asset movement cannot be
        deleted — deactivate it instead; past movements keep showing its name.
      </p>

      {modal && (
        <LocationFormModal
          key={modal.location?.id ?? "new"}
          location={modal.location}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
