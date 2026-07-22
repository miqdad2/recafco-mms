"use client";

import { Eye, EyeOff, Plus, Save, X } from "lucide-react";
import { useEffect, useState } from "react";

import { createLocalUserAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_HELP } from "@/lib/users/account-types";

export function CreateUserDrawer({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [accountType, setAccountType] = useState<string>("maintenance_data_entry");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create User
      </Button>

      {/* Overlay — always in DOM so transition animates cleanly */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />

        {/* Drawer panel */}
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Create user account"
          className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-200 ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#ED1C24]">Admin action</p>
              <h2 className="text-lg font-black text-[#111827]">Create User Account</h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[#E5E7EB] text-[#4B5563] transition-colors hover:border-[#111827] hover:text-[#111827]"
              aria-label="Close drawer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable form body */}
          <form action={createLocalUserAction} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <p className="text-sm text-[#4B5563]">
                Create a login account for maintenance system users.
              </p>

              <label className="block">
                <span className="text-sm font-semibold">
                  Username / Email <span className="text-[#ED1C24]">*</span>
                </span>
                <input
                  className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  type="text"
                  name="email"
                  autoComplete="off"
                  placeholder="e.g. ahmed.ali or ahmed@recafco.com"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold">
                  Temporary password <span className="text-[#ED1C24]">*</span>
                </span>
                <div className="mt-1 flex gap-1.5">
                  <input
                    className="focus-ring w-full rounded-md border border-[#E5E7EB] px-3 py-2 font-mono text-sm tracking-wider"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#E5E7EB] text-[#4B5563] transition-colors hover:border-[#111827] hover:text-[#111827]"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => { setPassword("123"); setShowPassword(true); }}
                  className="mt-1.5 text-xs font-bold text-[#2563EB] hover:underline"
                >
                  Use temporary password 123
                </button>
                <p className="mt-1.5 text-xs text-[#4B5563]">
                  A simple temporary password like <span className="font-mono font-semibold">123</span> is fine — the
                  user will be asked to change this password on first login and cannot use the dashboard until they do.
                </p>
              </label>

              <label className="block">
                <span className="text-sm font-semibold">
                  Full name <span className="text-[#ED1C24]">*</span>
                </span>
                <input
                  className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  name="full_name"
                  required
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold">Employee number</span>
                  <input
                    className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="employee_number"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold">Phone</span>
                  <input
                    className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="phone"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-semibold">
                  Role / Access Type <span className="text-[#ED1C24]">*</span>
                </span>
                <select
                  className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  name="account_type"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.slug} value={t.slug}>{t.label}</option>
                  ))}
                </select>
                {ACCOUNT_TYPE_HELP[accountType] && (
                  <p className="mt-1.5 text-xs text-[#4B5563]">{ACCOUNT_TYPE_HELP[accountType]}</p>
                )}
              </label>

              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="is_active" defaultChecked className="rounded" />
                Active
              </label>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[#E5E7EB] px-5 py-4">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="gap-2">
                <Save className="h-4 w-4" aria-hidden="true" />
                Create User
              </Button>
            </div>
          </form>
        </aside>
      </div>
    </>
  );
}
