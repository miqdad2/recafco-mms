import { AlertTriangle, RotateCcw, Save, Settings } from "lucide-react";
import Link from "next/link";

import { createLocalUserAction, upsertProfileAction } from "@/app/actions/admin";
import { restoreUserAction } from "@/app/actions/user-access";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

type AuthUserSummary = {
  profile_id: string;
  email: string;
  must_reset_password: boolean;
  locked_until: Date | null;
};

const AVATAR_COLORS = [
  "bg-[#ED1C24]",
  "bg-[#2563EB]",
  "bg-[#16A34A]",
  "bg-[#7C3AED]",
  "bg-[#D97706]",
  "bg-[#0891B2]",
  "bg-[#DB2777]",
  "bg-[#374151]",
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
    <span
      className={`flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-md text-[13px] font-black text-white ${bg}`}
    >
      {initials}
    </span>
  );
}

function inferRoleSlug(email: string) {
  const value = email.toLowerCase();
  if (value.includes("maintenancemanager")) return "maintenance_manager";
  if (value.includes("maintenancedataentry") || value.includes("dataentry")) return "maintenance_data_entry";
  if (value.includes("superadmin")) return "super_admin";
  if (value.includes("supervisor")) return "maintenance_supervisor";
  if (value.includes("technician") || value.includes("mechanic")) return "technician";
  if (value.includes("store")) return "store_keeper";
  if (value.includes("purchase")) return "purchase_officer";
  if (value.includes("finance")) return "finance_manager";
  if (value.includes("ceo") || value.includes("management")) return "ceo_management";
  if (value.includes("itadmin")) return "it_admin";
  return "";
}

function inferDepartmentCode(email: string) {
  const value = email.toLowerCase();
  if (value.includes("store")) return "STORE";
  if (value.includes("purchase")) return "PUR";
  if (value.includes("finance")) return "FIN";
  if (value.includes("ceo") || value.includes("management")) return "CEO";
  if (value.includes("itadmin") || value.includes("superadmin")) return "IT";
  return "MD";
}

