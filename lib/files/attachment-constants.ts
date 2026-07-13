// Shared between client wizard components and server actions — plain data only.

export const MAX_ATTACHMENT_ROWS = 5;

export const ATTACHMENT_FILE_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx";

export const JOB_CARD_ATTACHMENT_CATEGORIES = [
  "Problem Photo",
  "Before Repair Photo",
  "After Repair Photo",
  "Technician Work Photo",
  "Inspection Report",
  "Service Report",
  "Quotation",
  "Invoice",
  "Other Document",
] as const;

export const PARTS_REQUEST_ATTACHMENT_CATEGORIES = [
  "Request Document",
  "Material Photo",
  "Received Material Photo",
  "Delivery Note",
  "Invoice",
  "Supplier Document",
  "Other Document",
] as const;
