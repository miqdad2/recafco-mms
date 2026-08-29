"use client";

import { useState } from "react";

import { addAssetTypeAction, upsertAssetAction } from "@/app/actions/maintenance";
import { Button } from "@/components/ui/button";
import { useLargeFormModal } from "@/components/ui/large-form-modal";
import { NEEDS_REVIEW_LEAF, extractNoteField } from "@/lib/assets/asset-excel-mapping";

// Asset Register Import Mapping and New Asset Form Update Unit 10G.34, Task
// 11/12/13. Replaces the previous 4-step AssetWizard (Main Category +
// Subcategory pickers, Brand/Serial/Engine Number, Purchase/Warranty dates,
// Current KM/Running Hours, Next Service fields) with one simple page
// matching exactly the fields the maintenance Excel carries — the same
// fields New Asset and Edit Asset both use (Task 13), so there is only one
// form to learn.
//
// Fields this form intentionally does NOT show (brand, serial/engine
// number, purchase/warranty dates, kilometer/running-hour readings,
// next-service fields, condition, criticality) are preserved via hidden
// inputs on edit rather than silently cleared — see the comment above
// assetSchema in app/actions/maintenance.ts for why that matters.
//
// New Asset Popup and Add Asset Type Unit 10G.38: `modalMode`/`redirectTo`
// are set only when this form renders inside the Assets & Equipment page's
// "New Asset" popup (LargeFormModal) — the standalone /assets/new and
// /assets/[id]/edit pages keep rendering this exact same form unchanged
// (Task 2). `canAddAssetType` gates the inline "+ Add new asset type"
// option in the Asset Type field (Task 8).

