import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  LogOut,
  RotateCcw,
  Shield,
  ShieldCheck,
  ShieldOff,
  User,
  UserCheck,
  UserX,
  XCircle
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  addPermissionOverrideAction,
  archiveUserAction,
  changeUserDepartmentAction,
  changeUserRoleAction,
  removePermissionOverrideAction,
  restoreUserAction,
  revokeUserSessionsAction,
  toggleUserActiveAction,
  unlockUserAccountAction
} from "@/app/actions/user-access";
import { resetUserPasswordAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { permissions as permissionDefinitions, roleLabels } from "@/lib/permissions/definitions";
import { cn, formatDateTime } from "@/lib/utils";
import { getUserDeletionImpact } from "@/lib/user-lifecycle/impact";
import type { PermissionKey, RoleSlug } from "@/types/database";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Types ─────────────────────────────────────────────────────────────────────

type AuthRow = {
  email: string;
  last_login_at: Date | null;
  failed_login_count: number;
  locked_until: Date | null;
  must_reset_password: boolean;
  password_changed_at: Date | null;
  temporary_password_set_at: Date | null;
};

type OverrideRow = {
  id: string;
  permission_key: string;
  override_type: "allow" | "deny";
  reason: string | null;
  created_at: Date;
  creator_name: string | null;
};

type RolePermRow = { key: string };
type RoleRow = { id: string; name: string; slug: string };
type DeptRow = { id: string; name: string };

type EffectivePermission = {
  key: PermissionKey;
  description: string;
  source: "super_admin" | "role" | "user_allow" | "user_deny" | "not_granted";
  allowed: boolean;
};

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadUserData(profileId: string) {
  const profile = await prisma.profiles.findUnique({
    where: { id: profileId },
    include: { departments: true, roles: true }
  });

  if (!profile) return null;

  const [authRows, activeSessions, overrideRows, rolePermRows, roles, departments, impact] =
    await Promise.all([
      prisma.$queryRaw<AuthRow[]>`
        select
          email,
          last_login_at,
          failed_login_count,
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
      prisma.$queryRaw<OverrideRow[]>`
        select
          upo.id,
          upo.permission_key,
          upo.override_type,
          upo.reason,
          upo.created_at,
          p.full_name as creator_name
        from public.user_permission_overrides upo
        left join public.profiles p on p.id = upo.created_by
        where upo.profile_id = ${profileId}::uuid
        order by upo.permission_key, upo.override_type
      `,
      profile.role_id
        ? prisma.$queryRaw<RolePermRow[]>`
            select pm.key
            from public.role_permissions rp
            join public.permissions pm on pm.id = rp.permission_id
            where rp.role_id = ${profile.role_id}::uuid
          `
        : Promise.resolve<RolePermRow[]>([]),
      prisma.$queryRaw<RoleRow[]>`select id, name, slug from public.roles order by name`,
      prisma.$queryRaw<DeptRow[]>`
        select id, name from public.departments where is_active = true order by name
      `,
      getUserDeletionImpact(profileId)
    ]);

  return { profile, auth: authRows[0] ?? null, activeSessions, overrideRows, rolePermRows, roles, departments, impact };
}

// ── Effective permission computation ─────────────────────────────────────────

function computeEffectivePermissions(
  roleSlug: string | null,
  rolePermRows: RolePermRow[],
  overrideRows: OverrideRow[]
): EffectivePermission[] {
  const isSuperAdmin = roleSlug === "super_admin";
  const roleSet = new Set(rolePermRows.map((r) => r.key));
  const allowSet = new Set(overrideRows.filter((o) => o.override_type === "allow").map((o) => o.permission_key));
  const denySet = new Set(overrideRows.filter((o) => o.override_type === "deny").map((o) => o.permission_key));

  return (Object.keys(permissionDefinitions) as PermissionKey[]).map((key) => {
    if (isSuperAdmin) {
      return { key, description: permissionDefinitions[key], source: "super_admin" as const, allowed: true };
    }
    // Deny always wins.
    if (denySet.has(key)) {
      return { key, description: permissionDefinitions[key], source: "user_deny" as const, allowed: false };
    }
    if (allowSet.has(key)) {
      return { key, description: permissionDefinitions[key], source: "user_allow" as const, allowed: true };
    }
    if (roleSet.has(key)) {
      return { key, description: permissionDefinitions[key], source: "role" as const, allowed: true };
    }
    return { key, description: permissionDefinitions[key], source: "not_granted" as const, allowed: false };
  });
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

  const { profile, auth, activeSessions, overrideRows, rolePermRows, roles, departments, impact } = data;

  const isOwnAccount = context.userId === profileId;
  const isSuperAdminViewer = context.role?.slug === "super_admin";
  const targetRoleSlug = profile.roles?.slug ?? null;
  const isTargetSuperAdmin = targetRoleSlug === "super_admin";
  const canManageOverrides = isSuperAdminViewer && !isTargetSuperAdmin;

  const isLocked = auth?.locked_until != null && new Date(auth.locked_until) > new Date();
  const effectivePermissions = computeEffectivePermissions(targetRoleSlug, rolePermRows, overrideRows);

  const successMessages: Record<string, string> = {
    "role-changed": "Role updated.",
    "department-changed": "Department updated.",
    activated: "Account activated.",
    deactivated: "Account deactivated and all sessions revoked.",
    unlocked: "Account unlocked and failed login counter reset.",
    "sessions-revoked": "All active sessions have been revoked.",
    "override-added": "Permission override added.",
    "override-removed": "Permission override removed.",
    "password-reset": "Password reset. User must change password on next login. All sessions revoked."
  };

  const errorMessages: Record<string, string> = {
    "cannot-change-own-super-admin": "You cannot change your own Super Admin role.",
    "cannot-deactivate-self": "You cannot deactivate your own account.",
    "cannot-modify-super-admin": "Only Super Admin can modify Super Admin accounts.",
    "cannot-override-super-admin": "Permission overrides cannot be applied to Super Admin accounts.",
    "insufficient-permissions": "Only Super Admin can manage permission overrides.",
    "invalid-input": "Invalid request. Please try again.",
    "passwords-mismatch": "New password and confirmation do not match.",
    "cannot-reset-own-password": "Use /change-password to change your own password.",
    "no-login-account": "This profile has no login account. Create one from the Users page."
  };

  return (
    <>
      <PageHeader
        title={profile.full_name}
        description={`User access control · ${auth?.email ?? "No login account"}`}
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
              <StatusBadge label={roleLabels[profile.roles.slug as RoleSlug] ?? profile.roles.name} tone="blue" />
            ) : (
              <StatusBadge label="No role" tone="gray" />
            )}
            {isOwnAccount && <StatusBadge label="Your account" tone="amber" />}
          </div>
        </section>

        {/* Two-column layout */}
        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
          {/* Left: Profile details + quick actions */}
          <div className="space-y-4">
            {/* Profile details */}
            <Card title="Profile details">
              <DetailRow label="Full name" value={profile.full_name} />
              <DetailRow label="Employee number" value={profile.employee_number ?? "Not recorded"} />
              <DetailRow label="Job title" value={profile.job_title ?? "Not recorded"} />
              <DetailRow label="Phone" value={profile.phone ?? "Not recorded"} />
              <DetailRow label="Department" value={profile.departments?.name ?? "Not assigned"} />
              <DetailRow label="Role" value={profile.roles ? (roleLabels[profile.roles.slug as RoleSlug] ?? profile.roles.name) : "No role assigned"} />
              <DetailRow label="Cost visibility" value={profile.can_view_costs ? "Allowed" : "Restricted"} />
              <DetailRow label="Profile created" value={formatDateTime(profile.created_at.toISOString())} />
            </Card>

            {/* Auth & security details */}
            <Card title="Authentication and security">
              <DetailRow label="Login email" value={auth?.email ?? "No local login account"} />
              <DetailRow label="Last login" value={auth?.last_login_at ? formatDateTime(auth.last_login_at.toISOString()) : "Never"} />
              <DetailRow
                label="Password changed"
                value={auth?.password_changed_at ? formatDateTime(auth.password_changed_at.toISOString()) : "Not yet changed"}
              />
              <DetailRow
                label="Temp password set"
                value={auth?.temporary_password_set_at ? formatDateTime(auth.temporary_password_set_at.toISOString()) : "No"}
                highlight={auth?.temporary_password_set_at ? "amber" : undefined}
              />
              <DetailRow
                label="Must reset password"
                value={auth?.must_reset_password ? "Yes — user will be prompted on next login" : "No"}
                highlight={auth?.must_reset_password ? "amber" : undefined}
              />
              <DetailRow
                label="Failed logins"
                value={auth?.failed_login_count != null ? String(auth.failed_login_count) : "—"}
                highlight={auth?.failed_login_count != null && auth.failed_login_count > 0 ? "amber" : undefined}
              />
              <DetailRow
                label="Account locked"
                value={isLocked ? `Until ${formatDateTime(auth!.locked_until!.toISOString())}` : "No"}
                highlight={isLocked ? "red" : undefined}
              />
              <DetailRow
                label="Active sessions"
                value={String(activeSessions)}
                highlight={activeSessions > 0 ? "blue" : undefined}
              />
            </Card>

            {/* Reset password */}
            {auth ? (
              <Card title="Reset password">
                {isOwnAccount ? (
                  <div className="space-y-2">
                    <p className="text-sm text-[#4B5563]">
                      To change your own password, use the forced change flow by logging out and back in,
                      or ask another Super Admin to reset it for you.
                    </p>
                  </div>
                ) : (
                  <form action={resetUserPasswordAction} className="space-y-3">
                    <input type="hidden" name="profile_id" value={profileId} />
                    <p className="text-sm text-[#4B5563]">
                      Sets a new temporary password. The user must change it on next login.
                      All active sessions are revoked immediately.
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

            {/* Change role */}
            <Card title="Change role">
              {isTargetSuperAdmin && isOwnAccount ? (
                <p className="text-sm text-[#4B5563]">You cannot change your own Super Admin role.</p>
              ) : isTargetSuperAdmin && !isSuperAdminViewer ? (
                <p className="text-sm text-[#4B5563]">Only Super Admin can change a Super Admin&apos;s role.</p>
              ) : (
                <form action={changeUserRoleAction} className="flex items-end gap-2">
                  <input type="hidden" name="profile_id" value={profileId} />
                  <label className="flex-1">
                    <span className="text-xs font-bold uppercase text-[#4B5563]">New role</span>
                    <select
                      name="role_id"
                      defaultValue={profile.role_id ?? ""}
                      className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    >
                      <option value="">No role</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {roleLabels[r.slug as RoleSlug] ?? r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button type="submit" variant="secondary">Save</Button>
                </form>
              )}
            </Card>

            {/* Change department */}
            <Card title="Change department">
              <form action={changeUserDepartmentAction} className="flex items-end gap-2">
                <input type="hidden" name="profile_id" value={profileId} />
                <label className="flex-1">
                  <span className="text-xs font-bold uppercase text-[#4B5563]">Department</span>
                  <select
                    name="department_id"
                    defaultValue={profile.department_id ?? ""}
                    className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                  >
                    <option value="">Not assigned</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" variant="secondary">Save</Button>
              </form>
            </Card>

            {/* Quick actions */}
            <Card title="Account actions">
              <div className="space-y-3">
                {/* Activate / Deactivate */}
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

                {/* Unlock */}
                {isLocked ? (
                  <form action={unlockUserAccountAction}>
                    <input type="hidden" name="profile_id" value={profileId} />
                    <ActionButton
                      tone="amber"
                      icon={<Lock className="h-4 w-4" />}
                      label="Unlock account"
                      detail="Clears the lockout timer and resets the failed login counter."
                    />
                  </form>
                ) : (
                  <DisabledActionRow
                    icon={<Lock className="h-4 w-4 text-[#9CA3AF]" />}
                    label="Unlock account"
                    reason="Account is not currently locked."
                  />
                )}

                {/* Revoke sessions */}
                <form action={revokeUserSessionsAction}>
                  <input type="hidden" name="profile_id" value={profileId} />
                  <ActionButton
                    tone="amber"
                    icon={<LogOut className="h-4 w-4" />}
                    label={`Revoke all sessions (${activeSessions} active)`}
                    detail={isOwnAccount ? "This will also sign you out." : "User will be logged out immediately."}
                  />
                </form>
              </div>

              {/* ── Archive / Restore (Super Admin only) ──────────────────── */}
              {isSuperAdminViewer && !isOwnAccount && !isTargetSuperAdmin && (
                <>
                  {/* Impact summary — always show for non-archived deactivated users */}
                  {!profile.deleted_at && !profile.is_active && (
                    <div className="rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
                        Linked business records
                      </p>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-[#6B7280]">
                        {impact.workOrdersCreated > 0 && (
                          <span>{impact.workOrdersCreated} work order{impact.workOrdersCreated !== 1 ? "s" : ""}</span>
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
                        {impact.purchaseRequestsLinked > 0 && (
                          <span>{impact.purchaseRequestsLinked} purchase request{impact.purchaseRequestsLinked !== 1 ? "s" : ""}</span>
                        )}
                        {impact.canPermanentDelete && (
                          <span className="col-span-2 text-green-700">No linked records.</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-[#9CA3AF]">
                        Archiving preserves all linked history. Nothing is deleted.
                      </p>
                    </div>
                  )}

                  {/* Archive — only when deactivated and not yet archived */}
                  {!profile.deleted_at && !profile.is_active && (
                    <form action={archiveUserAction}>
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
                    <DisabledActionRow
                      icon={<Archive className="h-4 w-4 text-[#9CA3AF]" />}
                      label="Archive user"
                      reason="Deactivate the account before archiving."
                    />
                  )}
                </>
              )}

              {/* Restore — Super Admin only; not own account check irrelevant (can't archive self) */}
              {isSuperAdminViewer && profile.deleted_at && (
                <form action={restoreUserAction}>
                  <input type="hidden" name="profile_id" value={profileId} />
                  <ActionButton
                    tone="green"
                    icon={<RotateCcw className="h-4 w-4" />}
                    label="Restore archived user"
                    detail="Clears archive flag. Account stays inactive until manually activated."
                  />
                </form>
              )}

              {/* Impersonation note */}
              <div className="mt-4 rounded-md border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-3">
                <p className="text-xs font-black uppercase text-[#4B5563]">Login as user — future feature</p>
                <p className="mt-1 text-xs leading-5 text-[#6B7280]">
                  Impersonation is not implemented. When added, it must create a dedicated
                  audit log entry and the impersonated session must be visually distinct.
                </p>
              </div>
            </Card>
          </div>

          {/* Right: Effective permissions + overrides */}
          <div className="space-y-4">
            {/* Permission overrides manager */}
            {canManageOverrides ? (
              <Card title="Add permission override">
                <p className="mb-3 text-sm text-[#4B5563]">
                  Allow overrides grant additional permissions. Deny overrides remove permissions the role would normally grant.
                  Super Admin always retains full access regardless of overrides.
                </p>
                <form action={addPermissionOverrideAction} className="grid gap-3 sm:grid-cols-[1fr_120px_120px_auto]">
                  <input type="hidden" name="profile_id" value={profileId} />
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-[#4B5563]">Permission</span>
                    <select
                      name="permission_key"
                      className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                      defaultValue=""
                    >
                      <option value="" disabled>Select permission</option>
                      {(Object.keys(permissionDefinitions) as PermissionKey[]).map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-[#4B5563]">Type</span>
                    <select
                      name="override_type"
                      className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    >
                      <option value="allow">Allow</option>
                      <option value="deny">Deny</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase text-[#4B5563]">Reason</span>
                    <input
                      name="reason"
                      className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                      placeholder="Optional"
                      maxLength={500}
                    />
                  </label>
                  <div className="flex items-end">
                    <Button type="submit" className="w-full">Add</Button>
                  </div>
                </form>
              </Card>
            ) : isTargetSuperAdmin ? (
              <div className="rounded-md border border-dashed border-[#E5E7EB] bg-[#F8FAFC] p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[#16A34A]" aria-hidden="true" />
                  <p className="text-sm font-black text-[#111827]">Super Admin — overrides not applicable</p>
                </div>
                <p className="mt-1 text-sm text-[#4B5563]">
                  Super Admin always retains full access. Permission overrides cannot be applied to this account.
                </p>
              </div>
            ) : null}

            {/* Active overrides */}
            {overrideRows.length > 0 && (
              <Card title={`Active overrides (${overrideRows.length})`}>
                <div className="space-y-2">
                  {overrideRows.map((o) => (
                    <div key={o.id} className={cn(
                      "flex items-start gap-3 rounded-md border p-3",
                      o.override_type === "allow" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
                    )}>
                      <span className={cn("mt-0.5", o.override_type === "allow" ? "text-green-600" : "text-red-600")}>
                        {o.override_type === "allow" ? (
                          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ShieldOff className="h-4 w-4" aria-hidden="true" />
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-xs font-black text-[#111827]">{o.permission_key}</p>
                        <p className="mt-0.5 text-xs text-[#4B5563]">
                          {o.override_type === "allow" ? "Allow" : "Deny"} · Added by {o.creator_name ?? "system"} · {formatDateTime(o.created_at.toISOString())}
                        </p>
                        {o.reason && <p className="mt-1 text-xs italic text-[#4B5563]">{o.reason}</p>}
                      </div>
                      {canManageOverrides && (
                        <form action={removePermissionOverrideAction}>
                          <input type="hidden" name="override_id" value={o.id} />
                          <input type="hidden" name="profile_id" value={profileId} />
                          <button
                            type="submit"
                            className="focus-ring rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-xs font-bold text-[#DC2626] hover:border-[#DC2626]"
                          >
                            Remove
                          </button>
                        </form>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Effective permissions table */}
            <Card title="Effective permissions">
              <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold text-[#4B5563]">
                <span className="flex items-center gap-1"><Shield className="h-3 w-3 text-[#16A34A]" /> role</span>
                <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-green-600" /> user allow</span>
                <span className="flex items-center gap-1"><ShieldOff className="h-3 w-3 text-red-600" /> user deny</span>
                <span className="flex items-center gap-1"><KeyRound className="h-3 w-3 text-[#2563EB]" /> super admin</span>
                <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-[#9CA3AF]" /> not granted</span>
              </div>
              <div className="overflow-x-auto rounded-md border border-[#E5E7EB]">
                <table className="w-full min-w-[540px] text-left text-sm">
                  <thead className="bg-[#F8FAFC] text-xs uppercase text-[#4B5563]">
                    <tr>
                      <th className="px-3 py-2">Permission</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2 text-center">Access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {effectivePermissions.map((ep) => (
                      <tr key={ep.key} className={ep.allowed ? "" : "opacity-50"}>
                        <td className="px-3 py-2 font-mono text-xs font-black text-[#111827]">{ep.key}</td>
                        <td className="px-3 py-2 text-xs text-[#4B5563]">{ep.description}</td>
                        <td className="px-3 py-2">
                          <SourceBadge source={ep.source} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          {ep.allowed ? (
                            <CheckCircle2 className="mx-auto h-4 w-4 text-[#16A34A]" aria-hidden="true" />
                          ) : (
                            <XCircle className="mx-auto h-4 w-4 text-[#9CA3AF]" aria-hidden="true" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
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

function SourceBadge({ source }: { source: EffectivePermission["source"] }) {
  const map = {
    super_admin: { label: "super admin", className: "bg-blue-50 text-blue-700 border border-blue-200" },
    role: { label: "role", className: "bg-green-50 text-green-700 border border-green-200" },
    user_allow: { label: "user allow", className: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
    user_deny: { label: "user deny", className: "bg-red-50 text-red-700 border border-red-200" },
    not_granted: { label: "not granted", className: "bg-gray-50 text-gray-400 border border-gray-200" }
  };
  const { label, className } = map[source];
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs font-black", className)}>{label}</span>
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