async function getAuthUsers() {
  try {
    const rows = await prisma.auth_users.findMany({
      select: {
        profile_id: true,
        email: true,
        must_reset_password: true,
        locked_until: true
      }
    });
    return { users: rows as AuthUserSummary[], available: true };
  } catch {
    return { users: [] as AuthUserSummary[], available: false };
  }
}

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("admin.users.manage");
  const sp = (await searchParams) ?? {};
  const view = sp.view ?? "all";
  const isSuperAdmin = context.role?.slug === "super_admin";

  // Fetch non-archived profiles (always needed for stats) and department/role lists in parallel.
  const [nonArchivedProfiles, archivedCount, departments, roles] =
    await Promise.all([
      prisma.profiles.findMany({ where: { deleted_at: null }, orderBy: { full_name: "asc" } }),
      prisma.profiles.count({ where: { deleted_at: { not: null } } }),
      prisma.departments.findMany({
        where: { is_active: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" }
      }),
      prisma.roles.findMany({
        select: { id: true, name: true, slug: true },
        orderBy: { name: "asc" }
      })
    ]);

  // Only fetch archived profiles when the archived view is requested.
  let archivedProfiles: typeof nonArchivedProfiles = [];
  if (view === "archived") {
    archivedProfiles = await prisma.profiles.findMany({
      where: { deleted_at: { not: null } },
      orderBy: { full_name: "asc" }
    });
  }

  const authUsers = await getAuthUsers();

  // Table always uses the view-filtered list; stats always use non-archived.
  const allProfiles = view === "archived" ? archivedProfiles : nonArchivedProfiles;

  const departmentName = new Map(departments?.map((d) => [d.id, d.name]));
  const authByProfileId = new Map(authUsers.users.map((u) => [u.profile_id, u]));
  const roleIdBySlug = new Map(roles?.map((r) => [r.slug, r.id]));
  const departmentIdByCode = new Map(departments?.map((d) => [d.code, d.id]));

  // Stats — always from non-archived totals.
  const totalCount = nonArchivedProfiles.length;
  const activeCount = nonArchivedProfiles.filter((p) => p.is_active).length;
  const noRoleCount = nonArchivedProfiles.filter((p) => !p.role_id).length;
  const noLoginCount = nonArchivedProfiles.filter((p) => !authByProfileId.has(p.id)).length;
  const mustResetCount = authUsers.users.filter((u) => u.must_reset_password).length;
  const unlinkedAuthUsers: AuthUserSummary[] = [];

  return (
    <>
      <PageHeader
        title="Users and Profiles"
        description="Create login accounts and manage RECAFCO roles, departments, access status, and cost visibility."
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-4 sm:grid-cols-5 xl:px-6">
        <div className="rounded-md border border-[#DDE2EA] bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#4B5563]">Total profiles</p>
          <p className="mt-1.5 text-3xl font-black text-[#111827]">{totalCount}</p>
        </div>
        <div className="rounded-md border border-green-200 bg-green-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-green-700">Active</p>
          <p className="mt-1.5 text-3xl font-black text-[#111827]">{activeCount}</p>
        </div>
        <div
          className={`rounded-md border p-4 shadow-sm ${
            noRoleCount > 0 ? "border-amber-200 bg-amber-50" : "border-[#DDE2EA] bg-white"
          }`}
        >
          <p
            className={`text-[10px] font-black uppercase tracking-widest ${
              noRoleCount > 0 ? "text-amber-700" : "text-[#4B5563]"
            }`}
          >
            No role assigned
          </p>
          <p className="mt-1.5 text-3xl font-black text-[#111827]">{noRoleCount}</p>
        </div>
        <div
          className={`rounded-md border p-4 shadow-sm ${
            noLoginCount > 0 ? "border-blue-200 bg-blue-50" : "border-[#DDE2EA] bg-white"
          }`}
        >
          <p
            className={`text-[10px] font-black uppercase tracking-widest ${
              noLoginCount > 0 ? "text-blue-700" : "text-[#4B5563]"
            }`}
          >
            No login account
          </p>
          <p className="mt-1.5 text-3xl font-black text-[#111827]">{noLoginCount}</p>
        </div>
        <div
          className={`rounded-md border p-4 shadow-sm ${
            mustResetCount > 0 ? "border-orange-200 bg-orange-50" : "border-[#DDE2EA] bg-white"
          }`}
        >
          <p
            className={`text-[10px] font-black uppercase tracking-widest ${
              mustResetCount > 0 ? "text-orange-700" : "text-[#4B5563]"
            }`}
          >
            Must reset password
          </p>
          <p className="mt-1.5 text-3xl font-black text-[#111827]">{mustResetCount}</p>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid gap-6 p-4 xl:grid-cols-[380px_1fr] xl:p-6">

        {/* Create user form */}
        <form
          action={createLocalUserAction}
          className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm xl:sticky xl:top-24 xl:self-start"
        >
          <div className="border-b border-[#DDE2EA] bg-[#FAFAFA] px-5 py-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#ED1C24]">Admin action</p>
            <h2 className="mt-0.5 text-lg font-black text-[#111827]">Create User Account</h2>
            <p className="mt-1 text-sm text-[#4B5563]">
              Creates the login account and RECAFCO profile together. Password stored as a bcrypt hash.
            </p>
          </div>
          <div className="space-y-4 p-5">
            <label className="block">
              <span className="text-sm font-semibold">
                Email <span className="text-[#ED1C24]">*</span>
              </span>
              <input
                className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                type="email"
                name="email"
                autoComplete="off"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">
                Temporary password <span className="text-[#ED1C24]">*</span>
              </span>
              <input
                className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 font-mono text-sm tracking-wider"
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={6}
                required
              />
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
              <span className="text-sm font-semibold">Job title</span>
              <input
                className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                name="job_title"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Department</span>
              <select
                className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                name="department_id"
                defaultValue=""
              >
                <option value="">No department</option>
                {departments?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Role</span>
              <select
                className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                name="role_id"
                defaultValue=""
              >
                <option value="">No role</option>
                {roles?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="is_active" defaultChecked className="rounded" /> Active
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="can_view_costs" className="rounded" /> Can view costs
              </label>
            </div>
          </div>
          <div className="border-t border-[#DDE2EA] px-5 py-4">
            <Button type="submit" className="w-full gap-2">
              <Save className="h-4 w-4" aria-hidden="true" />
              Create user
            </Button>
          </div>
        </form>

        {/* Right column */}
        <div className="min-w-0 space-y-6">

          {/* Profile directory */}
          <section className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
            <div className="border-b border-[#DDE2EA] px-5 py-4">
              <h2 className="text-lg font-black text-[#111827]">Profile Directory</h2>
              <p className="mt-0.5 text-sm text-[#4B5563]">
                Every active RECAFCO user must have a role assigned. Login email is shown when a local account exists.
              </p>

              {/* View filter tabs */}
              <div className="mt-3 flex gap-1 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-1 w-fit">
                <Link
                  href="/admin/users"
                  className={`rounded px-3 py-1 text-xs font-black transition-colors ${
                    view !== "archived"
                      ? "bg-white text-[#111827] shadow-sm"
                      : "text-[#6B7280] hover:text-[#111827]"
                  }`}
                >
                  Active &amp; Deactivated ({totalCount})
                </Link>
                <Link
                  href="/admin/users?view=archived"
                  className={`rounded px-3 py-1 text-xs font-black transition-colors ${
                    view === "archived"
                      ? "bg-white text-[#111827] shadow-sm"
                      : archivedCount > 0
                        ? "text-amber-700 hover:text-amber-900"
                        : "text-[#6B7280] hover:text-[#111827]"
                  }`}
                >
                  Archived ({archivedCount})
                </Link>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#DDE2EA] bg-[#F8FAFC]">
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
                      User
                    </th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
                      Login
                    </th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
                      Role
                    </th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
                      Department
                    </th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
                      Status
                    </th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#4B5563]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6]">
                  {allProfiles.map((profile) => {
                    const isArchived = profile.deleted_at !== null;
                    return (
                      <tr
                        key={profile.id}
                        className={`transition-colors hover:bg-[#F8FAFC] ${isArchived ? "opacity-70" : ""}`}
                      >
                        {/* User */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <UserAvatar name={profile.full_name} />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-[#111827]">{profile.full_name}</p>
                              <p className="truncate text-xs text-[#9CA3AF]">
                                {profile.employee_number ?? "No employee ID"}
                                {profile.job_title ? ` · ${profile.job_title}` : ""}
                              </p>
                              {!profile.role_id && profile.is_active && !isArchived && (
                                <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#DC2626]">
                                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                  Role required
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Login */}
                        <td className="px-4 py-3">
                          {authByProfileId.has(profile.id) ? (
                            <div className="space-y-1">
                              <span className="text-sm text-[#111827]">{authByProfileId.get(profile.id)!.email}</span>
                              {authByProfileId.get(profile.id)!.must_reset_password && (
                                <div>
                                  <StatusBadge label="Must reset password" tone="amber" />
                                </div>
                              )}
                            </div>
                          ) : (
                            <StatusBadge label="No account" tone="gray" />
                          )}
                        </td>

                        {/* Role — inline selector (non-archived only) */}
                        <td className="px-4 py-3">
                          {isArchived ? (
                            <span className="text-xs text-[#9CA3AF]">
                              {roles?.find((r) => r.id === profile.role_id)?.name ?? "No role"}
                            </span>
                          ) : (
                            <form action={upsertProfileAction} className="flex items-center gap-1.5">
                              <input type="hidden" name="id" value={profile.id} />
                              <input type="hidden" name="full_name" value={profile.full_name} />
                              <input type="hidden" name="employee_number" value={profile.employee_number ?? ""} />
                              <input type="hidden" name="phone" value={profile.phone ?? ""} />
                              <input type="hidden" name="job_title" value={profile.job_title ?? ""} />
                              <input type="hidden" name="department_id" value={profile.department_id ?? ""} />
                              <input type="hidden" name="is_active" value={profile.is_active ? "true" : "false"} />
                              <input type="hidden" name="can_view_costs" value={profile.can_view_costs ? "true" : "false"} />
                              <select
                                className="focus-ring w-full min-w-[9rem] rounded-md border border-[#E5E7EB] px-2 py-1.5 text-xs text-[#111827]"
                                name="role_id"
                                defaultValue={profile.role_id ?? ""}
                                aria-label={`Role for ${profile.full_name}`}
                              >
                                <option value="">No role</option>
                                {roles?.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                className="focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#4B5563] transition-colors hover:border-[#ED1C24] hover:text-[#ED1C24]"
                                title={`Save role for ${profile.full_name}`}
                              >
                                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </form>
                          )}
                        </td>

                        {/* Department */}
                        <td className="px-4 py-3 text-sm">
                          {profile.department_id ? (
                            <span className="text-[#4B5563]">
                              {departmentName.get(profile.department_id) ?? "Unknown"}
                            </span>
                          ) : (
                            <span className="text-[#9CA3AF]">—</span>
                          )}
                        </td>

                        {/* Status badges */}
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {isArchived ? (
                              <StatusBadge label="Archived" tone="gray" />
                            ) : (
                              <StatusBadge
                                label={profile.is_active ? "Active" : "Inactive"}
                                tone={profile.is_active ? "green" : "gray"}
                              />
                            )}
                            {!isArchived && profile.can_view_costs && (
                              <StatusBadge label="Costs" tone="blue" />
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          {isArchived && isSuperAdmin ? (
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
              {allProfiles.length === 0 && (
                <p className="p-8 text-center text-sm text-[#4B5563]">
                  {view === "archived"
                    ? "No archived users."
                    : "No profiles yet. Create the first user using the form on the left."}
                </p>
              )}
            </div>
          </section>

          {/* Local login accounts (only shown in non-archived view) */}
          {view !== "archived" && (
            <section className="overflow-hidden rounded-md border border-[#DDE2EA] bg-white shadow-sm">
              <div className="border-b border-[#DDE2EA] px-5 py-4">
                <h2 className="text-lg font-black text-[#111827]">Profiles Without Login Accounts</h2>
                <p className="mt-0.5 text-sm text-[#4B5563]">
                  Profiles that have no entry in{" "}
                  <code className="rounded bg-[#F3F5F8] px-1 py-0.5 font-mono text-xs">auth_users</code>
                  {" "}and cannot log in. Use <strong>Create User Account</strong> above to add login credentials.
                </p>
              </div>
              {!authUsers.available ? (
                <p className="p-5 text-sm text-[#4B5563]">
                  Local auth lookup unavailable. Check{" "}
                  <code className="font-mono text-xs">DATABASE_URL</code> on the server.
                </p>
              ) : unlinkedAuthUsers.length ? (
                <div className="divide-y divide-[#EEF2F6]">
                  {unlinkedAuthUsers.map((user) => {
                    const suggestedDepartment = departmentIdByCode.get(inferDepartmentCode(user.email)) ?? "";
                    const suggestedRole = roleIdBySlug.get(inferRoleSlug(user.email)) ?? "";
                    return (
                      <form
                        key={user.profile_id}
                        action={upsertProfileAction}
                        className="grid gap-3 p-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto] lg:items-end"
                      >
                        <input type="hidden" name="id" value={user.profile_id} />
                        <input type="hidden" name="is_active" value="true" />
                        <div>
                          <p className="font-semibold text-[#111827]">{user.email}</p>
                          <p className="mt-0.5 font-mono text-xs text-[#9CA3AF]">{user.profile_id}</p>
                        </div>
                        <label className="block">
                          <span className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Full name</span>
                          <input
                            className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                            name="full_name"
                            defaultValue={user.email.split("@")[0] ?? ""}
                            required
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Department</span>
                          <select
                            className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                            name="department_id"
                            defaultValue={suggestedDepartment}
                          >
                            <option value="">No department</option>
                            {departments?.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-xs font-bold uppercase tracking-wide text-[#4B5563]">Role</span>
                          <select
                            className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                            name="role_id"
                            defaultValue={suggestedRole}
                            required
                          >
                            <option value="">Select role</option>
                            {roles?.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Button type="submit">Create profile</Button>
                      </form>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-3 p-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-green-50 text-lg text-green-600">
                    ✓
                  </span>
                  <p className="text-sm text-[#4B5563]">All local login accounts are linked to profiles.</p>
                </div>
              )}
            </section>
          )}

        </div>
      </div>
    </>
  );
}
