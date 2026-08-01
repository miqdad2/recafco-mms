"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { deleteUserAction } from "@/app/actions/user-access";
import { Button } from "@/components/ui/button";

const CONFIRM_WORD = "DELETE";

type DeleteUserDialogProps = {
  profileId: string;
  fullName: string;
  email: string;
  roleLabel: string;
  statusLabel: string;
  lastLoginLabel: string;
  loginCount: number;
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs font-semibold text-[#4B5563]">{label}</span>
      <span className="text-right text-xs font-bold text-[#111827]">{value}</span>
    </div>
  );
}

export function DeleteUserDialog({
  profileId,
  fullName,
  email,
  roleLabel,
  statusLabel,
  lastLoginLabel,
  loginCount
}: DeleteUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const canDelete = confirmText === CONFIRM_WORD;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setConfirmText("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring flex w-full items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-left transition-colors hover:border-red-400"
      >
        <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
        <div>
          <p className="text-sm font-black text-red-900">Delete User</p>
          <p className="mt-0.5 text-xs text-[#4B5563]">Delete this user account permanently.</p>
        </div>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={close} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-user-heading"
              className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                  <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
                </span>
                <div>
                  <h3 id="delete-user-heading" className="text-lg font-black text-[#111827]">
                    Delete User?
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-[#4B5563]">
                    This will permanently delete the user account. This action cannot be undone.
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-0.5 divide-y divide-[#F3F4F6] rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-1">
                <SummaryRow label="Name" value={fullName} />
                <SummaryRow label="Email / Login" value={email} />
                <SummaryRow label="Role" value={roleLabel} />
                <SummaryRow label="Status" value={statusLabel} />
                <SummaryRow label="Last Login" value={lastLoginLabel} />
                <SummaryRow label="Login Count" value={String(loginCount)} />
              </div>

              <form action={deleteUserAction} className="mt-4">
                <input type="hidden" name="profile_id" value={profileId} />
                <label className="block">
                  <span className="text-xs font-bold uppercase text-[#4B5563]">
                    Type {CONFIRM_WORD} to confirm
                  </span>
                  <input
                    className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 font-mono text-sm tracking-wider"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={CONFIRM_WORD}
                    autoComplete="off"
                    autoFocus
                  />
                </label>

                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
                  <Button type="button" variant="secondary" className="flex-1" onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="danger"
                    className="flex-1 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#DC2626]"
                    disabled={!canDelete}
                  >
                    Delete User
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
}
