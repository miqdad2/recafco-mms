"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/lib/db/prisma";
import { notifyByEvent } from "@/lib/notifications/service";
import { emitRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { countActiveSuperAdmins, getUserDeletionImpact } from "@/lib/user-lifecycle/impact";
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
  await emitRealtimeEvent({
    eventType: REALTIME_EVENTS.USER_ROLE_CHANGED,
    entityType: "profile",
    entityId: profile_id,
    actorProfileId: context.userId
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
  await emitRealtimeEvent({
    eventType: REALTIME_EVENTS.USER_UPDATED,
    entityType: "profile",
    entityId: profile_id,
    actorProfileId: context.userId
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
  await emitRealtimeEvent({
    eventType: REALTIME_EVENTS.USER_ACCOUNT_UNLOCKED,
    entityType: "profile",
    entityId: profile_id,
    actorProfileId: context.userId
  });

  revalidatePath(backUrl);
  redirect(`${backUrl}?success=unlocked`);
}

// ── Force password change on next login ───────────────────────────────────────

export async function forcePasswordChangeAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  const parsed = z
    .object({ profile_id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { profile_id } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  if (profile_id === context.userId) {
    redirect(`${backUrl}?error=cannot-force-own-password-change`);
  }

  await assertCanModify(context, profile_id, backUrl);

  const authRows = await prisma.$queryRaw<{ id: string }[]>`
    select id from public.auth_users where profile_id = ${profile_id}::uuid limit 1
  `;
  if (!authRows[0]) redirect(`${backUrl}?error=no-login-account`);

  await prisma.auth_users.update({
    where: { id: authRows[0].id },
    data: { must_reset_password: true, updated_at: new Date() }
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "user.password_change_forced",
    entityType: "profile",
    entityId: profile_id,
    summary: "Admin required password change on next login",
    metadata: {}
  });
  await emitRealtimeEvent({
    eventType: REALTIME_EVENTS.USER_PASSWORD_CHANGE_FORCED,
    entityType: "profile",
    entityId: profile_id,
    actorProfileId: context.userId
  });

  revalidatePath(backUrl);
  revalidatePath("/admin/users");
  redirect(`${backUrl}?success=password-change-forced`);
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
  await emitRealtimeEvent({
    eventType: REALTIME_EVENTS.USER_ARCHIVED,
    entityType: "profile",
    entityId: profile_id,
    actorProfileId: context.userId
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
  await emitRealtimeEvent({
    eventType: REALTIME_EVENTS.USER_RESTORED,
    entityType: "profile",
    entityId: profile_id,
    actorProfileId: context.userId
  });

  revalidatePath(backUrl);
  revalidatePath("/admin/users");
  redirect(`${backUrl}?success=user-restored`);
}

// ── Delete user permanently (Super Admin only) ─────────────────────────────────

export async function deleteUserAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");

  // Only Super Admin can permanently delete accounts.
  if (context.role?.slug !== "super_admin") {
    redirect("/admin/users?error=insufficient-permissions");
  }

  const parsed = z
    .object({ profile_id: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/admin/users?error=invalid-input");
  const { profile_id } = parsed.data;
  const backUrl = `/admin/users/${profile_id}`;

  // Safety: cannot delete the account currently signed in.
  if (profile_id === context.userId) {
    redirect(`${backUrl}?error=cannot-delete-self`);
  }

  const target = await prisma.$queryRaw<
    Array<{ full_name: string; deleted_at: Date | null; role_slug: string | null; email: string | null }>
  >`
    select p.full_name, p.deleted_at, r.slug as role_slug, au.email
    from public.profiles p
    left join public.roles r on r.id = p.role_id
    left join public.auth_users au on au.profile_id = p.id
    where p.id = ${profile_id}::uuid
    limit 1
  `;
  const targetUser = target[0];
  if (!targetUser) redirect("/admin/users?error=not-found");

  // Safety: cannot delete the last System Administrator.
  if (targetUser.role_slug === "super_admin") {
    const remaining = await countActiveSuperAdmins();
    if (remaining <= 1) {
      redirect(`${backUrl}?error=cannot-delete-last-admin`);
    }
  }

  // Safety: refuse permanent delete when linked business records exist —
  // recommend Archive instead. See lib/user-lifecycle/impact.ts for exactly
  // which tables this checks (including the one table, technician notes,
  // that would otherwise cascade-delete silently rather than block).
  const impact = await getUserDeletionImpact(profile_id);
  if (!impact.canPermanentDelete) {
    redirect(`${backUrl}?error=has-linked-records`);
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Delete auth-only data first. auth_sessions/auth_users both already
      // cascade from profiles, but doing this explicitly keeps the delete
      // order obvious and matches the archive/restore actions' style above.
      await tx.auth_sessions.deleteMany({ where: { profile_id } });
      await tx.profiles.delete({ where: { id: profile_id } });
    });
  } catch (err) {
    // Backstop for any FK this app doesn't already know to check for —
    // every other table referencing profiles.id is ON DELETE
    // NO ACTION/RESTRICT, so an unexpected linked record surfaces here as a
    // constraint violation instead of silently deleting or crashing.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      redirect(`${backUrl}?error=has-linked-records`);
    }
    throw err;
  }

  // The profile row is gone — audit against its id with the details
  // captured before deletion. No password, hash, or token is ever included.
  await writeAuditLog({
    actorId: context.userId,
    action: "user.deleted",
    entityType: "profile",
    entityId: profile_id,
    summary: `Permanently deleted user account for ${targetUser.full_name}`,
    metadata: {
      deleted_profile_id: profile_id,
      deleted_email: targetUser.email,
      deleted_name: targetUser.full_name,
      deleted_by: context.userId,
      deleted_at: new Date().toISOString()
    }
  });
  await emitRealtimeEvent({
    eventType: REALTIME_EVENTS.USER_DELETED,
    entityType: "profile",
    entityId: profile_id,
    actorProfileId: context.userId
  });

  revalidatePath("/admin/users");
  redirect("/admin/users?success=user-deleted");
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
