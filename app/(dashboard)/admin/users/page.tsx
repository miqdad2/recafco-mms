import type { Prisma } from "@prisma/client";
import { CreateUserDrawer } from "@/components/admin/create-user-drawer";
import { UsersDirectory } from "@/components/admin/users-directory";
import type { SerializedAuthUser, SerializedProfile } from "@/components/admin/users-directory";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { ACCOUNT_TYPE_SLUGS } from "@/lib/users/account-types";
import { AutoRefresh } from "@/components/auto-refresh";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";

const CREATE_USER_ERRORS = new Set([
  "duplicate-email",
  "duplicate-employee-number",
  "create-user-failed",
]);

const ERROR_LABELS: Record<string, string> = {
  "duplicate-email": "That username / email is already in use.",
  "duplicate-employee-number": "That employee number is already in use.",
  "create-user-failed": "Failed to create the user account. Please try again.",
  "update-failed": "Failed to save changes.",
  "not-found": "User not found.",
  "forbidden": "You do not have permission to perform this action.",
  "insufficient-permissions": "You do not have permission to perform this action.",
};

const SUCCESS_LABELS: Record<string, string> = {
  "user-created": "User account created successfully.",
  "user-deleted": "User Deleted — the user account has been permanently deleted.",
};

async function getAuthUsers(): Promise<SerializedAuthUser[]> {
  try {
    const rows = await prisma.auth_users.findMany({
      select: {
        profile_id: true,
        email: true,
        must_reset_password: true,
        last_login_at: true,
        last_active_at: true,
        login_count: true,
        failed_login_count: true,
        last_failed_login_at: true,
        locked_until: true,
      },
    });
    return rows.map((r) => ({
      profile_id: r.profile_id,
      email: r.email,
      must_reset_password: r.must_reset_password,
      last_login_at: r.last_login_at ? r.last_login_at.toISOString() : null,
      last_active_at: r.last_active_at ? r.last_active_at.toISOString() : null,
      login_count: r.login_count,
      failed_login_count: r.failed_login_count,
      last_failed_login_at: r.last_failed_login_at ? r.last_failed_login_at.toISOString() : null,
      locked_until: r.locked_until ? r.locked_until.toISOString() : null,
    }));
  } catch {
    return [];
  }
}

function isSameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const context = await requirePermission("admin.users.manage");
  const sp = (await searchParams) ?? {};
  const isSuperAdmin = context.role?.slug === "super_admin";

  // Performance Optimization Unit 3, Task 6: UsersDirectory filters/tabs
  // (All/Active/Inactive/Logged In Today/Never Logged In/Archived) all run
  // client-side over the full loaded list (see components/admin/users-
  // directory.tsx) — there's no server-side pagination to move this behind,
  // so the real win here is trimming the query to exactly the columns
  // SerializedProfile actually uses instead of `SELECT *`.
  const profileSelect = {
    id: true,
    full_name: true,
    employee_number: true,
    phone: true,
    job_title: true,
    department_id: true,
    can_view_costs: true,
    is_active: true,
    role_id: true,
  } as const;

  const [nonArchivedProfilesRaw, archivedProfilesRaw, roles, authUsers] =
    await Promise.all([
      prisma.profiles.findMany({
        where: { deleted_at: null },
        orderBy: { full_name: "asc" },
        select: profileSelect,
      }),
      isSuperAdmin
        ? prisma.profiles.findMany({
            where: { deleted_at: { not: null } },
            orderBy: { full_name: "asc" },
            select: profileSelect,
          })
        : Promise.resolve([] as Array<Prisma.profilesGetPayload<{ select: typeof profileSelect }>>),
      prisma.roles.findMany({
        where: { slug: { in: ACCOUNT_TYPE_SLUGS } },
        select: { id: true, slug: true },
      }),
      getAuthUsers(),
    ]);

  const serialize = (
    p: (typeof nonArchivedProfilesRaw)[number],
    archived: boolean
  ): SerializedProfile => ({
    id: p.id,
    full_name: p.full_name,
    employee_number: p.employee_number,
    phone: p.phone,
    job_title: p.job_title,
    department_id: p.department_id,
    can_view_costs: p.can_view_costs,
    is_active: p.is_active,
    role_id: p.role_id,
    is_archived: archived,
  });

  const profiles: SerializedProfile[] = [
    ...nonArchivedProfilesRaw.map((p) => serialize(p, false)),
    ...archivedProfilesRaw.map((p) => serialize(p, true)),
  ];

  const authByProfileId = new Map(authUsers.map((a) => [a.profile_id, a]));
  const now = new Date();

  const totalCount = nonArchivedProfilesRaw.length;
  const activeCount = nonArchivedProfilesRaw.filter((p) => p.is_active).length;
  const loggedInTodayCount = nonArchivedProfilesRaw.filter((p) => {
    const lastLogin = authByProfileId.get(p.id)?.last_login_at;
    return lastLogin != null && isSameCalendarDay(new Date(lastLogin), now);
  }).length;
  const neverLoggedInCount = nonArchivedProfilesRaw.filter(
    (p) => !authByProfileId.get(p.id)?.last_login_at
  ).length;
  const lockedCount = nonArchivedProfilesRaw.filter((p) => {
    const lockedUntil = authByProfileId.get(p.id)?.locked_until;
    return lockedUntil != null && new Date(lockedUntil) > now;
  }).length;

  const successMessage = sp.success ? (SUCCESS_LABELS[sp.success] ?? null) : null;
  const errorMessage = sp.error ? (ERROR_LABELS[sp.error] ?? "An error occurred.") : null;

  return (
    <>
      {/* Enterprise-Wide Real-Time Update Verification Task 3/8: user.created/
          user.updated were already emitted (app/actions/admin.ts) but nothing
          on this page ever consumed them — Super Admin monitoring this page
          in one tab never saw another admin's change without reloading. The
          existing isModalOpen guard already keeps this safe while the Create
          User drawer is open. */}
      <AutoRefresh intervalMs={20000} />
      <RealtimeRefresh watch={["user."]} />
      <PageHeader
        title="Users"
        description="Create user accounts and manage system access."
        actions={
          <CreateUserDrawer initialOpen={!!(sp.error && CREATE_USER_ERRORS.has(sp.error))} />
        }
      />

      <div className="space-y-4 p-4 xl:p-6">
        {/* Inline banners */}
        {successMessage && (
          <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
            {successMessage}
          </div>
        )}
        {errorMessage && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {errorMessage}
          </div>
        )}

        {/* KPI cards — login-adoption monitoring, 2-col mobile, 5-col lg+ */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-md border border-[#DDE2EA] bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
              Total Users
            </p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{totalCount}</p>
          </div>
          <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-green-700">
              Active Users
            </p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{activeCount}</p>
            <p className="mt-0.5 text-[10px] text-green-700/80">Can access the system</p>
          </div>
          <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">
              Logged In Today
            </p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{loggedInTodayCount}</p>
            <p className="mt-0.5 text-[10px] text-blue-700/80">Users who logged in today</p>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">
              Never Logged In
            </p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{neverLoggedInCount}</p>
            <p className="mt-0.5 text-[10px] text-amber-700/80">Accounts not used yet</p>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-red-700">
              Locked Accounts
            </p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{lockedCount}</p>
            <p className="mt-0.5 text-[10px] text-red-700/80">Blocked after failed attempts</p>
          </div>
        </div>

        {/* Directory */}
        <UsersDirectory
          profiles={profiles}
          authUsers={authUsers}
          roles={roles}
          isSuperAdmin={isSuperAdmin}
        />
      </div>
    </>
  );
}
