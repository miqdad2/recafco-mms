"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/context";
import { hashPassword } from "@/lib/auth/password";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/lib/db/prisma";
import { notifyByEvent } from "@/lib/notifications/service";
import { emitRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";


const checkbox = z.preprocess((value) => value === "on" || value === "true", z.boolean());

const departmentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(20).toUpperCase(),
  description: z.string().trim().max(500).optional(),
  manager_name: z.string().trim().max(120).optional(),
  is_active: checkbox.default(true)
});

const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(120),
  employee_number: z.string().trim().max(40).optional(),
  phone: z.string().trim().max(40).optional(),
  job_title: z.string().trim().max(120).optional(),
  department_id: z.string().uuid().optional().or(z.literal("")),
  role_id: z.string().uuid().optional().or(z.literal("")),
  is_active: checkbox.default(false),
  can_view_costs: checkbox.default(false)
});

const localUserSchema = profileSchema
  .omit({ id: true })
  .extend({
    email: z.string().trim().email().max(320),
    password: z.string().min(6).max(128)
  });

const settingsSchema = z.object({
  company_name: z.string().trim().min(2).max(160),
  default_currency: z.string().trim().min(3).max(3).toUpperCase(),
  work_order_number_format: z.string().trim().min(4).max(80),
  parts_request_number_format: z.string().trim().min(4).max(80),
  purchase_request_number_format: z.string().trim().min(4).max(80),
  ceo_approval_threshold: z.coerce.number().min(0).max(1000000),
  requester_confirmation_enabled: checkbox.default(false),
  finance_approval_enabled: checkbox.default(false),
  ceo_approval_enabled: checkbox.default(false),
  notification_retention_days: z.coerce.number().int().min(30).max(3650).default(180),
  notification_poll_interval_seconds: z.coerce.number().int().min(15).max(3600).default(45),
  force_critical_notifications: checkbox.default(true),
  max_upload_size_mb: z.coerce.number().int().min(1).max(100).default(10),
  signed_url_expiry_seconds: z.coerce.number().int().min(60).max(3600).default(300)
});

export async function upsertDepartmentAction(formData: FormData) {
  const context = await requirePermission("admin.departments.manage");
  const parsed = departmentSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    redirect("/admin/departments?error=invalid-input");
  }

  const { id, ...payload } = parsed.data;
  let record: { id: string; name: string } | undefined;
  try {
    record = id
      ? await prisma.departments.update({ where: { id }, data: payload, select: { id: true, name: true } })
      : await prisma.departments.create({ data: payload, select: { id: true, name: true } });
  } catch {
    redirect("/admin/departments?error=save-failed");
  }
  if (!record) redirect("/admin/departments?error=save-failed");

  await writeAuditLog({
    actorId: context.userId,
    action: id ? "department.update" : "department.create",
    entityType: "department",
    entityId: record.id,
    summary: `${id ? "Updated" : "Created"} department ${record.name}`,
    metadata: { code: payload.code }
  });

  revalidatePath("/admin/departments");
  revalidatePath("/dashboard");
  redirect("/admin/departments?success=department-saved");
}

export async function upsertProfileAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    redirect("/admin/users?error=invalid-input");
  }

  if (parsed.data.is_active && !parsed.data.role_id) {
    redirect("/admin/users?error=active-role-required");
  }

  const payload = {
    ...parsed.data,
    employee_number: parsed.data.employee_number || null,
    phone: parsed.data.phone || null,
    job_title: parsed.data.job_title || null,
    department_id: parsed.data.department_id || null,
    role_id: parsed.data.role_id || null
  };
  const { id: profileId, ...profileData } = payload;
  let record: { id: string; full_name: string } | undefined;
  try {
    record = await prisma.profiles.upsert({
      where: { id: profileId },
      create: { id: profileId, ...profileData },
      update: profileData,
      select: { id: true, full_name: true }
    });
  } catch {
    redirect("/admin/users?error=save-failed");
  }
  if (!record) redirect("/admin/users?error=save-failed");

  await writeAuditLog({
    actorId: context.userId,
    action: "profile.upsert",
    entityType: "profile",
    entityId: record.id,
    summary: `Saved profile ${record.full_name}`,
    metadata: { role_id: payload.role_id, department_id: payload.department_id }
  });
  await notifyByEvent({
    eventKey: "user.created",
    entityType: "profile",
    entityId: record.id,
    actorId: context.userId,
    recipientRoles: ["super_admin", "it_admin"],
    metadata: { user_name: record.full_name },
    actionUrl: "/admin/users",
    actionLabel: "Open users"
  });

  revalidatePath("/admin/users");
  revalidatePath("/dashboard");
  redirect("/admin/users?success=saved");
}

