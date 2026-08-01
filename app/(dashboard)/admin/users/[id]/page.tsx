import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  LogOut,
  RotateCcw,
  ShieldAlert,
  Trash2,
  User,
  UserCheck,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  archiveUserAction,
  changeUserRoleAction,
  forcePasswordChangeAction,
  restoreUserAction,
  revokeUserSessionsAction,
  toggleUserActiveAction,
  unlockUserAccountAction
} from "@/app/actions/user-access";
import { resetUserPasswordAction } from "@/app/actions/admin";
import { AutoRefresh } from "@/components/auto-refresh";
import { DeleteUserDialog } from "@/components/admin/delete-user-dialog";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { cn, formatExactDateTime, resolveDisplayLoginCount, resolveLastSeen } from "@/lib/utils";
import { countActiveSuperAdmins, getUserDeletionImpact } from "@/lib/user-lifecycle/impact";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Types ─────────────────────────────────────────────────────────────────────

type AuthRow = {
  email: string;
  last_login_at: Date | null;
  last_active_at: Date | null;
  login_count: number;
  failed_login_count: number;
  last_failed_login_at: Date | null;
  locked_until: Date | null;
  must_reset_password: boolean;
  password_changed_at: Date | null;
  temporary_password_set_at: Date | null;
};

type RoleRow = { id: string; name: string; slug: string };

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadUserData(profileId: string) {
  const profile = await prisma.profiles.findUnique({
    where: { id: profileId },
    include: { roles: true }
  });

  if (!profile) return null;

  const [authRows, activeSessions, roles, impact, activeSuperAdminCount] = await Promise.all([
    prisma.$queryRaw<AuthRow[]>`
      select
        email,
        last_login_at,
        last_active_at,
        login_count,
        failed_login_count,
        last_failed_login_at,
        locked_until,
        must_reset_password,
        password_changed_at,
        temporary_password_set_at
      from public.auth_users
      where profile_id = ${profileId}::uuid
      limit 1
    `,
    prisma.auth_sessions.count({
      where: { profile_id: profileId, revoked_at: null, expires_at: { gt: new Date() } }
    }),
    prisma.$queryRaw<RoleRow[]>`
      select id, name, slug from public.roles
      where slug in ('super_admin', 'maintenance_data_entry')
      order by name
    `,
    getUserDeletionImpact(profileId),
    countActiveSuperAdmins()
  ]);

  return { profile, auth: authRows[0] ?? null, activeSessions, roles, impact, activeSuperAdminCount };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function UserDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("admin.users.manage");
  const { id: profileId } = await params;
  const sp = (await searchParams) ?? {};

  const data = await loadUserData(profileId);
  if (!data) notFound();

  const { profile, auth, activeSessions, roles, impact, activeSuperAdminCount } = data;

  const isOwnAccount = context.userId === profileId;
  const isSuperAdminViewer = context.role?.slug === "super_admin";
  const targetRoleSlug = profile.roles?.slug ?? null;
  const isTargetSuperAdmin = targetRoleSlug === "super_admin";
  const isLastSuperAdmin = isTargetSuperAdmin && activeSuperAdminCount <= 1;

  const isLocked = auth?.locked_until != null && new Date(auth.locked_until) > new Date();

  const successMessages: Record<string, string> = {
    "role-changed": "Account type updated.",
    activated: "Account activated.",
    deactivated: "Account deactivated and all sessions revoked.",
    unlocked: "Account unlocked.",
    "sessions-revoked": "All active sessions revoked.",
    "password-reset": "Temporary password set. User must change it on next login.",
    "password-change-forced": "User will be required to change their password on next login."
  };

  const errorMessages: Record<string, string> = {
    "cannot-change-own-super-admin": "You cannot change your own System Administrator account type.",
    "cannot-deactivate-self": "You cannot deactivate your own account.",
    "cannot-modify-super-admin": "Only System Administrators can change another System Administrator account.",
    "invalid-input": "Invalid request. Please try again.",
    "passwords-mismatch": "New password and confirmation do not match.",
    "cannot-reset-own-password": "Use /change-password to change your own password.",
    "cannot-force-own-password-change": "You cannot force a password change on your own account.",
    "no-login-account": "This profile has no login account.",
    "cannot-delete-self": "You cannot delete your own account.",
    "cannot-delete-last-admin": "Cannot delete the last System Administrator.",
    "has-linked-records": "This user has linked system records, so permanent delete is not allowed. Use Archive to disable the account while keeping history safe."
  };

  const lastSeenValue = resolveLastSeen(auth?.last_active_at ?? null, auth?.last_login_at ?? null);
  const displayLoginCount = resolveDisplayLoginCount(auth?.login_count, auth?.last_login_at ?? null);

  return (
    <>
      <AutoRefresh intervalMs={20000} />
      <RealtimeRefresh watch={["user."]} />
      <PageHeader
        title={profile.full_name}
        description={auth?.email ?? "No login account"}
        actions={
          <Link href="/admin/users">
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              All users
            </Button>
          </Link>
        }
      />

      <div className="space-y-5 p-4 lg:p-6">
        {/* Banners */}
        {sp.success && successMessages[sp.success] ? (
          <Banner tone="green" icon={<CheckCircle2 className="h-4 w-4" />} message={successMessages[sp.success]} />
        ) : null}
        {sp.error && errorMessages[sp.error] ? (
          <Banner tone="red" icon={<AlertTriangle className="h-4 w-4" />} message={errorMessages[sp.error]} />
        ) : null}

        {/* Status header */}
        <section className="flex flex-wrap items-center gap-3 rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#F5F6F8]">
            <User className="h-6 w-6 text-[#4B5563]" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <p className="text-xl font-black text-[#111827]">{profile.full_name}</p>
            <p className="text-sm text-[#4B5563]">{auth?.email ?? "No login account"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {profile.deleted_at ? (
              <StatusBadge label="Archived" tone="gray" />
            ) : (
              <StatusBadge label={profile.is_active ? "Active" : "Inactive"} tone={profile.is_active ? "green" : "gray"} />
            )}
            {isLocked && <StatusBadge label="Locked" tone="red" />}
            {auth?.must_reset_password && <StatusBadge label="Must reset password" tone="amber" />}
            {profile.roles ? (
              <StatusBadge
                label={profile.roles.slug === "super_admin" ? "System Administrator" : "Normal User"}
                tone="blue"
              />
            ) : (
              <StatusBadge label="No role" tone="gray" />
            )}
            {isOwnAccount && <StatusBadge label="Your account" tone="amber" />}
          </div>
        </section>

        {/* Two-column layout */}
        <div className="grid gap-5 lg:grid-cols-2">

          {/* Left: Profile details + Auth + Password reset */}
          <div className="space-y-4">

            <Card title="Profile details">
              <DetailRow label="Full name" value={profile.full_name} />
              {profile.employee_number && (
                <DetailRow label="Employee number" value={profile.employee_number} />
              )}
              {profile.phone && (
                <DetailRow label="Phone" value={profile.phone} />
              )}
              <DetailRow
                label="Account type"
                value={profile.roles?.slug === "super_admin" ? "System Administrator" : "Normal User"}
              />
            </Card>

            {auth && (
              <Card title="Account activity">
                <DetailRow label="Login email" value={auth.email} />
                <DetailRow
                  label="Last login"
                  value={auth.last_login_at ? formatExactDateTime(auth.last_login_at) : "Never"}
                />
                <DetailRow
                  label="Last seen"
                  value={lastSeenValue ? formatExactDateTime(lastSeenValue) : "Never"}
                />
                <DetailRow label="Login count" value={String(displayLoginCount)} />
                <DetailRow
                  label="Failed login count"
                  value={String(auth.failed_login_count)}
                  highlight={auth.failed_login_count > 0 ? "amber" : undefined}
                />
                <DetailRow
                  label="Last failed login"
                  value={auth.last_failed_login_at ? formatExactDateTime(auth.last_failed_login_at) : "Never"}
                />
                <DetailRow
                  label="Password changed"
                  value={auth.password_changed_at ? formatExactDateTime(auth.password_changed_at) : "Never"}
                />
                <DetailRow label="Account created" value={formatExactDateTime(profile.created_at)} />
                {auth.must_reset_password && (
                  <DetailRow
                    label="Password status"
                    value="Temporary — user must change on next login"
                    highlight="amber"
                  />
                )}
              </Card>
            )}

            {auth ? (
              <Card title="Reset password">
                {isOwnAccount ? (
                  <p className="text-sm text-[#4B5563]">
                    To change your own password, log out and log back in, or ask another System Administrator to reset it.
                  </p>
                ) : (
                  <form action={resetUserPasswordAction} className="space-y-3">
                    <input type="hidden" name="profile_id" value={profileId} />
                    <p className="text-sm text-[#4B5563]">
                      Sets a temporary password. The user must change it on next login. All active sessions are revoked immediately.
                    </p>
                    <label className="block">
                      <span className="text-xs font-bold uppercase text-[#4B5563]">New temporary password</span>
                      <input
                        className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 font-mono text-sm tracking-wider"
                        type="password"
                        name="new_password"
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase text-[#4B5563]">Confirm password</span>
                      <input
                        className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 font-mono text-sm tracking-wider"
                        type="password"
                        name="confirm_new_password"
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </label>
                    <Button type="submit" variant="secondary" className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-50">
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                      Set temporary password
                    </Button>
                  </form>
                )}
              </Card>
            ) : (
              <Card title="Reset password">
                <p className="text-sm text-[#4B5563]">
                  No login account found. Create one from the{" "}
                  <Link href="/admin/users" className="font-semibold text-[#2563EB] underline">
                    Users page
                  </Link>
                  .
                </p>
              </Card>
            )}

          </div>

          {/* Right: Account type + Account actions */}
          <div className="space-y-4">

            <Card title="Change account type">
              {isTargetSuperAdmin && isOwnAccount ? (
                <p className="text-sm text-[#4B5563]">You cannot change your own System Administrator account type.</p>
              ) : isTargetSuperAdmin && !isSuperAdminViewer ? (
                <p className="text-sm text-[#4B5563]">Only System Administrators can change another System Administrator&apos;s account type.</p>
              ) : (
                <form action={changeUserRoleAction} className="flex items-end gap-2">
                  <input type="hidden" name="profile_id" value={profileId} />
                  <label className="flex-1">
                    <span className="text-xs font-bold uppercase text-[#4B5563]">Account type</span>
                    <select
                      name="role_id"
                      defaultValue={profile.role_id ?? ""}
                      className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    >
                      {(() => {
                        const normalUserRole = roles.find((r) => r.slug === "maintenance_data_entry");
                        const adminRole = roles.find((r) => r.slug === "super_admin");
                        return (
                          <>
                            {normalUserRole && <option value={normalUserRole.id}>Normal User</option>}
                            {adminRole && <option value={adminRole.id}>System Administrator</option>}
                          </>
                        );
                      })()}
                    </select>
                  </label>
                  <Button type="submit" variant="secondary">Save</Button>
                </form>
              )}
            </Card>

            <Card title="Account actions">
              <div className="space-y-3">
                {!isOwnAccount ? (
                  <form action={toggleUserActiveAction}>
                    <input type="hidden" name="profile_id" value={profileId} />
                    <input type="hidden" name="is_active" value={profile.is_active ? "false" : "true"} />
                    <ActionButton
                      tone={profile.is_active ? "red" : "green"}
                      icon={profile.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                      label={profile.is_active ? "Deactivate account" : "Activate account"}
                      detail={profile.is_active ? "User will lose access immediately. All sessions revoked." : "User will regain access on next login."}
                    />
                  </form>
                ) : (
                  <DisabledActionRow
                    icon={<UserX className="h-4 w-4 text-[#9CA3AF]" />}
                    label="Deactivate account"
                    reason="You cannot deactivate your own account."
                  />
                )}

                {isLocked ? (
                  <form action={unlockUserAccountAction}>
                    <input type="hidden" name="profile_id" value={profileId} />
                    <ActionButton
                      tone="amber"
                      icon={<Lock className="h-4 w-4" />}
                      label="Unlock account"
                      detail="Clears the lockout and resets the failed login counter."
                    />
                  </form>
                ) : (
                  <DisabledActionRow
                    icon={<Lock className="h-4 w-4 text-[#9CA3AF]" />}
                    label="Unlock account"
                    reason="Account is not currently locked."
                  />
                )}

                <form action={revokeUserSessionsAction}>
                  <input type="hidden" name="profile_id" value={profileId} />
                  <ActionButton
                    tone="amber"
                    icon={<LogOut className="h-4 w-4" />}
                    label={`Revoke all sessions (${activeSessions} active)`}
                    detail={isOwnAccount ? "This will also sign you out." : "User will be logged out immediately."}
                  />
                </form>

                {auth && !isOwnAccount ? (
                  auth.must_reset_password ? (
                    <DisabledActionRow
                      icon={<ShieldAlert className="h-4 w-4 text-[#9CA3AF]" />}
                      label="Force password change"
                      reason="Already required to change password on next login."
                    />
                  ) : (
                    <form action={forcePasswordChangeAction}>
                      <input type="hidden" name="profile_id" value={profileId} />
                      <ActionButton
                        tone="amber"
                        icon={<ShieldAlert className="h-4 w-4" />}
                        label="Force password change on next login"
                        detail="Keeps the current password but requires the user to set a new one at next login."
                      />
                    </form>
                  )
                ) : null}
              </div>

              {isSuperAdminViewer && !isOwnAccount && !isTargetSuperAdmin && (
                <>
                  {!profile.deleted_at && !profile.is_active && (
                    <div className="mt-3 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
                        Linked records
                      </p>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-[#6B7280]">
                        {impact.workOrdersCreated > 0 && (
                          <span>{impact.workOrdersCreated} Job Card{impact.workOrdersCreated !== 1 ? "s" : ""}</span>
                        )}
                        {impact.approvalsDecided > 0 && (
                          <span>{impact.approvalsDecided} approval{impact.approvalsDecided !== 1 ? "s" : ""}</span>
                        )}
                        {impact.workOrderAssignments > 0 && (
                          <span>{impact.workOrderAssignments} assignment{impact.workOrderAssignments !== 1 ? "s" : ""}</span>
                        )}
                        {impact.partsRequestsLinked > 0 && (
                          <span>{impact.partsRequestsLinked} parts request{impact.partsRequestsLinked !== 1 ? "s" : ""}</span>
                        )}
                        {impact.canPermanentDelete && (
                          <span className="col-span-2 text-green-700">No linked records.</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-[#9CA3AF]">Archiving preserves all linked history.</p>
                    </div>
                  )}
                  {!profile.deleted_at && !profile.is_active && (
                    <form action={archiveUserAction} className="mt-3">
                      <input type="hidden" name="profile_id" value={profileId} />
                      <ActionButton
                        tone="red"
                        icon={<Archive className="h-4 w-4" />}
                        label="Archive user"
                        detail="Hides account and revokes sessions. History preserved."
                      />
                    </form>
                  )}
                  {!profile.deleted_at && profile.is_active && (
                    <div className="mt-3">
                      <DisabledActionRow
                        icon={<Archive className="h-4 w-4 text-[#9CA3AF]" />}
                        label="Archive user"
                        reason="Deactivate the account before archiving."
                      />
                    </div>
                  )}
                </>
              )}

              {isSuperAdminViewer && profile.deleted_at && (
                <form action={restoreUserAction} className="mt-3">
                  <input type="hidden" name="profile_id" value={profileId} />
                  <ActionButton
                    tone="green"
                    icon={<RotateCcw className="h-4 w-4" />}
                    label="Restore archived user"
                    detail="Clears archive flag. Account stays inactive until manually activated."
                  />
                </form>
              )}
            </Card>

            {isSuperAdminViewer && (
              <section className="rounded-md border border-red-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-black uppercase text-red-600">Danger Zone</h2>
                <p className="mb-3 text-xs text-[#4B5563]">Delete this user account permanently.</p>
                {isOwnAccount ? (
                  <DisabledActionRow
                    icon={<Trash2 className="h-4 w-4 text-[#9CA3AF]" />}
                    label="Delete User"
                    reason="You cannot delete your own account."
                  />
                ) : isLastSuperAdmin ? (
                  <DisabledActionRow
                    icon={<Trash2 className="h-4 w-4 text-[#9CA3AF]" />}
                    label="Delete User"
                    reason="Cannot delete the last System Administrator."
                  />
                ) : (
                  <DeleteUserDialog
                    profileId={profileId}
                    fullName={profile.full_name}
                    email={auth?.email ?? "No login account"}
                    roleLabel={isTargetSuperAdmin ? "System Administrator" : "Normal User"}
                    statusLabel={profile.deleted_at ? "Archived" : profile.is_active ? "Active" : "Inactive"}
                    lastLoginLabel={auth?.last_login_at ? formatExactDateTime(auth.last_login_at) : "Never"}
                    loginCount={displayLoginCount}
                  />
                )}
              </section>
            )}

          </div>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-black uppercase text-[#ED1C24]">{title}</h2>
      {children}
    </section>
  );
}

function DetailRow({
  label,
  value,
  highlight
}: {
  label: string;
  value: string;
  highlight?: "red" | "amber" | "blue";
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#F3F4F6] py-2 last:border-0">
      <span className="text-xs font-semibold text-[#4B5563]">{label}</span>
      <span
        className={cn(
          "text-right text-xs font-black",
          highlight === "red" && "text-red-700",
          highlight === "amber" && "text-amber-700",
          highlight === "blue" && "text-[#2563EB]",
          !highlight && "text-[#111827]"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  tone,
  icon,
  label,
  detail
}: {
  tone: "red" | "amber" | "green";
  icon: ReactNode;
  label: string;
  detail: string;
}) {
  return (
    <button
      type="submit"
      className={cn(
        "focus-ring flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
        tone === "red" && "border-red-200 bg-red-50 hover:border-red-400",
        tone === "amber" && "border-amber-200 bg-amber-50 hover:border-amber-400",
        tone === "green" && "border-green-200 bg-green-50 hover:border-green-400"
      )}
    >
      <span
        className={cn(
          "mt-0.5 shrink-0",
          tone === "red" && "text-red-600",
          tone === "amber" && "text-amber-600",
          tone === "green" && "text-green-600"
        )}
      >
        {icon}
      </span>
      <div>
        <p
          className={cn(
            "text-sm font-black",
            tone === "red" && "text-red-900",
            tone === "amber" && "text-amber-900",
            tone === "green" && "text-green-900"
          )}
        >
          {label}
        </p>
        <p className="mt-0.5 text-xs text-[#4B5563]">{detail}</p>
      </div>
    </button>
  );
}

function DisabledActionRow({ icon, label, reason }: { icon: ReactNode; label: string; reason: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3 opacity-50">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-sm font-black text-[#9CA3AF]">{label}</p>
        <p className="mt-0.5 text-xs text-[#9CA3AF]">{reason}</p>
      </div>
    </div>
  );
}

function Banner({
  tone,
  icon,
  message
}: {
  tone: "green" | "red";
  icon: ReactNode;
  message: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-4 py-3 text-sm font-semibold",
        tone === "green" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
      )}
    >
      {icon}
      {message}
    </div>
  );
}
