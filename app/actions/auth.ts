"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSession, revokeCurrentSession, getSessionToken, hashSessionToken } from "@/lib/auth/session";
import { getCurrentUserContext, requireUser } from "@/lib/auth/context";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/lib/db/prisma";
import { checkLoginEmailRateLimit, resetLoginEmailRateLimit } from "@/lib/security/rate-limit";

// How many wrong passwords before the account is locked.
const LOCKOUT_THRESHOLD = 5;
// How long to lock the account (15 minutes).
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  next: z.string().optional()
});

type LoginUserRow = {
  user_id: string;
  profile_id: string;
  email: string;
  password_hash: string;
  locked_until: Date | null;
  failed_login_count: number;
  is_active: boolean;
};

function safeNext(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

async function writeLoginAttemptAudit(input: { profileId?: string | null; email: string; reason: string; summary: string }) {
  await writeAuditLog({
    actorId: input.profileId ?? null,
    action: "auth.login_failed",
    entityType: input.profileId ? "profile" : "auth",
    entityId: input.profileId ?? null,
    summary: input.summary,
    metadata: { email: input.email, reason: input.reason }
  });
}

export async function signInAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || "/dashboard"
  });

  if (!parsed.success) {
    redirect("/login?error=invalid-input");
  }

  const email = parsed.data.email.toLowerCase();

  // ── Email-level rate limit (defense-in-depth alongside middleware IP limit) ──
  const emailLimit = checkLoginEmailRateLimit(email);
  if (!emailLimit.allowed) {
    redirect(`/login?error=rate-limited`);
  }

  const users = await prisma.$queryRaw<LoginUserRow[]>`
    select
      au.id        as user_id,
      au.profile_id,
      au.email,
      au.password_hash,
      au.locked_until,
      au.failed_login_count,
      p.is_active
    from public.auth_users au
    join public.profiles p on p.id = au.profile_id
    where lower(au.email) = ${email}
      and au.deleted_at is null
      and p.deleted_at is null
    limit 1
  `;
  const user = users[0];

  if (!user) {
    await writeLoginAttemptAudit({
      email,
      reason: "unknown_email",
      summary: "Failed login attempt for an unknown email address"
    });
    redirect("/login?error=invalid-credentials");
  }

  // ── Account lockout check ─────────────────────────────────────────────────
  if (user.locked_until && user.locked_until > new Date()) {
    await writeLoginAttemptAudit({
      profileId: user.profile_id,
      email: user.email,
      reason: "locked",
      summary: "Blocked login attempt for a temporarily locked account"
    });
    redirect("/login?error=locked");
  }

  // ── Password verification ─────────────────────────────────────────────────
  const passwordValid = await verifyPassword(parsed.data.password, user.password_hash);
  if (!passwordValid) {
    const newCount = user.failed_login_count + 1;
    const shouldLock = newCount >= LOCKOUT_THRESHOLD;
    const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null;

    await prisma.auth_users.update({
      where: { id: user.user_id },
      data: {
        failed_login_count: newCount,
        ...(shouldLock ? { locked_until: lockedUntil } : {})
      }
    });

    if (shouldLock) {
      // Audit the lockout event separately so it is searchable in the log.
      await writeAuditLog({
        actorId: user.profile_id,
        action: "auth.account_locked",
        entityType: "profile",
        entityId: user.profile_id,
        summary: `Account locked for 15 minutes after ${newCount} consecutive failed login attempts`,
        metadata: { email: user.email, failed_attempts: newCount, locked_until: lockedUntil?.toISOString() }
      });
    }

    await writeLoginAttemptAudit({
      profileId: user.profile_id,
      email: user.email,
      reason: "invalid_password",
      summary: shouldLock
        ? `Failed login — account now locked (${newCount}/${LOCKOUT_THRESHOLD} attempts)`
        : `Failed login attempt ${newCount}/${LOCKOUT_THRESHOLD} before lockout`
    });

    redirect(shouldLock ? "/login?error=locked" : "/login?error=invalid-credentials");
  }

  // ── Inactive profile check ────────────────────────────────────────────────
  if (!user.is_active) {
    await writeLoginAttemptAudit({
      profileId: user.profile_id,
      email: user.email,
      reason: "inactive_profile",
      summary: "Blocked login attempt for an inactive profile"
    });
    redirect("/login?error=inactive-profile");
  }

  // ── Successful login — reset counters and create session ─────────────────
  await prisma.auth_users.update({
    where: { id: user.user_id },
    data: {
      failed_login_count: 0,
      locked_until: null, // always clear on success in case an admin had set it
      last_login_at: new Date()
    }
  });

  // Reset the email rate-limit bucket so a legitimate user isn't penalised
  // for previous failed attempts in the same window.
  resetLoginEmailRateLimit(email);

  await createSession({ userId: user.user_id, profileId: user.profile_id });
  await writeAuditLog({
    actorId: user.profile_id,
    action: "login",
    entityType: "profile",
    entityId: user.profile_id,
    summary: "User signed in with local authentication",
    metadata: { email: user.email }
  });

  redirect(safeNext(parsed.data.next));
}