export async function createLocalUserAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");
  const parsed = localUserSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    redirect("/admin/users?error=invalid-input");
  }

  if (parsed.data.is_active && !parsed.data.role_id) {
    redirect("/admin/users?error=active-role-required");
  }

  const email = parsed.data.email.toLowerCase();

  // Explicit duplicate-email pre-check before the transaction.
  const existingAuth = await prisma.auth_users.findUnique({
    where: { email },
    select: { id: true }
  });
  if (existingAuth) {
    redirect("/admin/users?error=duplicate-email");
  }

  const profileId = randomUUID();
  const passwordHash = await hashPassword(parsed.data.password);

  try {
    await prisma.$transaction(async (tx) => {
      // Set audit context so DB triggers can record the acting user.
      await tx.$executeRaw`select set_config('app.current_profile_id', ${context.userId}, true)`;

      // Use Prisma model instead of raw SQL — gives typed errors and avoids
      // raw-SQL edge cases around null UUID casts and column existence.
      await tx.profiles.create({
        data: {
          id: profileId,
          full_name: parsed.data.full_name,
          employee_number: parsed.data.employee_number || null,
          phone: parsed.data.phone || null,
          job_title: parsed.data.job_title || null,
          department_id: parsed.data.department_id || null,
          role_id: parsed.data.role_id || null,
          is_active: parsed.data.is_active,
          can_view_costs: parsed.data.can_view_costs
        }
      });

      await tx.auth_users.create({
        data: {
          profile_id: profileId,
          email,
          password_hash: passwordHash,
          password_set_at: new Date(),
          must_reset_password: true,
          temporary_password_set_at: new Date()
        }
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (process.env.NODE_ENV === "development") {
      const prismaErr = err as Record<string, unknown>;
      console.error("[createLocalUserAction] Transaction failed:", {
        code:    prismaErr?.code,
        message: msg,
        meta:    prismaErr?.meta,
        stack:   err instanceof Error ? err.stack : undefined
      });
    }

    // Detect specific Prisma / PostgreSQL error codes.
    // P2002 = unique constraint; check which constraint fired.
    if (msg.includes("P2002") || msg.includes("unique constraint") || msg.includes("duplicate key")) {
      if (msg.includes("email") || msg.includes("auth_users_email_key")) {
        redirect("/admin/users?error=duplicate-email");
      }
      if (msg.includes("employee_number")) {
        redirect("/admin/users?error=duplicate-employee-number");
      }
    }

    // P2003 = foreign key constraint failed on insert
    if (msg.includes("P2003") || msg.includes("foreign key constraint")) {
      if (process.env.NODE_ENV === "development") {
        console.error("[createLocalUserAction] FK violation — check that profiles.id has no FK to auth.users. Run migration 20260609000003.");
      }
    }

    // Log the full technical error to system health so admins can diagnose.
    const { logSystemError } = await import("@/lib/errors/logging");
    await logSystemError({
      severity: "error",
      source: "admin.createLocalUserAction",
      message: msg.slice(0, 1000),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      userId: context.userId,
      entityType: "profile",
      entityId: profileId,
      metadata: { email, full_name: parsed.data.full_name }
    });
    redirect("/admin/users?error=create-user-failed");
  }

  await writeAuditLog({
    actorId: context.userId,
    action: "user.create",
    entityType: "profile",
    entityId: profileId,
    summary: `Created local user ${parsed.data.full_name} (temporary password set, must change on first login)`,
    metadata: {
      email,
      role_id: parsed.data.role_id || null,
      department_id: parsed.data.department_id || null,
      must_reset_password: true
    }
  });
  await notifyByEvent({
    eventKey: "user.created",
    entityType: "profile",
    entityId: profileId,
    actorId: context.userId,
    recipientRoles: ["super_admin", "it_admin"],
    metadata: { user_name: parsed.data.full_name },
    actionUrl: `/admin/users/${profileId}`,
    actionLabel: "View user"
  });

  await emitRealtimeEvent({
    eventType: REALTIME_EVENTS.USER_CREATED,
    entityType: "profile",
    entityId: profileId,
    actorProfileId: context.userId,
    payload: {
      full_name: parsed.data.full_name,
      role_id: parsed.data.role_id || null,
      department_id: parsed.data.department_id || null,
    },
  });

  revalidatePath("/admin/users");
  revalidatePath("/dashboard");
  redirect("/admin/users?success=user-created");
}

export async function updateSettingsAction(formData: FormData) {
  const context = await requirePermission("admin.settings.manage");
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    redirect("/admin/settings?error=invalid-input");
  }

  let record: { id: string; company_name: string } | undefined;
  try {
    record = await prisma.app_settings.upsert({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      create: { id: "00000000-0000-0000-0000-000000000001", ...parsed.data, updated_by: context.userId },
      update: { ...parsed.data, updated_by: context.userId },
      select: { id: true, company_name: true }
    });
  } catch {
    redirect("/admin/settings?error=save-failed");
  }
  if (!record) redirect("/admin/settings?error=save-failed");

  await writeAuditLog({
    actorId: context.userId,
    action: "settings.update",
    entityType: "app_settings",
    entityId: record.id,
    summary: `Updated settings for ${record.company_name}`,
    metadata: {
      ceo_approval_threshold: parsed.data.ceo_approval_threshold,
      default_currency: parsed.data.default_currency,
      max_upload_size_mb: parsed.data.max_upload_size_mb,
      signed_url_expiry_seconds: parsed.data.signed_url_expiry_seconds
    }
  });
  await notifyByEvent({
    eventKey: "settings.changed",
    entityType: "app_settings",
    entityId: record.id,
    actorId: context.userId,
    recipientRoles: ["super_admin", "it_admin"],
    metadata: { company_name: record.company_name },
    actionUrl: "/admin/settings",
    actionLabel: "Open settings"
  });

  revalidatePath("/admin/settings");
  redirect("/admin/settings?success=settings-saved");
}

const resetPasswordSchema = z.object({
  profile_id: z.string().uuid(),
  new_password: z.string().min(8).max(128),
  confirm_new_password: z.string().min(1)
});

export async function resetUserPasswordAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    redirect("/admin/users?error=invalid-input");
  }

  if (parsed.data.new_password !== parsed.data.confirm_new_password) {
    redirect(`/admin/users/${parsed.data.profile_id}?error=passwords-mismatch`);
  }

  if (parsed.data.profile_id === context.userId) {
    redirect(`/admin/users/${parsed.data.profile_id}?error=cannot-reset-own-password`);
  }

  const authRows = await prisma.$queryRaw<{ id: string }[]>`
    select id from public.auth_users where profile_id = ${parsed.data.profile_id}::uuid limit 1
  `;
  if (!authRows[0]) {
    redirect(`/admin/users/${parsed.data.profile_id}?error=no-login-account`);
  }

  const newHash = await hashPassword(parsed.data.new_password);

  await prisma.auth_users.update({
    where: { id: authRows[0].id },
    data: {
      password_hash: newHash,
      must_reset_password: true,
      temporary_password_set_at: new Date(),
      password_changed_at: null,
      failed_login_count: 0,
      locked_until: null,
      updated_at: new Date()
    }
  });

  // Revoke all active sessions for the target user so they must re-login.
  await prisma.auth_sessions.updateMany({
    where: { profile_id: parsed.data.profile_id, revoked_at: null },
    data: { revoked_at: new Date() }
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "user.password_reset",
    entityType: "profile",
    entityId: parsed.data.profile_id,
    summary: `Admin reset password for user — must change on next login`,
    metadata: { reset_by: context.userId }
  });

  revalidatePath(`/admin/users/${parsed.data.profile_id}`);
  redirect(`/admin/users/${parsed.data.profile_id}?success=password-reset`);
}
