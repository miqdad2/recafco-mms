"use client";

import { useRef, useState } from "react";
import { Camera, Paperclip, Plus, Upload, X } from "lucide-react";

const inp =
  "focus-ring w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm";
const fileInputCls =
  "focus-ring w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm file:mr-2 file:rounded file:border-0 file:bg-[#111827] file:px-2 file:py-1 file:text-xs file:font-bold file:text-white";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type SelectedFile = { name: string; size: number };

/**
 * Optional multi-row Documents & Photos picker used inside creation wizards.
 * Files are NOT uploaded here — they ride along as real File objects inside the
 * parent <form>'s multipart submission, and the server action uploads them only
 * after the parent record (Job Card / Materials Request) has been created.
 *
 * Each row pairs a normal file input with a camera-capture input under the same
 * `name` — only one is ever filled, and the server picks whichever has content.
 */
export function AttachmentUploadFields({
  namePrefix,
  categories,
  defaultCategory,
  accept,
  maxRows,
  helperText,
}: {
  namePrefix: string;
  categories: readonly string[];
  defaultCategory: string;
  accept: string;
  maxRows: number;
  helperText?: string;
}) {
  const [rowCount, setRowCount] = useState(1);
  const [selected, setSelected] = useState<Record<number, SelectedFile | undefined>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function onPick(i: number, source: "file" | "camera", file: File | null) {
    setSelected((prev) => ({ ...prev, [i]: file ? { name: file.name, size: file.size } : prev[i] }));
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

      {Array.from({ length: maxRows }, (_, i) => (
        <div
          key={i}
          className={`rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 ${i >= rowCount ? "hidden" : ""}`}
        >
          <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
            <select
              name={`${namePrefix}_category_${i}`}
              defaultValue={defaultCategory}
              className={inp}
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              name={`${namePrefix}_remarks_${i}`}
              placeholder="Remarks (optional)"
              className={inp}
            />
          </div>

          {selected[i] ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <Paperclip className="h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
                <span className="truncate font-semibold text-[#111827]">{selected[i]!.name}</span>
                <span className="shrink-0 text-xs text-[#4B5563]">{formatBytes(selected[i]!.size)}</span>
              </div>
              <button
                type="button"
                onClick={() => clearRow(i)}
                className="shrink-0 rounded p-1 text-[#9CA3AF] hover:bg-white hover:text-red-600"
                aria-label="Remove selected file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <div className={`mt-2 grid gap-2 sm:grid-cols-2 ${selected[i] ? "hidden" : ""}`}>
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[#4B5563]">
                <Upload className="h-3 w-3" aria-hidden="true" /> Upload File
              </span>
              <input
                ref={(el) => { fileRefs.current[`${i}-file`] = el; }}
                type="file"
                name={`${namePrefix}_file_${i}`}
                accept={accept}
                onChange={(e) => onPick(i, "file", e.target.files?.[0] ?? null)}
                className={fileInputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[#4B5563]">
                <Camera className="h-3 w-3" aria-hidden="true" /> Take Photo
              </span>
              <input
                ref={(el) => { fileRefs.current[`${i}-camera`] = el; }}
                type="file"
                name={`${namePrefix}_file_${i}`}
                accept="image/*"
                capture="environment"
                onChange={(e) => onPick(i, "camera", e.target.files?.[0] ?? null)}
                className={fileInputCls}
              />
            </label>
          </div>
        </div>
      ))}

      {rowCount < maxRows && (
        <button
          type="button"
          onClick={() => setRowCount((n) => Math.min(n + 1, maxRows))}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B5563] hover:bg-[#F3F4F6]"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add Another File
        </button>
      )}
    </div>
  );
}
