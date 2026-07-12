import { CreateUserDrawer } from "@/components/admin/create-user-drawer";
import { UsersDirectory } from "@/components/admin/users-directory";
import type { SerializedAuthUser, SerializedProfile } from "@/components/admin/users-directory";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

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
};

async function getAuthUsers(): Promise<SerializedAuthUser[]> {
  try {
    const rows = await prisma.auth_users.findMany({
      select: {
        profile_id: true,
        email: true,
        must_reset_password: true,
      },
    });
    return rows.map((r) => ({
      profile_id: r.profile_id,
      email: r.email,
      must_reset_password: r.must_reset_password,
    }));
  } catch {
    return [];
  }
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

  const [nonArchivedProfilesRaw, archivedProfilesRaw, roles, authUsers] =
    await Promise.all([
      prisma.profiles.findMany({
        where: { deleted_at: null },
        orderBy: { full_name: "asc" },
      }),
      isSuperAdmin
        ? prisma.profiles.findMany({
            where: { deleted_at: { not: null } },
            orderBy: { full_name: "asc" },
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof prisma.profiles.findMany>>),
      prisma.roles.findMany({
        where: {
          slug: {
            in: [
              "super_admin",
              "maintenance_data_entry",
              "maintenance_manager",
              "technician",
              "store_keeper",
              "viewer_auditor",
            ],
          },
        },
        select: { id: true, slug: true },
      }),
      getAuthUsers(),
    ]);

  const superAdminRoleId = roles.find((r) => r.slug === "super_admin")?.id ?? "";

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

  const totalCount = nonArchivedProfilesRaw.length;
  const activeCount = nonArchivedProfilesRaw.filter((p) => p.is_active).length;
  const sysAdminCount = nonArchivedProfilesRaw.filter(
    (p) => p.role_id === superAdminRoleId
  ).length;
  const normalUserCount = totalCount - sysAdminCount;

  const successMessage =
    sp.success === "user-created" ? "User account created successfully." : null;
  const errorMessage = sp.error ? (ERROR_LABELS[sp.error] ?? "An error occurred.") : null;

  return (
    <>
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

        {/* KPI cards — compact, 2-col mobile, 4-col sm+ */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-[#DDE2EA] bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
              Total Users
            </p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{totalCount}</p>
          </div>
          <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-green-700">
              Active
            </p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{activeCount}</p>
          </div>
          <div className="rounded-md border border-[#DDE2EA] bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
              Sys Admins
            </p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{sysAdminCount}</p>
          </div>
          <div className="rounded-md border border-[#DDE2EA] bg-white px-4 py-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#4B5563]">
              Normal Users
            </p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{normalUserCount}</p>
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
