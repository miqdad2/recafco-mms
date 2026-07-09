import Link from "next/link";
import { ChevronRight, FolderOpen, Layers, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  createMainCategoryAction,
  createSubcategoryAction,
  toggleCategoryActiveAction,
  renameCategoryAction,
} from "@/app/actions/asset-categories";

const ERROR_MESSAGES: Record<string, string> = {
  "invalid-name": "Category name is required and must be under 80 characters.",
  "invalid-input": "Invalid input. Please check the form and try again.",
  "invalid-parent": "The selected main category does not exist.",
  "invalid-id": "Invalid category identifier.",
  "not-found": "Category not found.",
  "name-exists": "A category with that name already exists at this level.",
  "has-active-children": "Deactivate all subcategories before deactivating this main category.",
};

export default async function AssetCategoriesPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  await requirePermission("assets.manage");
  const params = await searchParams;
  const errorMsg = params?.error ? (ERROR_MESSAGES[params.error] ?? "An error occurred.") : null;

  const [allCategories, assetsByCategory] = await Promise.all([
    prisma.asset_categories.findMany({
      select: { id: true, name: true, parent_id: true, is_active: true, sort_order: true },
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    }),
    prisma.assets.groupBy({
      by: ["category"],
      where: { deleted_at: null },
      _count: { _all: true },
    }),
  ]);

  // Map: category name lower-case → asset count
  const assetCountMap = new Map<string, number>();
  for (const row of assetsByCategory) {
    assetCountMap.set(row.category.toLowerCase(), row._count._all);
  }

  const mainCategories = allCategories.filter((c) => c.parent_id === null);
  const subcatsByParent = new Map<string, typeof allCategories>();
  for (const c of allCategories) {
    if (c.parent_id) {
      const list = subcatsByParent.get(c.parent_id) ?? [];
      list.push(c);
      subcatsByParent.set(c.parent_id, list);
    }
  }

  // Total asset count for a main category = sum of all its subcategories + legacy assets stored under main cat name
  function mainCatAssetCount(mainName: string, subs: typeof allCategories): number {
    const direct = assetCountMap.get(mainName.toLowerCase()) ?? 0;
    const fromSubs = subs.reduce((n, s) => n + (assetCountMap.get(s.name.toLowerCase()) ?? 0), 0);
    return direct + fromSubs;
  }

  const totalMain    = mainCategories.length;
  const totalSub     = allCategories.filter((c) => c.parent_id !== null).length;
  const totalActive  = allCategories.filter((c) => c.is_active).length;
  const totalAssets  = [...assetCountMap.values()].reduce((n, v) => n + v, 0);

  return (
    <>
      <PageHeader
        title="Asset Categories"
        description="Manage main categories and subcategories used in the asset register."
        actions={
          <Link href="/admin/settings">
            <Button variant="secondary" className="gap-1.5">
              <ChevronRight className="h-4 w-4 rotate-180" aria-hidden="true" />
              Back to Settings
            </Button>
          </Link>
        }
      />

      <div className="p-4 lg:p-6 space-y-5">

        {/* Error banner */}
        {errorMsg && (
          <div className="rounded-md border border-[#ED1C24] bg-red-50 px-4 py-3 text-sm font-semibold text-[#ED1C24]">
            {errorMsg}
          </div>
        )}

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm text-center">
            <p className="text-2xl font-black text-[#111827]">{totalMain}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Main Categories</p>
          </div>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm text-center">
            <p className="text-2xl font-black text-[#111827]">{totalSub}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Subcategories</p>
          </div>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm text-center">
            <p className="text-2xl font-black text-[#16A34A]">{totalActive}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Active</p>
          </div>
          <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm text-center">
            <p className="text-2xl font-black text-[#111827]">{totalAssets}</p>
            <p className="mt-1 text-xs font-semibold text-[#4B5563]">Total Assets</p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">

          {/* ── Left: Create forms ─────────────────────────────────────────── */}
          <div className="space-y-4">
            {/* Create main category */}
            <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
              <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
                <p className="text-xs font-black uppercase text-[#4B5563]">New Main Category</p>
              </div>
              <form action={createMainCategoryAction} className="p-4 space-y-3">
                <label className="block">
                  <span className="text-sm font-semibold text-[#111827]">Category name</span>
                  <input
                    className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="name"
                    placeholder="e.g. Marine Equipment"
                    required
                    maxLength={80}
                  />
                </label>
                <Button type="submit" className="w-full gap-2">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Main Category
                </Button>
              </form>
            </section>

            {/* Create subcategory */}
            <section className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
              <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
                <p className="text-xs font-black uppercase text-[#4B5563]">New Subcategory</p>
              </div>
              <form action={createSubcategoryAction} className="p-4 space-y-3">
                <label className="block">
                  <span className="text-sm font-semibold text-[#111827]">Main category</span>
                  <select
                    className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="parent_id"
                    required
                  >
                    <option value="">Select main category…</option>
                    {mainCategories.filter((m) => m.is_active).map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[#111827]">Subcategory name</span>
                  <input
                    className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
                    name="name"
                    placeholder="e.g. Patrol Boat"
                    required
                    maxLength={80}
                  />
                </label>
                <Button type="submit" className="w-full gap-2">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Subcategory
                </Button>
              </form>
            </section>

            {/* Instructions */}
            <div className="rounded-md border border-[#E5E7EB] bg-[#F5F6F8] p-4 text-xs text-[#4B5563] space-y-1.5">
              <p className="font-bold text-[#111827]">How categories work</p>
              <p>Assets are assigned a <strong>subcategory</strong> which belongs to a main category.</p>
              <p>Deactivating a category hides it from asset forms but does not affect existing assets.</p>
              <p>You cannot hard-delete a category — deactivate it instead.</p>
            </div>
          </div>

          {/* ── Right: Category tree ───────────────────────────────────────── */}
          <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
              <p className="text-xs font-black uppercase text-[#4B5563]">Category Tree</p>
              <p className="mt-0.5 text-xs text-[#9CA3AF]">{totalMain} main categories · {totalSub} subcategories</p>
            </div>

            {mainCategories.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[#9CA3AF]">
                No categories yet. Add the first main category above.
              </div>
            ) : (
              <div className="divide-y divide-[#E5E7EB]">
                {mainCategories.map((main) => {
                  const subs = subcatsByParent.get(main.id) ?? [];
                  const mainCount = mainCatAssetCount(main.name, subs);
                  return (
                    <div key={main.id} className={main.is_active ? "" : "opacity-50"}>
                      {/* Main category row */}
                      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50">
                        <FolderOpen className="h-4 w-4 shrink-0 text-[#4B5563]" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-[#111827] truncate">{main.name}</p>
                            {mainCount > 0 && (
                              <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-bold text-[#4B5563]">
                                {mainCount}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-[#9CA3AF]">
                            {subs.length} subcategor{subs.length === 1 ? "y" : "ies"}
                            {!main.is_active && " · Inactive"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {/* Rename */}
                          <RenameForm id={main.id} currentName={main.name} />
                          {/* Toggle */}
                          <form action={toggleCategoryActiveAction}>
                            <input type="hidden" name="id" value={main.id} />
                            <button
                              type="submit"
                              title={main.is_active ? "Deactivate" : "Activate"}
                              className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1.5 text-xs font-semibold text-[#4B5563] hover:bg-gray-100"
                            >
                              {main.is_active
                                ? <ToggleRight className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
                                : <ToggleLeft className="h-3.5 w-3.5" aria-hidden="true" />}
                              {main.is_active ? "Active" : "Inactive"}
                            </button>
                          </form>
                        </div>
                      </div>

                      {/* Subcategory rows */}
                      {subs.map((sub) => {
                        const subCount = assetCountMap.get(sub.name.toLowerCase()) ?? 0;
                        return (
                        <div
                          key={sub.id}
                          className={`flex items-center gap-3 pl-10 pr-4 py-2.5 border-t border-[#F3F4F6] ${sub.is_active ? "" : "opacity-60"}`}
                        >
                          <Layers className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
                          <div className="flex flex-1 items-center gap-1.5 min-w-0">
                            <p className="text-sm text-[#111827] truncate">{sub.name}</p>
                            {subCount > 0 && (
                              <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-[#9CA3AF]">
                                {subCount}
                              </span>
                            )}
                          </div>
                          {!sub.is_active && (
                            <span className="text-[10px] font-bold text-[#9CA3AF] uppercase">Inactive</span>
                          )}
                          <div className="flex shrink-0 items-center gap-2">
                            <RenameForm id={sub.id} currentName={sub.name} small />
                            <form action={toggleCategoryActiveAction}>
                              <input type="hidden" name="id" value={sub.id} />
                              <button
                                type="submit"
                                title={sub.is_active ? "Deactivate" : "Activate"}
                                className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 text-[10px] font-semibold text-[#4B5563] hover:bg-gray-100"
                              >
                                {sub.is_active
                                  ? <ToggleRight className="h-3 w-3 text-green-600" aria-hidden="true" />
                                  : <ToggleLeft className="h-3 w-3" aria-hidden="true" />}
                                {sub.is_active ? "Active" : "Inactive"}
                              </button>
                            </form>
                          </div>
                        </div>
                      );
                      })}

                      {/* Empty subcategory hint */}
                      {subs.length === 0 && main.is_active && (
                        <div className="pl-10 pr-4 py-2 text-xs text-[#9CA3AF]">
                          No subcategories yet — add one using the form on the left.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

      </div>
    </>
  );
}

function RenameForm({ id, currentName, small }: { id: string; currentName: string; small?: boolean }) {
  return (
    <form action={renameCategoryAction} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input
        className={`focus-ring rounded border border-[#E5E7EB] px-2 text-[#111827] ${small ? "py-1 text-[11px] w-28" : "py-1.5 text-xs w-32"}`}
        name="name"
        defaultValue={currentName}
        maxLength={80}
        required
      />
      <button
        type="submit"
        className={`shrink-0 rounded border border-[#E5E7EB] font-semibold text-[#4B5563] hover:bg-gray-100 ${small ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-xs"}`}
      >
        Rename
      </button>
    </form>
  );
}