export async function signOutAction() {
  const context = await getCurrentUserContext();
  if (context) {
    await writeAuditLog({
      actorId: context.userId,
      action: "logout",
      entityType: "profile",
      entityId: context.userId,
      summary: "User signed out",
      metadata: { email: context.email }
    });
  }
  await revokeCurrentSession();
  redirect("/login");
}

export async function forgotPasswordAction(formData: FormData) {
  const email = z.string().email().safeParse(formData.get("email"));

  if (!email.success) {
    redirect("/forgot-password?error=invalid-email");
  }

  await writeAuditLog({
    actorId: null,
    action: "auth.password_reset_requested",
    entityType: "auth",
    summary: "Password reset request submitted",
    metadata: { email: email.data.toLowerCase() }
  });

  redirect("/forgot-password?sent=1");
}

export async function resetPasswordAction() {
  await writeAuditLog({
    actorId: null,
    action: "auth.password_reset_blocked",
    entityType: "auth",
    summary: "Password reset flow redirected to admin-managed reset"
  });
  redirect("/login?error=reset-admin-managed");
}

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8).max(128),
  confirm_new_password: z.string().min(1)
});

export async function changePasswordAction(formData: FormData) {
  const context = await requireUser({ skipPasswordChangeCheck: true });

  const parsed = changePasswordSchema.safeParse({
    current_password: formData.get("current_password"),
    new_password: formData.get("new_password"),
    confirm_new_password: formData.get("confirm_new_password")
  });

  if (!parsed.success) {
    redirect("/change-password?error=invalid-input");
  }

  if (parsed.data.new_password !== parsed.data.confirm_new_password) {
    redirect("/change-password?error=passwords-mismatch");
  }

  const authRows = await prisma.$queryRaw<{ id: string; password_hash: string }[]>`
    select id, password_hash from public.auth_users where profile_id = ${context.userId}::uuid limit 1
  `;
  const authUser = authRows[0];
  if (!authUser) {
    redirect("/change-password?error=no-account");
  }

  const currentValid = await verifyPassword(parsed.data.current_password, authUser.password_hash);
  if (!currentValid) {
    redirect("/change-password?error=wrong-current-password");
  }

  if (parsed.data.new_password === parsed.data.current_password) {
    redirect("/change-password?error=same-as-current");
  }

  const newHash = await hashPassword(parsed.data.new_password);

  await prisma.auth_users.update({
    where: { id: authUser.id },
    data: {
      password_hash: newHash,
      must_reset_password: false,
      password_changed_at: new Date(),
      temporary_password_set_at: null,
      updated_at: new Date()
    }
  });

  // Revoke other active sessions — keep only the current one.
  const token = await getSessionToken();
  if (token) {
    const tokenHash = hashSessionToken(token);
    await prisma.auth_sessions.updateMany({
      where: {
        profile_id: context.userId,
        revoked_at: null,
        NOT: { session_token_hash: tokenHash }
      },
      data: { revoked_at: new Date() }
    });
  }

  await writeAuditLog({
    actorId: context.userId,
    action: "auth.password_changed",
    entityType: "profile",
    entityId: context.userId,
    summary: "User changed their own password",
    metadata: { forced: context.mustResetPassword }
  });

  redirect("/dashboard");
}
