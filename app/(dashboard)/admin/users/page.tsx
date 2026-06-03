import { Save } from "lucide-react";

import { upsertProfileAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AuthUserSummary = {
  id: string;
  email: string;
};

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
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });

    if (error) {
      return { users: [] as AuthUserSummary[], available: false };
    }

    return {
      users: data.users.map((user) => ({ id: user.id, email: user.email ?? "No email" })),
      available: true
    };
  } catch {
    return { users: [] as AuthUserSummary[], available: false };
  }
}

export default async function UsersPage() {
  await requirePermission("admin.users.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: profiles }, { data: departments }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    supabase.from("departments").select("id, name, code").eq("is_active", true).order("name"),
    supabase.from("roles").select("id, name, slug").order("name")
  ]);
  const authUsers = await getAuthUsers();

  const departmentName = new Map(departments?.map((department) => [department.id, department.name]));
  const authEmail = new Map(authUsers.users.map((user) => [user.id, user.email]));
  const profileIds = new Set((profiles ?? []).map((profile) => profile.id));
  const unlinkedAuthUsers = authUsers.users.filter((user) => !profileIds.has(user.id));
  const roleIdBySlug = new Map(roles?.map((role) => [role.slug, role.id]));
  const departmentIdByCode = new Map(departments?.map((department) => [department.code, department.id]));

  return (
    <>
      <PageHeader
        title="Users and Profiles"
        description="Link system users to RECAFCO roles, departments, active status, and cost visibility."
      />
      <div className="grid gap-6 p-4 xl:grid-cols-[420px_1fr] xl:p-6">
        <form action={upsertProfileAction} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#111827]">Create or update profile</h2>
          <p className="mt-1 text-sm text-[#4B5563]">Create the login account first, then select the Auth account by email. This avoids linking the wrong UUID.</p>
          <div className="mt-4 space-y-4">
            {authUsers.available ? (
              <label className="block">
                <span className="text-sm font-semibold">Auth login account</span>
                <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="id" required defaultValue="">
                  <option value="">Select Auth email</option>
                  {authUsers.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email} - {user.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block">
                <span className="text-sm font-semibold">Auth user UUID</span>
                <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="id" required />
              </label>
            )}
            <label className="block">
              <span className="text-sm font-semibold">Full name</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="full_name" required />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold">Employee number</span>
                <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="employee_number" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold">Phone</span>
                <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="phone" />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-semibold">Job title</span>
              <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="job_title" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Department</span>
              <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="department_id" defaultValue="">
                <option value="">No department</option>
                {departments?.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Role</span>
              <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="role_id" defaultValue="">
                <option value="">No role</option>
                {roles?.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="is_active" defaultChecked /> Active
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="can_view_costs" /> Can view costs
              </label>
            </div>
            <Button type="submit" className="w-full">
              <Save className="h-4 w-4" aria-hidden="true" />
              Save profile
            </Button>
          </div>
        </form>

        <div className="space-y-6">
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] p-5">
            <h2 className="text-lg font-bold text-[#111827]">Profile directory</h2>
            <p className="mt-1 text-sm text-[#4B5563]">Active users must have a role. Email appears when the Auth user exists and service-role lookup is available.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Auth email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Costs</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {profiles?.map((profile) => (
                  <tr key={profile.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#111827]">{profile.full_name}</p>
                      <p className="text-xs text-[#4B5563]">{profile.id}</p>
                    </td>
                    <td className="px-4 py-3">{authEmail.get(profile.id) ?? (authUsers.available ? "No matching Auth user" : "Auth lookup unavailable")}</td>
                    <td className="px-4 py-3">
                      <form action={upsertProfileAction} className="flex min-w-64 items-center gap-2">
                        <input type="hidden" name="id" value={profile.id} />
                        <input type="hidden" name="full_name" value={profile.full_name} />
                        <input type="hidden" name="employee_number" value={profile.employee_number ?? ""} />
                        <input type="hidden" name="phone" value={profile.phone ?? ""} />
                        <input type="hidden" name="job_title" value={profile.job_title ?? ""} />
                        <input type="hidden" name="department_id" value={profile.department_id ?? ""} />
                        <input type="hidden" name="is_active" value={profile.is_active ? "true" : "false"} />
                        <input type="hidden" name="can_view_costs" value={profile.can_view_costs ? "true" : "false"} />
                        <select className="focus-ring w-full rounded-md border border-[#E5E7EB] px-2 py-1.5" name="role_id" defaultValue={profile.role_id ?? ""} aria-label={`Role for ${profile.full_name}`}>
                          <option value="">No role</option>
                          {roles?.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                        <button className="focus-ring rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs font-bold text-[#111827] hover:border-[#ED1C24] hover:text-[#ED1C24]" type="submit">
                          Save
                        </button>
                      </form>
                      {!profile.role_id && profile.is_active ? <p className="mt-1 text-xs font-semibold text-[#DC2626]">Role required for login access.</p> : null}
                    </td>
                    <td className="px-4 py-3">{profile.department_id ? departmentName.get(profile.department_id) ?? "Unknown department" : "Not assigned"}</td>
                    <td className="px-4 py-3">{profile.employee_number ?? "Not recorded"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge label={profile.can_view_costs ? "Allowed" : "Restricted"} tone={profile.can_view_costs ? "green" : "amber"} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge label={profile.is_active ? "Active" : "Inactive"} tone={profile.is_active ? "green" : "gray"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] p-5">
            <h2 className="text-lg font-bold text-[#111827]">Auth users without profiles</h2>
            <p className="mt-1 text-sm text-[#4B5563]">
              These login accounts exist in Supabase Auth but are not linked to a RECAFCO profile yet.
            </p>
          </div>
          {!authUsers.available ? (
            <p className="p-5 text-sm text-[#4B5563]">Auth lookup is unavailable. Check `SUPABASE_SERVICE_ROLE_KEY` on the server.</p>
          ) : unlinkedAuthUsers.length ? (
            <div className="divide-y divide-[#E5E7EB]">
              {unlinkedAuthUsers.map((user) => (
                <form key={user.id} action={upsertProfileAction} className="grid gap-3 p-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto] lg:items-end">
                  <input type="hidden" name="id" value={user.id} />
                  <input type="hidden" name="is_active" value="true" />
                  {(() => {
                    const suggestedDepartment = departmentIdByCode.get(inferDepartmentCode(user.email)) ?? "";
                    const suggestedRole = roleIdBySlug.get(inferRoleSlug(user.email)) ?? "";
                    return (
                      <>
                  <div>
                    <p className="font-semibold text-[#111827]">{user.email}</p>
                    <p className="text-xs text-[#4B5563]">{user.id}</p>
                  </div>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-[#4B5563]">Full name</span>
                    <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="full_name" defaultValue={user.email.split("@")[0] ?? ""} required />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-[#4B5563]">Department</span>
                    <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="department_id" defaultValue={suggestedDepartment}>
                      <option value="">No department</option>
                      {departments?.map((department) => (
                        <option key={department.id} value={department.id}>{department.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-[#4B5563]">Role</span>
                    <select className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" name="role_id" defaultValue={suggestedRole} required>
                      <option value="">Select role</option>
                      {roles?.map((role) => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit">Create profile</Button>
                      </>
                    );
                  })()}
                </form>
              ))}
            </div>
          ) : (
            <p className="p-5 text-sm text-[#4B5563]">All Auth users are linked to profiles.</p>
          )}
        </section>
        </div>
      </div>
    </>
  );
}
