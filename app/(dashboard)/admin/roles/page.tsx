import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

type RolePermission = {
  permissions:
    | {
        key: string;
        description: string;
      }
    | {
        key: string;
        description: string;
      }[]
    | null;
};

function permissionRecord(item: RolePermission) {
  if (Array.isArray(item.permissions)) {
    return item.permissions[0] ?? null;
  }

  return item.permissions;
}

type RoleWithPermissions = {
  id: string;
  name: string;
  description: string | null;
  role_permissions: RolePermission[] | null;
};

type PermissionDisplay = {
    key: string;
    description: string;
};

export default async function RolesPage() {
  await requirePermission("admin.roles.view");
  const roles = await prisma.roles.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      role_permissions: {
        select: {
          permissions: {
            select: { key: true, description: true }
          }
        }
      }
    },
    orderBy: { name: "asc" }
  });

  return (
    <>
      <PageHeader title="Roles" description="Review system roles and the permissions used by server-side route and action guards." />
      <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3 xl:p-6">
        {(roles as RoleWithPermissions[] | null)?.map((role) => (
          <section key={role.id} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#111827]">{role.name}</h2>
            <p className="mt-1 text-sm text-[#4B5563]">{role.description}</p>
            <div className="mt-4 space-y-2">
              {role.role_permissions?.map((item) => {
                const permission = permissionRecord(item) as PermissionDisplay | null;

                return permission ? (
                  <div key={permission.key} className="rounded-md border border-[#E5E7EB] px-3 py-2 text-sm">
                    <p className="font-semibold text-[#111827]">{permission.key}</p>
                    <p className="text-[#4B5563]">{permission.description}</p>
                  </div>
                ) : null;
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
