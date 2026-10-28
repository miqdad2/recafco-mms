export const PRIVATE_FILE_BUCKETS = ["work-order-files", "asset-files", "purchase-files"] as const;

export type PrivateFileBucket = (typeof PRIVATE_FILE_BUCKETS)[number];

export const MAX_PRIVATE_FILE_SIZE = 10 * 1024 * 1024;

export const ALLOWED_PRIVATE_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

export function validatePrivateFile(file: File) {
  return validatePrivateFileWithOptions(file, {
    maxSizeBytes: MAX_PRIVATE_FILE_SIZE,
    allowedTypes: ALLOWED_PRIVATE_FILE_TYPES
  });
}

export function validatePrivateFileWithOptions(file: File, options: { maxSizeBytes: number; allowedTypes: Set<string> | string[] }) {
  const allowedTypes = Array.isArray(options.allowedTypes) ? new Set(options.allowedTypes) : options.allowedTypes;

  if (!file.size) {
    return "Select a file before uploading.";
  }

  if (file.size > options.maxSizeBytes) {
    return `File is too large. Maximum size is ${Math.round(options.maxSizeBytes / 1024 / 1024)} MB.`;
  }

  if (!allowedTypes.has(file.type)) {
    return "Unsupported file type. Use PDF, JPG, PNG, WEBP, XLS, XLSX, DOC, or DOCX.";
  }

  return null;
}

// File content check — the browser-declared type is only a claim. The file
// name must end in an extension of that type and the first bytes must be
// that format's signature, so a renamed program or web page is refused.
// Legacy .doc / .xls are OLE files; Office also saves them as ZIP (docx /
// xlsx renamed) and Word as RTF, all of which open normally.
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const RTF = [0x7b, 0x5c, 0x72, 0x74, 0x66]; // "{\rtf"

const CONTENT_RULES: Record<string, { extensions: string[]; matches: (b: Uint8Array) => boolean; label: string }> = {
  "application/pdf": { extensions: [".pdf"], matches: (b) => indexOfBytes(b, [0x25, 0x50, 0x44, 0x46, 0x2d], 1024) >= 0, label: "PDF" },
  "image/jpeg": { extensions: [".jpg", ".jpeg"], matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]), label: "JPG photo" },
  "image/png": { extensions: [".png"], matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), label: "PNG image" },
  "image/webp": { extensions: [".webp"], matches: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]), label: "WEBP image" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { extensions: [".xlsx"], matches: (b) => startsWith(b, ZIP), label: "Excel file" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { extensions: [".docx"], matches: (b) => startsWith(b, ZIP), label: "Word file" },
  "application/vnd.ms-excel": { extensions: [".xls"], matches: (b) => startsWith(b, OLE) || startsWith(b, ZIP), label: "Excel file" },
  "application/msword": { extensions: [".doc"], matches: (b) => startsWith(b, OLE) || startsWith(b, ZIP) || startsWith(b, RTF), label: "Word file" },
};

function startsWith(bytes: Uint8Array, signature: number[]) {
  return bytes.length >= signature.length && signature.every((value, i) => bytes[i] === value);
}

function indexOfBytes(bytes: Uint8Array, signature: number[], within: number) {
  const end = Math.min(bytes.length - signature.length, within);
  for (let i = 0; i <= end; i++) if (startsWith(bytes.subarray(i), signature)) return i;
  return -1;
}

/**
 * Checks that the file really is the type it claims to be (extension and
 * content). Returns a message for the user, or null when it is fine. Call
 * after validatePrivateFileWithOptions (which checks size and allowed type).
 */
export async function checkFileContent(file: File): Promise<string | null> {
  const rule = CONTENT_RULES[file.type];
  if (!rule) return "Unsupported file type. Use PDF, JPG, PNG, WEBP, XLS, XLSX, DOC, or DOCX.";
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const head = new Uint8Array(await file.slice(0, 2048).arrayBuffer());
  if (!rule.extensions.includes(extension) || !rule.matches(head)) {
    return `This file is not a real ${rule.label} (its name or contents do not match). Please attach the original file.`;
  }
  return null;
}

export function safeStorageName(name: string) {
  const cleanName = name.replace(/[^a-zA-Z0-9.\-_]/g, "-").replace(/-+/g, "-");
  return cleanName || "upload.bin";
}

/**
 * Some upload forms pair a normal file input with a camera-capture input under
 * the same `name` (either/or — only one is ever actually filled by the user).
 * `FormData.get()` only returns the first entry, which may be the empty one if
 * the unused input happens to come first in the DOM. This scans every entry
 * for that name and returns the first one that actually has content.
 */
export function pickUploadedFile(formData: FormData, name: string): File | null {
  for (const entry of formData.getAll(name)) {
    if (entry instanceof File && entry.size > 0) return entry;
  }
  return null;
}
