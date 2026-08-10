"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { setWorkerProfileActiveAction } from "@/app/actions/workers";
import { WorkerProfileFormModal } from "@/components/admin/worker-profile-form-modal";
import type { WorkerProfileRow } from "@/lib/backend/workers/service";
import { WORKER_TYPES } from "@/lib/backend/workers/constants";

type TypeFilter = "all" | (typeof WORKER_TYPES)[number];
type StatusFilter = "active" | "inactive" | "all";

export function WorkerProfilesView({
  workers,
  canViewCosts,
  canManageWorkerProfiles,
}: {
  workers: WorkerProfileRow[];
  // Worker Rate Visibility and Data Entry Lockdown Unit 10F.4, Task 1: hides
  // the Hourly Rate column entirely for anyone without cost visibility
  // (Data Entry), rather than a "Not visible" placeholder — the preferred
  // option per the task.
  canViewCosts: boolean;
  // Task 2: hides Edit/Deactivate/Reactivate — Add Worker stays visible for
  // everyone, since Data Entry can still create a profile.
  canManageWorkerProfiles: boolean;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [modalWorker, setModalWorker] = useState<WorkerProfileRow | "new" | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workers.filter((w) => {
      if (typeFilter !== "all" && w.worker_type !== typeFilter) return false;
      if (statusFilter === "active" && !w.is_active) return false;
      if (statusFilter === "inactive" && w.is_active) return false;
      // Worker Profile Form Simplification and Division Rename Unit 10G.6,
      // Task 6: search also matches Employee ID and Division (skill_category).
      if (
        q &&
        !w.name.toLowerCase().includes(q) &&
        !(w.employee_id ?? "").toLowerCase().includes(q) &&
        !(w.skill_category ?? "").toLowerCase().includes(q) &&
        !(w.phone ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [workers, search, typeFilter, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Employee ID, name, or division…"
              className="focus-ring w-64 rounded-md border border-[#E5E7EB] bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <FilterChips
            value={typeFilter}
            onChange={setTypeFilter}
            options={[{ value: "all", label: "All Types" }, ...WORKER_TYPES.map((t) => ({ value: t, label: t }))]}
          />
          <FilterChips
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
              { value: "all", label: "All" },
            ]}
          />
        </div>
        <button
          type="button"
          onClick={() => setModalWorker("new")}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-2 text-sm font-bold text-white transition hover:bg-red-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add Worker
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-[#E5E7EB] bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
            {/* Worker Profile Form Simplification and Division Rename Unit
                10G.6, Task 5: Employee ID column added; Phone/Notes dropped
                from the list entirely for every role (Option A — still
                available via the Manager-only Edit form); "Skill Category"
                relabeled "Division"; the whole Actions column (Edit/
                Deactivate) is now omitted for Data Entry rather than shown
                with a placeholder dash. */}
            <tr>
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Worker Type</th>
              <th className="px-4 py-3">Division</th>
              {canViewCosts && <th className="px-4 py-3">Hourly Rate (KWD)</th>}
              <th className="px-4 py-3">Status</th>
              {canManageWorkerProfiles && <th className="px-4 py-3">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={4 + (canViewCosts ? 1 : 0) + 1 + (canManageWorkerProfiles ? 1 : 0)}
                  className="px-4 py-6 text-center text-[#9CA3AF]"
                >
                  No workers match your search/filters.
                </td>
              </tr>
            ) : (
              filtered.map((w) => (
                <tr key={w.id}>
                  <td className="px-4 py-3 text-[#4B5563]">{w.employee_id ?? "—"}</td>
                  <td className="px-4 py-3 font-semibold text-[#111827]">{w.name}</td>
                  <td className="px-4 py-3">{w.worker_type}</td>
                  <td className="px-4 py-3">{w.skill_category ?? "-"}</td>
                  {canViewCosts && <td className="px-4 py-3">{w.hourly_rate.toFixed(3)}</td>}
                  <td className="px-4 py-3">
                    <StatusBadge label={w.is_active ? "Active" : "Inactive"} tone={w.is_active ? "green" : "gray"} />
                  </td>
                  {canManageWorkerProfiles && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setModalWorker(w)}
                          className="rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#4B5563] hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        <form action={setWorkerProfileActiveAction}>
                          <input type="hidden" name="id" value={w.id} />
                          <input type="hidden" name="is_active" value={w.is_active ? "false" : "true"} />
                          <button
                            type="submit"
                            className="rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#4B5563] hover:bg-gray-50"
                          >
                            {w.is_active ? "Deactivate" : "Reactivate"}
                          </button>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalWorker && (
        <WorkerProfileFormModal
          worker={modalWorker === "new" ? null : modalWorker}
          canViewCosts={canViewCosts}
          onClose={() => setModalWorker(null)}
        />
      )}
    </div>
  );
}

function FilterChips<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
            value === o.value
              ? "border-[#111827] bg-[#111827] text-white"
              : "border-[#E5E7EB] bg-white text-[#4B5563] hover:border-[#111827]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
