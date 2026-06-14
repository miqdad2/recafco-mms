import "server-only";

import { redirect } from "next/navigation";

import { hashSessionToken, getSessionToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import type { PermissionKey, RoleSlug } from "@/types/database";

type CurrentUserRow = {
  user_id: string;
  profile_id: string;
  email: string;
  full_name: string;
  employee_number: string | null;
  phone: string | null;
  job_title: string | null;
  department_id: string | null;
  role_id: string | null;
  is_active: boolean;
  can_view_costs: boolean;
  must_reset_password: boolean;
  department_name: string | null;
  department_code: string | null;
  role_name: string | null;
  role_slug: string | null;
};

type PermissionRow = {
  key: string;
};

export type CurrentUserContext = {
  userId: string;
  authUserId: string;
  email: string | null;
  mustResetPassword: boolean;
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
  const token = await getSessionToken();
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const rows = await prisma.$queryRaw<CurrentUserRow[]>`
    select
      au.id as user_id,
      p.id as profile_id,
      au.email,
      au.must_reset_password,
      p.full_name,
      p.employee_number,
      p.phone,
      p.job_title,
      p.department_id,
      p.role_id,
      p.is_active,
      p.can_view_costs,
      d.name as department_name,
      d.code as department_code,
      r.name as role_name,
      r.slug as role_slug
    from public.auth_sessions s
    join public.auth_users au on au.id = s.user_id
    join public.profiles p on p.id = s.profile_id
    left join public.departments d on d.id = p.department_id
    left join public.roles r on r.id = p.role_id
    where s.session_token_hash = ${tokenHash}
      and s.revoked_at is null
      and s.expires_at > now()
    limit 1
  `;
  const row = rows[0];

  if (!row || !row.is_active) {
    return null;
  }

  const permissionRows = row.role_id
    ? await prisma.$queryRaw<PermissionRow[]>`
        select p.key
        from public.role_permissions rp
        join public.permissions p on p.id = rp.permission_id
        where rp.role_id = ${row.role_id}::uuid
      `
    : [];

  const permissionSet = new Set<PermissionKey>();
  permissionRows.forEach((permission) => {
    if (permission.key) permissionSet.add(permission.key as PermissionKey);
  });

  if (row.can_view_costs) {
    permissionSet.add("costs.view");
  }

  // Apply user-specific permission overrides.
  // Super Admin role always retains full access — overrides are never applied.
  // For all other roles:
  //   1. 'allow' overrides add permissions not granted by the role.
  //   2. 'deny' overrides remove permissions even if the role grants them.
  //   Deny is evaluated last so it always wins over both role and allow overrides.
  if (row.role_slug !== "super_admin") {
    type OverrideRow = { permission_key: string; override_type: string };
    const overrides = await prisma.$queryRaw<OverrideRow[]>`
      select permission_key, override_type
      from public.user_permission_overrides
      where profile_id = ${row.profile_id}::uuid
    `;

    for (const o of overrides) {
      if (o.override_type === "allow") permissionSet.add(o.permission_key as PermissionKey);
    }
    for (const o of overrides) {
      if (o.override_type === "deny") permissionSet.delete(o.permission_key as PermissionKey);
    }
  }

  return {
    userId: row.profile_id,
    authUserId: row.user_id,
    email: row.email,
    mustResetPassword: Boolean(row.must_reset_password),
    profile: {
      id: row.profile_id,
      full_name: row.full_name,
      employee_number: row.employee_number,
      phone: row.phone,
      job_title: row.job_title,
      department_id: row.department_id,
      role_id: row.role_id,
      is_active: row.is_active,
      can_view_costs: row.can_view_costs
    },
    department:
      row.department_id && row.department_name && row.department_code
        ? {
            id: row.department_id,
            name: row.department_name,
            code: row.department_code
          }
        : null,
    role:
      row.role_id && row.role_name && row.role_slug
        ? {
            id: row.role_id,
            name: row.role_name,
            slug: row.role_slug as RoleSlug
          }
        : null,
    permissions: [...permissionSet]
  };
}

export async function requireUser(opts?: { skipPasswordChangeCheck?: boolean }) {
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!opts?.skipPasswordChangeCheck && context.mustResetPassword) {
    redirect("/change-password");
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
