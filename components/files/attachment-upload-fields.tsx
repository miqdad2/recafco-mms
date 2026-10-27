"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, FileText, Paperclip, Plus, Upload, X } from "lucide-react";

const inp =
  "focus-ring w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm";
const actionBtnCls =
  "focus-ring inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-bold text-[#111827] transition hover:border-[#111827] hover:bg-[#F9FAFB]";
// `large` variant (opt-in): 44px targets and 16px-on-phone text.
const actionBtnLargeCls =
  "focus-ring inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-bold text-[#111827] transition hover:border-[#111827] hover:bg-[#F9FAFB]";
const inpLarge =
  "focus-ring min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-base sm:text-sm";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "10 MB", "10.4 MB" — matches how the New Job Card wizard states the limit.
function formatMb(bytes: number) {
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

type SelectedFile = { name: string; size: number; type: string; previewUrl: string | null };

/**
 * Optional multi-row Attachments picker used inside creation wizards.
 * Files are NOT uploaded here — they ride along as real File objects inside the
 * parent <form>'s multipart submission, and the server action uploads them only
 * after the parent record (Job Card / Materials Request) has been created.
 *
 * Each row pairs a normal file input with a camera-capture input under the same
 * `name` — only one is ever filled, and the server picks whichever has content.
 *
 * New Job Card Required Materials and Attachment Simplification Task 3/4:
 * `showCategory`/`showCamera` default to `true` so the Materials Request
 * wizard (the other caller of this shared component) keeps its existing
 * category dropdown + Take Photo button unchanged — only the New Job Card
 * wizard passes `showCategory={false} showCamera={false}` for its simplified
 * single-button upload. When the category picker is hidden, `defaultCategory`
 * is still submitted via a hidden field of the same name, so the server's
 * existing category handling (and its own "Other Document" fallback) is
 * completely unaffected either way.
 *
 * New Job Card wizard usability (all opt-in, defaults keep the Materials
 * Request wizard exactly as it was): `showPreview` shows a thumbnail for
 * photos; `maxFileBytes` / `allowedTypes` flag a file that would be refused
 * right on its row (the server still checks); `large` uses 44px buttons.
 */
export function AttachmentUploadFields({
  namePrefix,
  categories,
  defaultCategory,
  accept,
  maxRows,
  helperText,
  showCategory = true,
  showCamera = true,
  showPreview = false,
  maxFileBytes,
  allowedTypes,
  large = false,
}: {
  namePrefix: string;
  categories: readonly string[];
  defaultCategory: string;
  accept: string;
  maxRows: number;
  helperText?: string;
  showCategory?: boolean;
  showCamera?: boolean;
  showPreview?: boolean;
  maxFileBytes?: number;
  allowedTypes?: ReadonlySet<string>;
  large?: boolean;
}) {
  const [rowCount, setRowCount] = useState(1);
  const [selected, setSelected] = useState<Record<number, SelectedFile | undefined>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const btnCls = large ? actionBtnLargeCls : actionBtnCls;
  const fieldCls = large ? inpLarge : inp;

  // Free the photo previews when the form goes away.
  const previews = useRef<string[]>([]);
  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  function problemFor(file: SelectedFile): string | null {
    if (allowedTypes && !allowedTypes.has(file.type)) {
      return "This type of file cannot be attached. Use a photo (JPG, PNG, WEBP), PDF, Excel or Word file.";
    }
    if (maxFileBytes && file.size > maxFileBytes) {
      return `This file is ${formatMb(file.size)} — the limit is ${formatMb(maxFileBytes)} per file. Choose a smaller file or photo.`;
    }
    return null;
  }

  function onPick(i: number, source: "file" | "camera", file: File | null) {
    let previewUrl: string | null = null;
    if (file && showPreview && file.type.startsWith("image/")) {
      previewUrl = URL.createObjectURL(file);
      previews.current.push(previewUrl);
    }
    setSelected((prev) => ({
      ...prev,
      [i]: file ? { name: file.name, size: file.size, type: file.type, previewUrl } : prev[i],
    }));
    // Clear the other input so only one row's worth of data is ever submitted.
    const otherKey = source === "file" ? `${i}-camera` : `${i}-file`;
    const other = fileRefs.current[otherKey];
    if (file && other) other.value = "";
  }

  function clearRow(i: number) {
    const fileInput = fileRefs.current[`${i}-file`];
    const cameraInput = fileRefs.current[`${i}-camera`];
    if (fileInput) fileInput.value = "";
    if (cameraInput) cameraInput.value = "";
    setSelected((prev) => ({ ...prev, [i]: undefined }));
  }

  return (
    <div className="space-y-3">
      {helperText && <p className="text-xs text-[#4B5563]">{helperText}</p>}

      {Array.from({ length: maxRows }, (_, i) => {
        const file = selected[i];
        const problem = file ? problemFor(file) : null;
        return (
          <div
            key={i}
            className={`rounded-md border bg-[#F9FAFB] p-3 ${problem ? "border-[#FCA5A5]" : "border-[#E5E7EB]"} ${i >= rowCount ? "hidden" : ""}`}
          >
            <div className={showCategory ? "grid gap-2 sm:grid-cols-[180px_1fr]" : ""}>
              {showCategory ? (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-[#4B5563]">Category</span>
                  <select
                    name={`${namePrefix}_category_${i}`}
                    defaultValue={defaultCategory}
                    className={fieldCls}
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name={`${namePrefix}_category_${i}`} value={defaultCategory} />
              )}
              <label className="block">
                <span className={large ? "mb-1 block text-sm font-semibold text-[#111827]" : "mb-1 block text-[11px] font-semibold text-[#4B5563]"}>
                  {large ? "What is this file? (optional)" : "Remarks (optional)"}
                </span>
                <input
                  name={`${namePrefix}_remarks_${i}`}
                  placeholder={large ? "e.g. Photo of the oil leak" : "Remarks (optional)"}
                  className={fieldCls}
                />
              </label>
            </div>

            {/* Hidden file inputs — triggered by the Upload Attachment / Take
                Photo buttons below. Both share one `name` so the server picks
                whichever one was actually filled. */}
            <input
              ref={(el) => { fileRefs.current[`${i}-file`] = el; }}
              type="file"
              name={`${namePrefix}_file_${i}`}
              accept={accept}
              onChange={(e) => onPick(i, "file", e.target.files?.[0] ?? null)}
              className="hidden"
            />
            {showCamera && (
              <input
                ref={(el) => { fileRefs.current[`${i}-camera`] = el; }}
                type="file"
                name={`${namePrefix}_file_${i}`}
                accept="image/*"
                capture="environment"
                onChange={(e) => onPick(i, "camera", e.target.files?.[0] ?? null)}
                className="hidden"
              />
            )}

            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => fileRefs.current[`${i}-file`]?.click()}
                className={btnCls}
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {large && file ? "Choose a different file" : "Upload Attachment"}
              </button>
              {showCamera && (
                <button
                  type="button"
                  onClick={() => fileRefs.current[`${i}-camera`]?.click()}
                  className={btnCls}
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  Take Photo
                </button>
              )}
            </div>

            {file ? (
              <div
                className={`mt-2 flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                  problem ? "border-[#FCA5A5] bg-[#FEF2F2]" : "border-green-200 bg-green-50"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  {file.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob preview, not an optimisable asset
                    <img src={file.previewUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                  ) : showPreview ? (
                    <FileText className="h-6 w-6 shrink-0 text-[#4B5563]" aria-hidden="true" />
                  ) : (
                    <Paperclip className="h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
                  )}
                  {large || showPreview ? (
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-[#111827]">{file.name}</span>
                      <span className="block text-xs text-[#4B5563]">{formatBytes(file.size)}</span>
                    </span>
                  ) : (
                    <>
                      <span className="truncate font-semibold text-[#111827]">{file.name}</span>
                      <span className="shrink-0 text-xs text-[#4B5563]">{formatBytes(file.size)}</span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => clearRow(i)}
                  className={
                    large
                      ? "focus-ring inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-3 text-sm font-semibold text-[#4B5563] hover:bg-white hover:text-red-600"
                      : "shrink-0 rounded p-1 text-[#9CA3AF] hover:bg-white hover:text-red-600"
                  }
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-4 w-4" />
                  {large && "Remove"}
                </button>
              </div>
            ) : null}
            {problem && (
              <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm font-semibold text-[#DC2626]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {problem}
              </p>
            )}
          </div>
        );
      })}

      {rowCount < maxRows && (
        <button
          type="button"
          onClick={() => setRowCount((n) => Math.min(n + 1, maxRows))}
          className={
            large
              ? "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-4 text-sm font-semibold text-[#111827] hover:bg-[#F3F4F6]"
              : "inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B5563] hover:bg-[#F3F4F6]"
          }
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add Another File
        </button>
      )}
    </div>
  );
}
