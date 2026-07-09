"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";

const CATEGORY_PAGE = "/admin/settings/asset-categories";

const nameSchema = z.string().trim().min(1).max(80);

export async function createMainCategoryAction(formData: FormData) {
  await requirePermission("assets.manage");
  const name = nameSchema.safeParse(formData.get("name"));
  if (!name.success) redirect(`${CATEGORY_PAGE}?error=invalid-name`);

  const maxOrder = await prisma.asset_categories.aggregate({
    where: { parent_id: null },
    _max: { sort_order: true },
  });
  const nextOrder = (maxOrder._max.sort_order ?? 0) + 1;

  try {
    await prisma.asset_categories.create({
      data: { name: name.data, parent_id: null, sort_order: nextOrder, is_active: true },
    });
  } catch {
    redirect(`${CATEGORY_PAGE}?error=name-exists`);
  }

  await writeAuditLog({
    actorId: (await requirePermission("assets.manage")).userId,
    action: "asset_category.create",
    entityType: "asset_category",
    entityId: null,
    summary: `Created main category: ${name.data}`,
    metadata: { name: name.data },
  });

  revalidatePath(CATEGORY_PAGE);
  redirect(CATEGORY_PAGE);
}

export async function createSubcategoryAction(formData: FormData) {
  const context = await requirePermission("assets.manage");
  const name = nameSchema.safeParse(formData.get("name"));
  const parentId = z.string().uuid().safeParse(formData.get("parent_id"));
  if (!name.success || !parentId.success) redirect(`${CATEGORY_PAGE}?error=invalid-input`);

  const parent = await prisma.asset_categories.findUnique({
    where: { id: parentId.data, parent_id: null },
  });
  if (!parent) redirect(`${CATEGORY_PAGE}?error=invalid-parent`);

  const maxOrder = await prisma.asset_categories.aggregate({
    where: { parent_id: parentId.data },
    _max: { sort_order: true },
  });
  const nextOrder = (maxOrder._max.sort_order ?? 0) + 1;

  try {
    await prisma.asset_categories.create({
      data: { name: name.data, parent_id: parentId.data, sort_order: nextOrder, is_active: true },
    });
  } catch {
    redirect(`${CATEGORY_PAGE}?error=name-exists`);
  }

  await writeAuditLog({
    actorId: context.userId,
    action: "asset_category.create",
    entityType: "asset_category",
    entityId: null,
    summary: `Created subcategory: ${name.data} under ${parent.name}`,
    metadata: { name: name.data, parent: parent.name },
  });

  revalidatePath(CATEGORY_PAGE);
  redirect(CATEGORY_PAGE);
}

export async function toggleCategoryActiveAction(formData: FormData) {
  const context = await requirePermission("assets.manage");
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect(`${CATEGORY_PAGE}?error=invalid-id`);

  const cat = await prisma.asset_categories.findUnique({ where: { id: id.data } });
  if (!cat) redirect(`${CATEGORY_PAGE}?error=not-found`);

  // Block deactivation of main category if it has active subcategories
  if (cat.parent_id === null && cat.is_active) {
    const activeChildren = await prisma.asset_categories.count({
      where: { parent_id: id.data, is_active: true },
    });
    if (activeChildren > 0) redirect(`${CATEGORY_PAGE}?error=has-active-children`);
  }

  await prisma.asset_categories.update({
    where: { id: id.data },
    data: { is_active: !cat.is_active, updated_at: new Date() },
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "asset_category.toggle",
    entityType: "asset_category",
    entityId: id.data,
    summary: `${cat.is_active ? "Deactivated" : "Activated"} category: ${cat.name}`,
    metadata: { name: cat.name, new_state: !cat.is_active },
  });

  revalidatePath(CATEGORY_PAGE);
  redirect(CATEGORY_PAGE);
}

export async function renameCategoryAction(formData: FormData) {
  const context = await requirePermission("assets.manage");
  const id = z.string().uuid().safeParse(formData.get("id"));
  const name = nameSchema.safeParse(formData.get("name"));
  if (!id.success || !name.success) redirect(`${CATEGORY_PAGE}?error=invalid-input`);

  const cat = await prisma.asset_categories.findUnique({ where: { id: id.data } });
  if (!cat) redirect(`${CATEGORY_PAGE}?error=not-found`);

  try {
    await prisma.asset_categories.update({
      where: { id: id.data },
      data: { name: name.data, updated_at: new Date() },
    });
  } catch {
    redirect(`${CATEGORY_PAGE}?error=name-exists`);
  }

  await writeAuditLog({
    actorId: context.userId,
    action: "asset_category.rename",
    entityType: "asset_category",
    entityId: id.data,
    summary: `Renamed category from "${cat.name}" to "${name.data}"`,
    metadata: { old_name: cat.name, new_name: name.data },
  });

  revalidatePath(CATEGORY_PAGE);
  redirect(CATEGORY_PAGE);
}

// Helper: load full active+inactive category tree (for pages and forms)
export type DbCategory = {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
  sort_order: number;
};

export async function loadAllCategories(): Promise<DbCategory[]> {
  return prisma.asset_categories.findMany({
    select: { id: true, name: true, parent_id: true, is_active: true, sort_order: true },
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
  });
}

export async function loadActiveCategories(): Promise<DbCategory[]> {
  return prisma.asset_categories.findMany({
    where: { is_active: true },
    select: { id: true, name: true, parent_id: true, is_active: true, sort_order: true },
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
  });
}