type FormRecord = Record<string, string | number | null | undefined>;

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[#111827]">
        {label}
        {required && <span className="ml-0.5 text-[#ED1C24]"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-[#9CA3AF]">{hint}</p>}
    </div>
  );
}

const inp = "focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm";

const STATUS_OPTIONS = [
  "Active",
  "In Use",
  "Under Maintenance",
  "Breakdown",
  "Waiting for Parts",
  "Out of Service",
  "Retired",
];

// Sentinel select value — never a real asset type name, so it can never
// collide with a saved category (Task 4).
const ADD_NEW_TYPE_VALUE = "__add_new_asset_type__";

type AddPanelMode = "closed" | "form" | "notice";

function AssetTypeField({
  initialTypes,
  currentType,
  canAddType,
}: {
  initialTypes: string[];
  currentType: string;
  canAddType: boolean;
}) {
  const [types, setTypes] = useState<string[]>(initialTypes);
  const [selected, setSelected] = useState(currentType);
  const [panelMode, setPanelMode] = useState<AddPanelMode>("closed");
  const [newTypeName, setNewTypeName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value === ADD_NEW_TYPE_VALUE) {
      setPanelMode("form");
      setNewTypeName("");
      setError(null);
      return;
    }
    setSelected(value);
  }

  function closePanel() {
    setPanelMode("closed");
    setNewTypeName("");
    setError(null);
  }

  async function handleSaveType() {
    if (!newTypeName.trim()) {
      setError("Please enter an asset type name.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const result = await addAssetTypeAction(newTypeName);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTypes((prev) => (prev.includes(result.name) ? prev : [...prev, result.name].sort((a, b) => a.localeCompare(b))));
      setSelected(result.name);
      if (result.alreadyExisted) {
        // Task 6 — do not create a duplicate; tell the user and select the
        // existing type instead.
        setPanelMode("notice");
      } else {
        closePanel();
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Field label="Asset Type" required>
      <select name="category" value={selected} onChange={handleSelectChange} className={inp} required>
        <option value="">Select asset type…</option>
        {types.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
        {!types.includes(NEEDS_REVIEW_LEAF) && (
          <option value={NEEDS_REVIEW_LEAF}>{NEEDS_REVIEW_LEAF}</option>
        )}
        {canAddType && <option value={ADD_NEW_TYPE_VALUE}>+ Add new asset type</option>}
      </select>

      {panelMode === "form" && (
        <div className="mt-2 rounded-md border border-[#E5E7EB] bg-gray-50 p-3">
          <label className="block text-xs font-semibold text-[#111827]">New Asset Type</label>
          <input
            type="text"
            value={newTypeName}
            onChange={(e) => {
              setNewTypeName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              // Prevent Enter here from submitting the outer asset form.
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSaveType();
              }
            }}
            placeholder="e.g. Water Pump"
            className={`${inp} mt-1`}
            autoFocus
            disabled={isSaving}
          />
          {error && <p className="mt-1.5 text-xs font-semibold text-[#ED1C24]">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void handleSaveType()}
              disabled={isSaving}
              className="rounded-md bg-[#ED1C24] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Save Type"}
            </button>
            <button
              type="button"
              onClick={closePanel}
              disabled={isSaving}
              className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-bold text-[#4B5563] transition hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {panelMode === "notice" && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800">This asset type already exists.</p>
          <p className="mt-0.5 text-xs text-amber-700">&ldquo;{selected}&rdquo; has been selected for you.</p>
          <button
            type="button"
            onClick={closePanel}
            className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-100"
          >
            OK
          </button>
        </div>
      )}
    </Field>
  );
}

export function SimpleAssetForm({
  asset,
  assetTypes,
  modalMode = false,
  redirectTo,
  canAddAssetType = false,
}: {
  asset?: FormRecord | null;
  assetTypes: string[];
  modalMode?: boolean;
  redirectTo?: string;
  canAddAssetType?: boolean;
}) {
  const modal = useLargeFormModal();

  const s = (key: string): string => {
    const v = asset?.[key];
    return v !== null && v !== undefined ? String(v) : "";
  };
  const dateVal = (key: string): string => {
    const v = s(key);
    return v ? v.slice(0, 10) : "";
  };

  const currentType = s("category");
  // The dropdown always includes the asset's own current type even if it's
  // since become empty/unused (Task 5 — never silently hide a real value).
  const typeOptions = currentType && !assetTypes.includes(currentType)
    ? [...assetTypes, currentType]
    : assetTypes;

  const modelInputDefault = s("model_year") || s("model");
  const fileNoDefault = extractNoteField(s("notes"), "File #");
  const colourDefault = extractNoteField(s("notes"), "Colour");

  return (
    <div className="mx-auto max-w-3xl">
      <form action={upsertAssetAction} className="space-y-5">
        {asset?.id ? <input type="hidden" name="id" value={s("id")} /> : null}
        {redirectTo ? <input type="hidden" name="redirect_to" value={redirectTo} /> : null}
        {/* Task 12 — asset code is never entered by hand: preserved as-is on
            edit, left blank on create so upsertAssetAction generates one. */}
        <input type="hidden" name="asset_code" value={s("asset_code")} />
        {/* Fields this simple form doesn't show — preserved untouched. */}
        <input type="hidden" name="department_id" value={s("department_id")} />
        <input type="hidden" name="serial_number" value={s("serial_number")} />
        <input type="hidden" name="engine_number" value={s("engine_number")} />
        <input type="hidden" name="purchase_date" value={dateVal("purchase_date")} />
        <input type="hidden" name="warranty_expiry_date" value={dateVal("warranty_expiry_date")} />
        <input type="hidden" name="insurance_expiry_date" value={dateVal("insurance_expiry_date")} />
        <input type="hidden" name="current_kilometer_reading" value={s("current_kilometer_reading")} />
        <input type="hidden" name="current_running_hours" value={s("current_running_hours")} />
        <input type="hidden" name="next_service_date" value={dateVal("next_service_date")} />
        <input type="hidden" name="next_service_kilometer" value={s("next_service_kilometer")} />
        <input type="hidden" name="next_service_running_hours" value={s("next_service_running_hours")} />
        <input type="hidden" name="condition" value={s("condition")} />
        <input type="hidden" name="criticality" value={s("criticality")} />

        <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <div className="mb-5 border-b border-[#E5E7EB] pb-4">
            <h2 className="text-base font-bold text-[#111827]">Asset Details</h2>
            <p className="mt-0.5 text-xs text-[#4B5563]">Fields marked * are required. Everything else is optional.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <AssetTypeField initialTypes={typeOptions} currentType={currentType} canAddType={canAddAssetType} />

            <Field label="Make / Asset Name" required>
              <input name="asset_name" defaultValue={s("asset_name")} placeholder="e.g. Toyota - Land Cruiser" className={inp} />
            </Field>

            <Field label="Model / Year" hint="A year (e.g. 2022) or a spec like 320KVA.">
              <input name="model_input" defaultValue={modelInputDefault} placeholder="e.g. 2022" className={inp} />
            </Field>

            <Field label="File No.">
              <input name="file_number" defaultValue={fileNoDefault} className={inp} />
            </Field>

            <Field label="Colour">
              <input name="colour" defaultValue={colourDefault} className={inp} />
            </Field>

            <Field label="Plate No.">
              <input name="plate_number" defaultValue={s("plate_number")} className={inp} />
            </Field>

            <Field label="Chassis No.">
              <input name="chassis_number" defaultValue={s("chassis_number")} className={inp} />
            </Field>

            <Field label="Expires On">
              <input type="date" name="registration_expiry_date" defaultValue={dateVal("registration_expiry_date")} className={inp} />
            </Field>

            <Field label="Department / Location">
              <input name="location" defaultValue={s("location")} className={inp} />
            </Field>

            <Field label="Responsible Person / Driver">
              <input name="assigned_operator_driver" defaultValue={s("assigned_operator_driver")} className={inp} />
            </Field>

            <Field label="Status">
              <select name="status" defaultValue={s("status") || "Active"} className={inp}>
                {STATUS_OPTIONS.map((st) => <option key={st}>{st}</option>)}
              </select>
            </Field>

            <div className="sm:col-span-2">
              <Field label="Remarks">
                <textarea name="remarks" rows={3} defaultValue={s("remarks")} className={inp} />
              </Field>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {modalMode && (
            <button
              type="button"
              onClick={() => modal?.requestClose()}
              className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
          <Button type="submit">{asset?.id ? "Save Asset" : "Add Asset"}</Button>
        </div>
      </form>
    </div>
  );
}
