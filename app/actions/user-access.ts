"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/lib/db/prisma";
import { notifyByEvent } from "@/lib/notifications/service";
import type { CurrentUserContext } from "@/lib/auth/context";

// ── Helpers ───────────────────────────────────────────────────────────────────

type RoleRow = { slug: string | null; name: string | null };

async function getTargetRoleSlug(profileId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<RoleRow[]>`
    select r.slug, r.name
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    where p.id = ${profileId}::uuid
    limit 1
  `;
  return rows[0]?.slug ?? null;
}

/** Only Super Admin may touch Super Admin accounts. Any other actor is blocked. */
async function assertCanModify(
  context: CurrentUserContext,
  targetProfileId: string,
  backUrl: string
) {
  if (context.role?.slug !== "super_admin") {
    const targetSlug = await getTargetRoleSlug(targetProfileId);
    if (targetSlug === "super_admin") {
      redirect(`${backUrl}?error=cannot-modify-super-admin`);
    }
  }
}

// ── Change role ───────────────────────────────────────────────────────────────

export async function changeUserRoleAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  const parsed = z
    .object({
      profile_id: z.string().uuid(),
      role_id: z
        .string()
        .uuid()
        .nullable()
        .or(z.literal(""))
        .transform((v) => v || null)
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { profile_id, role_id } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  // Safety: Super Admin cannot remove their own super_admin role.
  if (profile_id === context.userId) {
    const ownSlug = await getTargetRoleSlug(profile_id);
    if (ownSlug === "super_admin") {
      redirect(`${backUrl}?error=cannot-change-own-super-admin`);
    }
  }

  await assertCanModify(context, profile_id, backUrl);

  // Fetch the new role name for the audit log.
  const newRoleRows = role_id
    ? await prisma.$queryRaw<Array<{ slug: string; name: string }>>`
        select slug, name from public.roles where id = ${role_id}::uuid limit 1
      `
    : [];
  const newRole = newRoleRows[0] ?? null;

  await prisma.profiles.update({
    where: { id: profile_id },
    data: { role_id }
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "user.role_changed",
    entityType: "profile",
    entityId: profile_id,
    summary: `Role changed to "${newRole?.name ?? "none"}"`,
    metadata: { new_role_id: role_id, new_role_slug: newRole?.slug ?? null }
  });

  // Notify Super Admin and IT Admin of the role change.
  await notifyByEvent({
    eventKey: "user.role_changed",
    entityType: "profile",
    entityId: profile_id,
    actorId: context.userId,
    recipientRoles: ["super_admin", "it_admin"],
    metadata: { new_role: newRole?.name ?? "none" },
    actionUrl: backUrl,
    actionLabel: "View user"
  });

  revalidatePath(backUrl);
  revalidatePath("/admin/users");
  redirect(`${backUrl}?success=role-changed`);
}

// ── Change department ─────────────────────────────────────────────────────────

export async function changeUserDepartmentAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  const parsed = z
    .object({
      profile_id: z.string().uuid(),
      department_id: z
        .string()
        .uuid()
        .nullable()
        .or(z.literal(""))
        .transform((v) => v || null)
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { profile_id, department_id } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  await assertCanModify(context, profile_id, backUrl);

  const deptRows = department_id
    ? await prisma.$queryRaw<Array<{ name: string }>>`
        select name from public.departments where id = ${department_id}::uuid limit 1
      `
    : [];

  await prisma.profiles.update({
    where: { id: profile_id },
    data: { department_id }
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "user.department_changed",
    entityType: "profile",
    entityId: profile_id,
    summary: `Department changed to "${deptRows[0]?.name ?? "none"}"`,
    metadata: { new_department_id: department_id, new_department_name: deptRows[0]?.name ?? null }
  });

  revalidatePath(backUrl);
  revalidatePath("/admin/users");
  redirect(`${backUrl}?success=department-changed`);
}

// ── Activate / Deactivate ─────────────────────────────────────────────────────

export async function toggleUserActiveAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  const parsed = z
    .object({
      profile_id: z.string().uuid(),
      is_active: z.preprocess((v) => v === "true", z.boolean())
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { profile_id, is_active } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  // Safety: Cannot deactivate own account.
  if (profile_id === context.userId && !is_active) {
    redirect(`${backUrl}?error=cannot-deactivate-self`);
  }

  await assertCanModify(context, profile_id, backUrl);

  const target = await prisma.profiles.update({
    where: { id: profile_id },
    data: { is_active },
    select: { full_name: true }
  });

  // When deactivating, also revoke all sessions immediately.
  if (!is_active) {
    await prisma.auth_sessions.updateMany({
      where: { profile_id, revoked_at: null },
      data: { revoked_at: new Date() }
    });
  }

  await writeAuditLog({
    actorId: context.userId,
    action: is_active ? "user.activated" : "user.deactivated",
    entityType: "profile",
    entityId: profile_id,
    summary: `${is_active ? "Activated" : "Deactivated"} user account for ${target.full_name}`,
    metadata: { is_active, sessions_revoked_on_deactivate: !is_active }
  });

  revalidatePath(backUrl);
  revalidatePath("/admin/users");
  redirect(`${backUrl}?success=${is_active ? "activated" : "deactivated"}`);
}

// ── Unlock account ────────────────────────────────────────────────────────────

export async function unlockUserAccountAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  const parsed = z
    .object({ profile_id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { profile_id } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  await prisma.$executeRaw`
    update public.auth_users
    set locked_until = null,
        failed_login_count = 0
    where profile_id = ${profile_id}::uuid
  `;

  await writeAuditLog({
    actorId: context.userId,
    action: "user.unlocked",
    entityType: "profile",
    entityId: profile_id,
    summary: "Admin manually unlocked account and reset failed login counter",
    metadata: {}
  });

  await notifyByEvent({
    eventKey: "security.account_unlocked",
    entityType: "profile",
    entityId: profile_id,
    actorId: context.userId,
    recipientRoles: ["super_admin", "it_admin"],
    metadata: {},
    actionUrl: backUrl,
    actionLabel: "View user"
  });

  revalidatePath(backUrl);
  redirect(`${backUrl}?success=unlocked`);
}

// ── Revoke all user sessions ──────────────────────────────────────────────────

export async function revokeUserSessionsAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  const parsed = z
    .object({ profile_id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { profile_id } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  const result = await prisma.auth_sessions.updateMany({
    where: { profile_id, revoked_at: null },
    data: { revoked_at: new Date() }
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "user.sessions_revoked",
    entityType: "profile",
    entityId: profile_id,
    summary: `Revoked ${result.count} active session(s)`,
    metadata: { sessions_revoked: result.count }
  });

  await notifyByEvent({
    eventKey: "security.sessions_revoked",
    entityType: "profile",
    entityId: profile_id,
    actorId: context.userId,
    recipientRoles: ["super_admin", "it_admin"],
    metadata: { sessions_revoked: result.count },
    actionUrl: backUrl,
    actionLabel: "View user"
  });

  revalidatePath(backUrl);
  redirect(`${backUrl}?success=sessions-revoked`);
}

// ── Add permission override ───────────────────────────────────────────────────

export async function addPermissionOverrideAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  // Only Super Admin can manage permission overrides.
  if (context.role?.slug !== "super_admin") {
    redirect("/admin/users?error=insufficient-permissions");
  }

  const parsed = z
    .object({
      profile_id: z.string().uuid(),
      permission_key: z.string().min(1).max(120),
      override_type: z.enum(["allow", "deny"]),
      reason: z.string().trim().max(500).optional().default("")
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { profile_id, permission_key, override_type, reason } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  // Safety: Cannot add overrides on another Super Admin account.
  const targetSlug = await getTargetRoleSlug(profile_id);
  if (targetSlug === "super_admin") {
    redirect(`${backUrl}?error=cannot-override-super-admin`);
  }

  await prisma.$executeRaw`
    insert into public.user_permission_overrides
      (profile_id, permission_key, override_type, reason, created_by)
    values
      (${profile_id}::uuid, ${permission_key}, ${override_type}, ${reason || null}, ${context.userId}::uuid)
    on conflict (profile_id, permission_key, override_type)
    do update set
      reason = excluded.reason,
      created_by = excluded.created_by,
      created_at = now()
  `;

  await writeAuditLog({
    actorId: context.userId,
    action: "user.permission_override_added",
    entityType: "profile",
    entityId: profile_id,
    summary: `Added ${override_type} override for "${permission_key}"`,
    metadata: { permission_key, override_type, reason: reason || null }
  });

  revalidatePath(backUrl);
  redirect(`${backUrl}?success=override-added`);
}

// ── Archive user (Super Admin only) ──────────────────────────────────────────

export async function archiveUserAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  if (context.role?.slug !== "super_admin") {
    redirect("/admin/users?error=insufficient-permissions");
  }

  const parsed = z
    .object({ profile_id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { profile_id } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  if (profile_id === context.userId) {
    redirect(`${backUrl}?error=cannot-archive-self`);
  }

  const targetSlug = await getTargetRoleSlug(profile_id);
  if (targetSlug === "super_admin") {
    redirect(`${backUrl}?error=cannot-modify-super-admin`);
  }

  const target = await prisma.profiles.findUnique({
    where: { id: profile_id },
    select: { full_name: true, is_active: true, deleted_at: true }
  });
  if (!target) redirect("/admin/users?error=not-found");

  if (target.deleted_at !== null) redirect(`${backUrl}?error=already-archived`);
  if (target.is_active) redirect(`${backUrl}?error=must-deactivate-first`);

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.profiles.update({
      where: { id: profile_id },
      data: { deleted_at: now, is_active: false }
    });
    await tx.$executeRaw`
      update public.auth_users
      set deleted_at = ${now},
          is_active  = false,
          updated_at = ${now}
      where profile_id = ${profile_id}::uuid
    `;
    await tx.auth_sessions.updateMany({
      where: { profile_id, revoked_at: null },
      data: { revoked_at: now }
    });
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "user.archived",
    entityType: "profile",
    entityId: profile_id,
    summary: `Archived user account for ${target.full_name}. All sessions revoked.`,
    metadata: { archived_at: now.toISOString() }
  });

  revalidatePath(backUrl);
  revalidatePath("/admin/users");
  redirect(`${backUrl}?success=user-archived`);
}

// ── Restore archived user (Super Admin only) ──────────────────────────────────

export async function restoreUserAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  if (context.role?.slug !== "super_admin") {
    redirect("/admin/users?error=insufficient-permissions");
  }

  const parsed = z
    .object({ profile_id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { profile_id } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  const target = await prisma.profiles.findUnique({
    where: { id: profile_id },
    select: { full_name: true, deleted_at: true }
  });
  if (!target) redirect("/admin/users?error=not-found");

  if (target.deleted_at === null) redirect(`${backUrl}?error=not-archived`);

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.profiles.update({
      where: { id: profile_id },
      data: { deleted_at: null }
    });
    await tx.$executeRaw`
      update public.auth_users
      set deleted_at = null,
          updated_at = ${now}
      where profile_id = ${profile_id}::uuid
    `;
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "user.restored",
    entityType: "profile",
    entityId: profile_id,
    summary: `Restored archived user account for ${target.full_name}. Account remains inactive.`,
    metadata: { restored_at: now.toISOString() }
  });

  revalidatePath(backUrl);
  revalidatePath("/admin/users");
  redirect(`${backUrl}?success=user-restored`);
}

// ── Remove permission override ────────────────────────────────────────────────

export async function removePermissionOverrideAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  // Only Super Admin can manage permission overrides.
  if (context.role?.slug !== "super_admin") {
    redirect("/admin/users?error=insufficient-permissions");
  }

  const parsed = z
    .object({
      override_id: z.string().uuid(),
      profile_id: z.string().uuid()
    })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { override_id, profile_id } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  const deleted = await prisma.$queryRaw<
    Array<{ permission_key: string; override_type: string }>
  >`
    delete from public.user_permission_overrides
    where id = ${override_id}::uuid
      and profile_id = ${profile_id}::uuid
    returning permission_key, override_type
  `;

  if (deleted.length) {
    await writeAuditLog({
      actorId: context.userId,
      action: "user.permission_override_removed",
      entityType: "profile",
      entityId: profile_id,
      summary: `Removed ${deleted[0].override_type} override for "${deleted[0].permission_key}"`,
      metadata: {
        permission_key: deleted[0].permission_key,
        override_type: deleted[0].override_type
      }
    });
  }

  revalidatePath(backUrl);
  redirect(`${backUrl}?success=override-removed`);
}
