export type ToastTone = "success" | "error" | "warning" | "info";

export type ToastMessage = {
  title: string;
  description?: string;
  tone: ToastTone;
};

const SUCCESS_MAP: Record<string, ToastMessage> = {
  // User management
  "user-created": {
    tone: "success",
    title: "User created",
    description: "Temporary password set. User must change password on first login."
  },
  "role-changed":         { tone: "success", title: "Role updated" },
  "department-changed":   { tone: "success", title: "Department updated" },
  activated:              { tone: "success", title: "Account activated", description: "User can now log in." },
  deactivated:            { tone: "warning", title: "Account deactivated", description: "All active sessions have been revoked." },
  unlocked:               { tone: "success", title: "Account unlocked", description: "Failed login counter reset." },
  "sessions-revoked":     { tone: "info",    title: "Sessions revoked", description: "User has been signed out." },
  "password-reset":       { tone: "warning", title: "Password reset", description: "User must change password on next login." },
  "override-added":       { tone: "success", title: "Permission override added" },
  "override-removed":     { tone: "info",    title: "Permission override removed" },
  // User lifecycle
  "user-archived": { tone: "warning", title: "User archived", description: "Account is hidden. All linked history is preserved." },
  "user-restored": { tone: "success", title: "User restored", description: "Account remains inactive until manually activated." },
  // Generic saves
  saved:                  { tone: "success", title: "Saved" },
  "1":                    { tone: "success", title: "Saved" }, // legacy ?saved=1
  // Job Cards / assets / parts / inventory
  "work-order-saved":       { tone: "success", title: "Job Card saved" },
  "asset-saved":            { tone: "success", title: "Asset saved" },
  "part-saved":             { tone: "success", title: "Part saved" },
  "opening-stock-saved":    { tone: "success", title: "Opening stock recorded", description: "Movement recorded in the Maintenance Store ledger." },
  "material-received":      { tone: "success", title: "Material received", description: "Movement recorded in the Maintenance Store ledger." },
  "material-issued":        { tone: "success", title: "Material issued",   description: "Movement recorded in the Maintenance Store ledger." },
  "settings-saved":       { tone: "success", title: "Settings saved" },
  "department-saved":     { tone: "success", title: "Department saved" },
  approved:               { tone: "success", title: "Approved" },
  rejected:               { tone: "warning", title: "Returned for fix" },
  assigned:               { tone: "success", title: "Technician assigned" },
  closed:                 { tone: "success", title: "Job Card closed" },
  submitted:              { tone: "success", title: "Submitted for review" },
  completed:              { tone: "success", title: "Marked as completed" },
  cancelled:              { tone: "warning", title: "Job Card cancelled" },
};

// Success codes with their own bigger, dedicated UI (e.g. a full modal) instead
// of the generic small toast — resolveToastMessage returns null for these so
// ActionToast stays silent and doesn't double up with that page's own UI.
const SUPPRESSED_SUCCESS_CODES = new Set<string>([
  "job-card-created",
  "materials-request-created",
  "material-request-received",
  "material-request-issued",
]);

const ERROR_MAP: Record<string, ToastMessage> = {
  // User management
  "duplicate-email":            { tone: "error",   title: "Email already exists",          description: "An account with this email address already exists. Use a different email." },
  "duplicate-employee-number":  { tone: "error",   title: "Employee number already in use", description: "That employee number is assigned to another profile." },
  "create-user-failed":         { tone: "error",   title: "Failed to create user",          description: "A database error occurred. Check System Health → Error Logs for details." },
  "active-role-required":       { tone: "error",   title: "Role required",                  description: "Active users must have a role assigned." },
  "cannot-change-own-super-admin": { tone: "error", title: "Cannot change own Super Admin role" },
  "cannot-deactivate-self":     { tone: "error",   title: "Cannot deactivate own account" },
  "cannot-modify-super-admin":  { tone: "error",   title: "Super Admin modification blocked", description: "Only Super Admin can modify Super Admin accounts." },
  "cannot-override-super-admin":{ tone: "error",   title: "Cannot override Super Admin" },
  "must-deactivate-first":      { tone: "error",   title: "Must deactivate first",           description: "Deactivate the account before archiving it." },
  "cannot-archive-self":        { tone: "error",   title: "Cannot archive own account" },
  "already-archived":           { tone: "error",   title: "Already archived" },
  "not-archived":               { tone: "error",   title: "User is not archived" },
  "insufficient-permissions":   { tone: "error",   title: "Insufficient permissions" },
  "passwords-mismatch":         { tone: "error",   title: "Passwords do not match" },
  "wrong-current-password":     { tone: "error",   title: "Wrong current password" },
  "same-as-current":            { tone: "error",   title: "New password must be different" },
  "cannot-reset-own-password":  { tone: "error",   title: "Use Change Password for own account" },
  "no-login-account":           { tone: "error",   title: "No login account found" },
  // Generic
  "invalid-input":              { tone: "error",   title: "Invalid input",                  description: "Please check all required fields and try again." },
  "save-failed":                { tone: "error",   title: "Save failed",                    description: "Please try again." },
  "not-found":                  { tone: "error",   title: "Record not found" },
  "not-editable":               { tone: "error",   title: "This record cannot be edited in its current state" },
  "permission-denied":          { tone: "error",   title: "Permission denied",              description: "You don't have access to that page. Contact your administrator if needed." },
  "rate-limited":               { tone: "error",   title: "Too many attempts",              description: "Please wait before trying again." },
  "inactive-profile":           { tone: "error",   title: "Account inactive",               description: "Contact your administrator." },
  "no-account":                 { tone: "error",   title: "No login account found" },
  // Job Card form validation
  "missing-complaint":          { tone: "error",   title: "Operator complaint required",    description: "Please describe the fault or issue reported before submitting." },
  "missing-description":        { tone: "error",   title: "Description of work required",   description: "Please add a description of the work to be carried out before submitting." },
  "missing-ordered-by":         { tone: "error",   title: "\"Order taken by\" is required" },
  "missing-department":         { tone: "error",   title: "Department is required" },
  "missing-type":               { tone: "error",   title: "Maintenance type is required" },
  "missing-team":               { tone: "error",   title: "Worker team is required" },
  "missing-priority":           { tone: "error",   title: "Priority is required" },
  "missing-date":               { tone: "error",   title: "Date of order is required" },
  "invalid-status":             { tone: "error",   title: "Status change not allowed",      description: "This transition is not permitted by the workflow rules." },
  "clarification-question-too-short": { tone: "error", title: "Clarification question too short", description: "Please provide at least 10 characters." },
  "clarification-response-too-short": { tone: "error", title: "Response too short",         description: "Please provide at least 10 characters." },
  "cancel-reason-required":           { tone: "error", title: "Cancellation reason required", description: "Please state why this Job Card is being cancelled." },
};

export function resolveToastMessage(params: {
  success?: string | null;
  error?: string | null;
  saved?: string | null;
}): ToastMessage | null {
  if (params.success) {
    if (SUPPRESSED_SUCCESS_CODES.has(params.success)) return null;
    return SUCCESS_MAP[params.success] ?? { tone: "success", title: "Done" };
  }
  if (params.error) {
    return ERROR_MAP[params.error] ?? { tone: "error", title: "Error", description: params.error };
  }
  // Legacy ?saved=1
  if (params.saved) {
    return SUCCESS_MAP[params.saved] ?? { tone: "success", title: "Saved" };
  }
  return null;
}
