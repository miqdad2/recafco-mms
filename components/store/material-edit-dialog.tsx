"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Lock, Loader2, Save } from "lucide-react";

import { LargeFormModal, useLargeFormModal } from "@/components/ui/large-form-modal";
import { getMaterialForEditAction, saveMaterialEditAction } from "@/app/actions/material-master";
import { dispatchActionToast } from "@/lib/action-messages";
import { GENERAL_INVENTORY_UNIT_OPTIONS } from "@/components/store/general-inventory-units";
import { MATERIAL_CATEGORIES, inputCls, labelCls } from "@/components/store/offline-inventory-types";
import type { MaterialEditData } from "@/lib/backend/store/material-master";
import type { MaterialEditValues } from "@/lib/store/material-edit";

// Edit Material: master information only. Quantities, costs and history are
// not shown or sent here; they change only through their own workflows. The
// server re-checks permission, every rule and that nobody else changed the
// material since this form opened. LargeFormModal provides the unsaved-changes
// check on Close, Cancel and Escape.

type FieldErrors = Partial<Record<keyof MaterialEditValues, string[]>>;

function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string[];
  hint?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label} {required && <span className="text-[#ED1C24]">*</span>}
      </label>
      {children}
      {hint && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-[#6B7280]">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {hint}
        </p>
      )}
      {error?.map((message) => (
        <p key={message} id={`${id}-error`} role="alert" className="mt-1 text-xs font-semibold text-[#B91C1C]">
          {message}
        </p>
      ))}
    </div>
  );
}

function EditForm({ data, onSaved }: { data: MaterialEditData; onSaved: (key: string) => void }) {
  const modal = useLargeFormModal();
  const [values, setValues] = useState<MaterialEditValues>(data.values);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const set = (field: keyof MaterialEditValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    const r = await saveMaterialEditAction({ key: data.key, version: data.version, values });
    savingRef.current = false;
    setSaving(false);
    if (!r.ok) {
      setFormError(r.error);
      setFieldErrors((r.fieldErrors ?? {}) as FieldErrors);
      return;
    }
    dispatchActionToast({
      tone: "success",
      title: "Material Updated Successfully",
      description: r.data.changed.length ? `Updated: ${r.data.changed.join(", ")}.` : "No changes were needed.",
    });
    onSaved(r.data.key);
  }

  return (
    <form onSubmit={save} noValidate className="space-y-5">
      {formError && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-[#B91C1C]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {formError}
        </p>
      )}

      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">Basic Information</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="me-name" label="Material Name / Description" required error={fieldErrors.name} hint={data.nameLockedReason}>
              <input id="me-name" value={values.name} onChange={set("name")} disabled={saving || data.nameLockedReason !== null} className={inputCls} />
            </Field>
          </div>
          <Field id="me-code" label="Item Code" error={fieldErrors.itemCode}>
            <input id="me-code" value={values.itemCode} onChange={set("itemCode")} disabled={saving} className={`${inputCls} font-mono`} />
          </Field>
          <Field id="me-category" label="Category" required error={fieldErrors.category}>
            <input id="me-category" list="me-category-options" value={values.category} onChange={set("category")} disabled={saving} className={inputCls} />
            <datalist id="me-category-options">
              {MATERIAL_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field id="me-unit" label="Unit" required error={fieldErrors.unit} hint={data.unitLockedReason}>
            <input id="me-unit" list="me-unit-options" value={values.unit} onChange={set("unit")} disabled={saving || data.unitLockedReason !== null} className={inputCls} />
            <datalist id="me-unit-options">
              {GENERAL_INVENTORY_UNIT_OPTIONS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
          <Field id="me-part" label="Part Number" error={fieldErrors.partNumber}>
            <input id="me-part" value={values.partNumber} onChange={set("partNumber")} disabled={saving} className={inputCls} />
          </Field>
          <Field id="me-ss" label="SS Rec. Code" error={fieldErrors.ssRecCode}>
            <input id="me-ss" value={values.ssRecCode} onChange={set("ssRecCode")} disabled={saving} className={inputCls} />
          </Field>
          <Field id="me-location" label="Location / Bin" error={fieldErrors.location}>
            <input id="me-location" value={values.location} onChange={set("location")} disabled={saving} className={inputCls} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="me-notes" label="Material Notes" error={fieldErrors.notes}>
              <textarea id="me-notes" rows={2} value={values.notes} onChange={set("notes")} disabled={saving} className={inputCls} />
            </Field>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-black uppercase tracking-wide text-[#4B5563]">Stock Settings</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="me-min" label="Minimum Stock Level" error={fieldErrors.minimumStock}>
            <input id="me-min" inputMode="decimal" value={values.minimumStock} onChange={set("minimumStock")} disabled={saving} className={inputCls} />
          </Field>
          <Field id="me-reorder" label="Reorder Quantity" error={fieldErrors.reorderQuantity}>
            <input id="me-reorder" inputMode="decimal" value={values.reorderQuantity} onChange={set("reorderQuantity")} disabled={saving} className={inputCls} />
          </Field>
        </div>
        <p className="mt-2 text-[11px] text-[#6B7280]">
          Stock quantities and costs are not edited here. They change only through receiving, issuing and opening stock.
        </p>
      </section>

      <div className="flex flex-col-reverse gap-2 border-t border-[#E5E7EB] pt-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => modal?.requestClose()}
          disabled={saving}
          className="min-h-[44px] rounded-md border border-[#E5E7EB] bg-white px-5 text-sm font-bold text-[#4B5563] hover:bg-gray-50 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-5 text-sm font-bold text-white hover:bg-[#c8181e] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

export function MaterialEditDialog({
  materialKey,
  materialName,
  onClose,
  onSaved,
}: {
  materialKey: string;
  materialName: string;
  onClose: () => void;
  onSaved: (key: string) => void;
}) {
  const [data, setData] = useState<MaterialEditData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getMaterialForEditAction(materialKey).then((r) => {
      if (!alive) return;
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [materialKey]);

  return (
    <LargeFormModal title="Edit Material" subtitle={materialName} onClose={onClose}>
      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-[#B91C1C]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : data ? (
        <EditForm data={data} onSaved={onSaved} />
      ) : (
        <div className="flex items-center gap-2 py-8 text-sm text-[#4B5563]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading material…
        </div>
      )}
    </LargeFormModal>
  );
}
