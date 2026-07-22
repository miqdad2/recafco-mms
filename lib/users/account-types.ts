// Curated, user-facing "account type" list for the Create User form and the
// Users directory's inline role selector — deliberately a fixed subset of
// `roles`, not every row in the table, so operationally irrelevant roles
// (Purchase Officer, Finance Manager, CEO/Management, IT Admin, etc.) never
// appear when creating a maintenance-department login.
//
// Single source of truth: the Users page's DB query (which roles are
// selectable), the Create User drawer's dropdown + help text, the
// account_type -> role_id resolver in the create-user server action, and
// the directory's role-label lookup all read from here so they can't drift
// out of sync with each other again (that drift is exactly how
// "Maintenance Engineer" went missing from the dropdown).

export type AccountTypeSlug =
  | "maintenance_data_entry"
  | "maintenance_engineer"
  | "maintenance_manager"
  | "store_keeper"
  | "technician"
  | "super_admin"
  | "viewer_auditor";

export type AccountType = {
  slug: AccountTypeSlug;
  label: string;
  help: string;
};

export const ACCOUNT_TYPES: AccountType[] = [
  {
    slug: "maintenance_data_entry",
    label: "Maintenance Data Entry",
    help: "Creates and manages Job Cards. Can submit requests and track progress.",
  },
  {
    slug: "maintenance_engineer",
    label: "Maintenance Engineer",
    help: "Reviews Job Cards before manager approval and can request corrections.",
  },
  {
    slug: "maintenance_manager",
    label: "Maintenance Manager",
    help: "Reviews and approves Job Cards, assigns technicians, and closes completed work.",
  },
  {
    slug: "store_keeper",
    label: "Store User",
    help: "Manages spare parts inventory, handles Materials Requests, and processes store issues.",
  },
  {
    slug: "technician",
    label: "Technician",
    help: "Receives job assignments, logs work updates, and marks work as completed.",
  },
  {
    slug: "super_admin",
    label: "System Administrator",
    help: "Full system access including user management, settings, and all records.",
  },
  {
    slug: "viewer_auditor",
    label: "Viewer / Auditor",
    help: "Read-only access to Job Cards, Materials Requests, assets, and reports. Cannot create or modify records.",
  },
];

export const ACCOUNT_TYPE_SLUGS: string[] = ACCOUNT_TYPES.map((t) => t.slug);

export const ACCOUNT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ACCOUNT_TYPES.map((t) => [t.slug, t.label])
);

export const ACCOUNT_TYPE_HELP: Record<string, string> = Object.fromEntries(
  ACCOUNT_TYPES.map((t) => [t.slug, t.help])
);
