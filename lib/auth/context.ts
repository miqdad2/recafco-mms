import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PermissionKey, RoleSlug } from "@/types/database";

type RolePermissionRow = {
  permissions: {
    key: PermissionKey;
  } | null;
};

export type CurrentUserContext = {
  userId: string;
  email: string | null;
  profile: {
    id: string;
    full_name: string;
    employee_number: string | null;
    phone: string | null;
    job_title: string | null;
    department_id: string | null;
    role_id: string | null;
    is_active: boolean;
    can_view_costs: boolean;
  };
  department: {
    id: string;
    name: string;
    code: string;
  } | null;
  role: {
    id: string;
    name: string;
    slug: RoleSlug;
  } | null;
  permissions: PermissionKey[];
};

export async function getCurrentUserContext(): Promise<CurrentUserContext | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      `
      id,
      full_name,
      employee_number,
      phone,
      job_title,
      department_id,
      role_id,
      is_active,
      can_view_costs,
      departments(id, name, code),
      roles(id, name, slug)
    `
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    return null;
  }

  const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
  const department = Array.isArray(profile.departments) ? profile.departments[0] : profile.departments;

  const { data: rolePermissions } = role
    ? await supabase
        .from("role_permissions")
        .select("permissions(key)")
        .eq("role_id", role.id)
        .returns<RolePermissionRow[]>()
    : { data: [] };

  const permissionSet = new Set<PermissionKey>();
  rolePermissions?.forEach((row) => {
    if (row.permissions?.key) {
      permissionSet.add(row.permissions.key);
    }
  });

  if (profile.can_view_costs) {
    permissionSet.add("costs.view");
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: {
      id: profile.id,
      full_name: profile.full_name,
      employee_number: profile.employee_number,
      phone: profile.phone,
      job_title: profile.job_title,
      department_id: profile.department_id,
      role_id: profile.role_id,
      is_active: profile.is_active,
      can_view_costs: profile.can_view_costs
    },
    department,
    role: role
      ? {
          id: role.id,
          name: role.name,
          slug: role.slug as RoleSlug
        }
      : null,
    permissions: [...permissionSet]
  };
}

export async function requireUser() {
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  return context;
}

export async function requirePermission(permission: PermissionKey) {
  const context = await requireUser();

  if (!context.permissions.includes(permission) && context.role?.slug !== "super_admin") {
    redirect("/dashboard?error=permission-denied");
  }

  return context;
}
