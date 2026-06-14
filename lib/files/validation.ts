export const PRIVATE_FILE_BUCKETS = ["work-order-files", "asset-files", "purchase-files"] as const;

export type PrivateFileBucket = (typeof PRIVATE_FILE_BUCKETS)[number];

export const MAX_PRIVATE_FILE_SIZE = 10 * 1024 * 1024;

export const ALLOWED_PRIVATE_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
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
    return "Unsupported file type. Use PDF, JPG, PNG, XLS, XLSX, DOC, or DOCX.";
  }

  return null;
}

export function safeStorageName(name: string) {
  const cleanName = name.replace(/[^a-zA-Z0-9.\-_]/g, "-").replace(/-+/g, "-");
  return cleanName || "upload.bin";
}
