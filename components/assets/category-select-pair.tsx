"use client";
import { useState, useMemo } from "react";

export type CategoryOption = {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
};

type Props = {
  categories: CategoryOption[];
  defaultSubcategory?: string | null;
  required?: boolean;
};

export function CategorySelectPair({ categories, defaultSubcategory, required }: Props) {
  const mainCategories = useMemo(
    () => categories.filter((c) => c.parent_id === null && c.is_active).sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );

  // Derive the initial main category from the default subcategory value
  const initialMain = useMemo(() => {
    if (!defaultSubcategory) return "";
    // Try to match the defaultSubcategory to a known subcategory (by name)
    const matchedSub = categories.find(
      (c) => c.parent_id !== null && c.name.toLowerCase() === defaultSubcategory.toLowerCase()
    );
    if (matchedSub) {
      const parent = mainCategories.find((m) => m.id === matchedSub.parent_id);
      return parent?.name ?? "";
    }
    // If the value itself is a main category name (legacy: category stored as main cat name)
    const matchedMain = mainCategories.find(
      (m) => m.name.toLowerCase() === defaultSubcategory.toLowerCase()
    );
    return matchedMain?.name ?? "";
  }, [defaultSubcategory, categories, mainCategories]);

  const [selectedMain, setSelectedMain] = useState(initialMain);

  const subcategories = useMemo(() => {
    if (!selectedMain) return [];
    const main = mainCategories.find((m) => m.name === selectedMain);
    if (!main) return [];
    return categories.filter((c) => c.parent_id === main.id && c.is_active);
  }, [selectedMain, categories, mainCategories]);

  // If the current default subcategory isn't in the filtered list but a value exists,
  // keep it as a non-blank default so existing data isn't lost.
  const subcatDefault = useMemo(() => {
    if (!defaultSubcategory) return "";
    const isKnownSub = subcategories.some(
      (s) => s.name.toLowerCase() === defaultSubcategory.toLowerCase()
    );
    // If the asset's category is a main category name, leave subcategory blank
    const isMainName = mainCategories.some(
      (m) => m.name.toLowerCase() === defaultSubcategory.toLowerCase()
    );
    if (isMainName) return "";
    return isKnownSub ? defaultSubcategory : defaultSubcategory; // always preserve raw value
  }, [defaultSubcategory, subcategories, mainCategories]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Main Category — UI only, not submitted */}
      <label className="block">
        <span className="text-sm font-semibold text-[#111827]">Main Category</span>
        <select
          className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2"
          value={selectedMain}
          onChange={(e) => setSelectedMain(e.target.value)}
          aria-label="Main category"
        >
          <option value="">Select main category…</option>
          {mainCategories.map((m) => (
            <option key={m.id} value={m.name}>{m.name}</option>
          ))}
        </select>
      </label>

      {/* Subcategory — submitted as "category" */}
      <label className="block">
        <span className="text-sm font-semibold text-[#111827]">
          Subcategory {required && <span className="text-[#ED1C24]">*</span>}
        </span>
        <select
          className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2"
          name="category"
          required={required}
          defaultValue={subcatDefault}
        >
          <option value="">
            {selectedMain ? "Select subcategory…" : "Select main category first"}
          </option>
          {subcategories.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
          {/* Preserve unknown/legacy category value as a selectable option */}
          {defaultSubcategory &&
            subcatDefault &&
            !subcategories.some((s) => s.name.toLowerCase() === defaultSubcategory.toLowerCase()) && (
              <option value={defaultSubcategory}>{defaultSubcategory} (legacy)</option>
            )}
        </select>
      </label>
    </div>
  );
}
