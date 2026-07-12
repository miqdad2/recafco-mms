"use client";

import { RotateCcw, Save, Search, Settings } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { upsertProfileAction as upsertProfileFromAdmin } from "@/app/actions/admin";
import { restoreUserAction } from "@/app/actions/user-access";
import { StatusBadge } from "@/components/ui/status-badge";

export type SerializedProfile = {
  id: string;
  full_name: string;
  employee_number: string | null;
  phone: string | null;
  job_title: string | null;
  department_id: string | null;
  can_view_costs: boolean;
  is_active: boolean;
  role_id: string | null;
  is_archived: boolean;
};

export type SerializedAuthUser = {
  profile_id: string;
  email: string;
  must_reset_password: boolean;
};

type StatusFilter = "all" | "active" | "inactive";

const ROLE_LABEL: Record<string, string> = {
  maintenance_data_entry: "Maintenance Data Entry",
  maintenance_manager:    "Maintenance Manager",
  technician:             "Technician",
  store_keeper:           "Store / Spare Parts User",
  super_admin:            "System Administrator",
  viewer_auditor:         "Viewer / Auditor",
};

const AVATAR_COLORS = [
  "bg-[#ED1C24]", "bg-[#2563EB]", "bg-[#16A34A]", "bg-[#7C3AED]",
  "bg-[#D97706]", "bg-[#0891B2]", "bg-[#DB2777]", "bg-[#374151]",
];

function UserAvatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const initials = (
    parts.length >= 2
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`
      : (parts[0]?.slice(0, 2) ?? "?")
  ).toUpperCase();
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  const bg = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return (
    <span className={`flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-md text-[13px] font-black text-white ${bg}`}>
      {initials}
    </span>
  );
}

export function UsersDirectory({
  profiles,
  authUsers,
  roles,
  isSuperAdmin,
}: {
  profiles: SerializedProfile[];
  authUsers: SerializedAuthUser[];
  roles: Array<{ id: string; slug: string }>;
  isSuperAdmin: boolean;
}) {
  const roleById = useMemo(
    () => new Map(roles.map((r) => [r.id, r.slug])),
    [roles]
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const authMap = useMemo(
    () => new Map(authUsers.map((u) => [u.profile_id, u])),
    [authUsers]
  );

  const filtered = useMemo(() => {
    return profiles.filter((p) => {
      if (statusFilter === "active" && !p.is_active) return false;
      if (statusFilter === "inactive" && p.is_active) return false;
      if (search) {
        const q = search.toLowerCase();
        const email = authMap.get(p.id)?.email ?? "";
        if (
          !p.full_name.toLowerCase().includes(q) &&
          !email.toLowerCase().includes(q) &&
          !(p.employee_number ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [profiles, search, statusFilter, authMap]);

  return (
    <section className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
      {/* Section header + toolbar */}
      <div className="border-b border-[#DDE2EA] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-[#111827]">User Directory</h2>
            <p className="mt-0.5 text-sm text-[#4B5563]">Manage user account type and access status.</p>
          </div>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="flex min-w-[180px] items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent text-sm outline-none placeholder:text-[#9CA3AF]"
                aria-label="Search users"
              />
            </div>
            {/* Status filter toggle */}
            <div className="flex overflow-hidden rounded-md border border-[#E5E7EB] text-xs font-semibold">
              {(["all", "active", "inactive"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 capitalize transition-colors ${
                    statusFilter === s
                      ? "bg-[#111827] text-white"
                      : "bg-white text-[#4B5563] hover:bg-[#F8FAFC]"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="text-xs text-[#9CA3AF]">
              {filtered.length} {filtered.length === 1 ? "user" : "users"}
            </span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-[#DDE2EA] bg-[#F8FAFC]">
              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">User</th>
              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">Login</th>
              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">Account Type</th>
              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">Status</th>
              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF2F6]">
            {filtered.map((profile) => {
              const auth = authMap.get(profile.id);
              return (
                <tr
                  key={profile.id}
                  className={`transition-colors hover:bg-[#F8FAFC] ${profile.is_archived ? "opacity-70" : ""}`}
                >
                  {/* User */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={profile.full_name} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[#111827]">{profile.full_name}</p>
                        {profile.employee_number && (
                          <p className="truncate text-xs text-[#9CA3AF]">{profile.employee_number}</p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Login */}
                  <td className="px-4 py-3">
                    {auth ? (
                      <div className="space-y-1">
                        <span className="text-sm text-[#111827]">{auth.email}</span>
                        {auth.must_reset_password && (
                          <div>
                            <StatusBadge label="Must reset password" tone="amber" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <StatusBadge label="No account" tone="gray" />
                    )}
                  </td>

                  {/* Account Type — inline selector */}
                  <td className="px-4 py-3">
                    {profile.is_archived ? (
                      <span className="text-xs text-[#9CA3AF]">
                        {ROLE_LABEL[roleById.get(profile.role_id ?? "") ?? ""] ?? "Unknown"}
                      </span>
                    ) : (
                      <form action={upsertProfileFromAdmin} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={profile.id} />
                        <input type="hidden" name="full_name" value={profile.full_name} />
                        <input type="hidden" name="employee_number" value={profile.employee_number ?? ""} />
                        <input type="hidden" name="phone" value={profile.phone ?? ""} />
                        <input type="hidden" name="job_title" value={profile.job_title ?? ""} />
                        <input type="hidden" name="department_id" value={profile.department_id ?? ""} />
                        <input type="hidden" name="is_active" value={profile.is_active ? "true" : "false"} />
                        <input type="hidden" name="can_view_costs" value={profile.can_view_costs ? "true" : "false"} />
                        <select
                          className="focus-ring w-full min-w-[11rem] rounded-md border border-[#E5E7EB] px-2 py-1.5 text-xs text-[#111827]"
                          name="role_id"
                          defaultValue={profile.role_id ?? ""}
                          aria-label={`Account type for ${profile.full_name}`}
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {ROLE_LABEL[r.slug] ?? r.slug}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#4B5563] transition-colors hover:border-[#ED1C24] hover:text-[#ED1C24]"
                          title={`Save account type for ${profile.full_name}`}
                        >
                          <Save className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </form>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    {profile.is_archived ? (
                      <StatusBadge label="Archived" tone="gray" />
                    ) : (
                      <StatusBadge
                        label={profile.is_active ? "Active" : "Inactive"}
                        tone={profile.is_active ? "green" : "gray"}
                      />
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    {profile.is_archived && isSuperAdmin ? (
                      <form action={restoreUserAction}>
                        <input type="hidden" name="profile_id" value={profile.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-bold text-[#111827] transition-colors hover:border-green-400 hover:text-green-700"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          Restore
                        </button>
                      </form>
                    ) : (
                      <Link
                        href={`/admin/users/${profile.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-bold text-[#111827] transition-colors hover:border-[#ED1C24] hover:text-[#ED1C24]"
                      >
                        <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                        Manage
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <p className="p-8 text-center text-sm text-[#4B5563]">
            {search || statusFilter !== "all"
              ? "No users match the current filter."
              : "No users yet. Use Create User to add the first account."}
          </p>
        )}
      </div>
    </section>
  );
}
