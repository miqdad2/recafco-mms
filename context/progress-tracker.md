# Progress Tracker

Update this file after every meaningful implementation or database-state change.

## Current Phase

**Advanced codebase recovery and controlled multi-role workflow verification**

The codebase is substantially implemented and quality checks pass. The PostgreSQL database was rebuilt from committed migrations after the previous operational database became unavailable.

## Current Goal

Create missing role users and verify one controlled work order through:

```text
Create → Submit → Approve → Assign → Start → Complete → Verify → Close
```

Confirm permissions, visibility, history, audit, notifications, reports, cost visibility, and file authorization.

## Current Verified Baseline

Repository:

- Branch: main
- HEAD: fd7a649
- Working tree: only generated next-env.d.ts modification
- Package manager: npm

Quality:

- db:check pass
- lint pass
- typecheck pass
- build pass
- 41 static pages
- 53 dynamic routes
- No automated tests

Database:

- 29 SQL migrations applied
- 7 departments
- 17 roles
- 55 permissions
- 276 role-permission assignments
- 15 assets
- 25 parts
- 20 work orders
- 2 profiles
- 2 auth users
- 2 sessions
- 0 assignments
- 0 required parts
- 0 parts requests
- 0 purchase requests
- 0 purchase orders
- 0 inventory movements
- 1 notification
- 231 audit logs
- 0 system errors
- 2 workflow definitions
- 30 workflow steps
- 0 workflow instances
- 0 workflow step instances
- 0 clarification requests

Active users:

- Super Admin
- Maintenance Data Entry

Current settings:

- Company: RECAFCO
- Currency: KWD
- CEO threshold: 1000 KWD
- Requester confirmation: enabled
- Finance approval: enabled
- CEO approval: enabled
- Inventory check: disabled
- Upload limit: 10 MB
- Signed URL expiry setting: 300 seconds, not enforced
- Notification retention: 180 days

## Completed

- Foundation: auth, RBAC, departments, users, settings, audit
- Core records: assets, parts, work orders, history, files, print
- Workflow: submit, approve, reject, clarify, assign, start, complete, verify, close
- Store/purchase/finance: parts requests, store issue, shortage, purchase request, finance, CEO, receipt, inventory update
- Dashboards and reports
- Notification center and SSE
- System map and architecture pages
- System health and backup logs
- Workflow engine schema and seed
- Inventory-check schema, UI, and assignment gate
- Fresh DB reconstruction
- New Super Admin setup
- Local application startup
- R2.1: `scripts/seed-demo-users.mjs` — idempotent demo user seed utility written; `seed:demo-users` npm script added; `DEMO_USER_PASSWORD` documented in `.env.example`. Script not yet executed. Database state unchanged.

## Implemented but Feature-Flagged

Inventory check is implemented but `inventory_check_enabled = false`.

## Partial

- Requester confirmation
- General reopen
- Cancellation
- Automatic shortage-to-purchase progression

## Schema or Definition Only

- Formal purchase-order lifecycle
- Production Manager approval
- Factory Manager approval
- Purchase Manager approval
- Construction Project Request application flow
- Realtime event consumer
- External notification delivery

## In Progress

- Missing multi-role users (seed script written, not yet executed — see R2.1)
- No controlled post-recovery lifecycle verification
- Manual PostgreSQL bootstrap not yet committed
- Backup routine not yet revalidated on the new machine

## Next Up

### P12 — Users and Roles Pages Cleanup (Two-Account System) — COMPLETE

UI simplification for the two-account maintenance system. No DB schema changes, no role/permission/table deletions, no backend permission guard changes.

**`app/(dashboard)/admin/users/[id]/page.tsx`** — Complete rewrite (858 → ~380 lines):
- **Removed sections:** Add permission override form, Active overrides list, Effective permissions table, Change department card, "Login as user — future feature" note
- **Removed from Profile details card:** Job title, Cost visibility
- **Authentication card simplified** to "Login details" showing: login email, last login date, temporary password warning (when relevant). Removed: failed login count, locked account date, active sessions count, must-reset-password detail row, temp password set date.
- **Layout changed** from asymmetric `xl:grid-cols-[380px_1fr]` to symmetric `lg:grid-cols-2`: left column = Profile details + Login details + Reset password; right column = Change account type + Account actions.
- **Removed imports:** `Shield`, `ShieldCheck`, `ShieldOff`, `XCircle`, `addPermissionOverrideAction`, `changeUserDepartmentAction`, `removePermissionOverrideAction`, `permissions as permissionDefinitions`, `PermissionKey`
- **Removed types:** `OverrideRow`, `RolePermRow`, `EffectivePermission`, `DeptRow`
- **Removed functions:** `computeEffectivePermissions`, `SourceBadge`
- **Simplified `loadUserData`:** removed `overrideRows`, `rolePermRows`, `departments` parallel queries; roles query now only fetches `super_admin` and `maintenance_data_entry` slugs
- **Backend unchanged:** All server actions, permission guards, role mappings, and DB tables untouched

**`proxy.ts`** — Added redirect block: `/admin/roles` → `/admin/users` (runs before auth, before disabledRoutes check)

**`components/layout/app-layout.tsx`** — Removed `{ href: "/admin/roles", label: "Roles", iconKey: "ShieldCheck", permission: "admin.roles.view" }` from the Administration nav group in `navigationGroups`. The roles link is gone from the Super Admin sidebar. The `/admin/roles` page file is untouched; the proxy redirect handles any direct URL attempts.

**`app/(dashboard)/admin/users/page.tsx`** — No changes needed; already correct from P10E (4 KPI cards, simplified form, User Directory table).

**Users page access control (confirmed, no code changes):**
- Normal User: blocked from all `/admin/*` routes by `requirePermission("admin.users.manage")` guard
- System Administrator: sees Users, Notifications, Settings, Audit Logs, System Health in sidebar — no Roles

All checks pass: lint ✓, typecheck ✓, build ✓

### P13 — Repair Order & Parts Request Wizards — COMPLETE

No DB schema changes. Both new-record forms converted from flat paper-style pages to guided multi-step wizards.

**`components/work-orders/work-order-wizard.tsx`** (NEW — `"use client"`):
- 5-step wizard replacing `WorkOrderForm` on `/maintenance/work-orders/new`
- Step 1 — Select Asset: controlled `<select name="asset_id">` with asset preview card (code, name, category, location, brand/model, status badge). Requires asset selection before advancing.
- Step 2 — Request Details: ordered_by*, date_of_order*, job_location, priority, running_hours, kilometers, maintenance_type radios (default Breakdown), operator_complaint*, description_of_work, notes. Client validates ordered_by + date_of_order + operator_complaint before Next.
- Step 3 — Assignment Planning: worker_type radios (default Mechanical, required), assigned_supervisor_id select, starting_datetime, ending_datetime. Client validates worker_type before Next.
- Step 4 — Required Parts: table with 8 rows (3 visible initially); Add Row button expands up to 8. Fields per row: req_part_description_N, req_part_part_number_N, req_part_quantity_N (default 1), req_part_uom_N (default PCS), req_part_notes_N.
- Step 5 — Review & Save: collects FormData when entering; shows grouped summary (asset, request details, assignment, required parts table). Two submit buttons: "Submit Repair Order" (intent=submit_for_approval) + "Save Draft" (intent=save_draft).
- Controlled hidden inputs: asset_category, serial_number, plate_number derived from selectedAsset state. Fields not in wizard (supervisor_verification, maintenance_manager_closure, operator_requester_confirmation) submitted as empty → null.
- Department field removed from UI entirely (backend validation relaxed — see action change below).

**`app/actions/maintenance.ts`** (MODIFIED):
- `parseRequiredPartRows`: extended from indices `[0, 1, 2]` to `[0, 1, 2, 3, 4, 5, 6, 7]` — supports up to 8 required part rows.
- `upsertWorkOrderAction` submit validation: removed `if (!parsed.data.requested_by_department_id) redirect(...)` check. Department is no longer required for submit. Complaint and description checks retained.

**`app/(dashboard)/maintenance/work-orders/new/page.tsx`** (REWRITTEN):
- Uses `WorkOrderWizard` instead of `WorkOrderForm`
- Removed `departments` query (no longer shown in UI)
- Removed `preselectedAsset` separate query (wizard finds asset in main assets array)
- Expanded assets select to include: `location`, `status`, `brand`, `model` (needed for Step 1 preview card)
- Supervisors query unchanged

**`components/store/parts-request-wizard.tsx`** (NEW — `"use client"`):
- 3-step wizard replacing `PartsRequestForm` on `/store/parts-requests/new`
- Step 1 — Select Repair Order: controlled `<select name="work_order_id">`; shows RO preview (number, ordered by, maintenance type, worker type, complaint) plus linked asset card (code, name, category, location, status) auto-populated from selected WO.
- Step 2 — Requested Parts: optional remarks field + 8-row table (3 visible initially, Add Row up to 8). Fields per row: description_N, part_number_N, ss_rec_code_N, quantity_requested_N, unit_price_N (KWD, optional), remarks_N. Client validates at least 1 description filled before Next.
- Step 3 — Review & Submit: shows selected RO summary + asset + items table. Single "Submit Parts Request" submit button.

**`app/actions/phase4.ts`** (MODIFIED):
- `parseItems`: extended from indices `[0, 1, 2, 3, 4]` to `[0, 1, 2, 3, 4, 5, 6, 7]` — supports up to 8 parts request item rows.

**`app/(dashboard)/store/parts-requests/new/page.tsx`** (REWRITTEN):
- Uses `PartsRequestWizard` instead of `PartsRequestForm`
- Work orders query expanded to include: `maintenance_type`, `operator_complaint`, and nested `assets` relation (asset_code, asset_name, location, category, status)
- `created_at` serialized to ISO string for client component compatibility
- `getWorkOrderVisibilityFilter(context)` preserved — mandatory filter unchanged

All checks pass: lint ✓, typecheck ✓, build ✓

### P12 — New Asset Page: 5-Step Wizard — COMPLETE

No DB schema changes, no migration changes, no table deletions. The flat single-page asset form replaced by a guided 5-step wizard on both `/assets/new` and `/assets/[id]/edit`.

**`components/assets/asset-wizard.tsx`** (NEW — `"use client"`):
- Step 1 — Basic Details: Asset Code*, Asset Name*, Main Category*, Subcategory*, Location*, Status* (required fields), Department (optional)
- Step 2 — Identification: Brand, Model, Serial Number, Assigned Operator/Driver; vehicle-only: Plate Number, Chassis Number, Engine Number
- Step 3 — Service & Warranty: Purchase Date, Warranty Expiry; vehicle-only: Registration Expiry, Insurance Expiry, Current KM, Next Service KM; machine-type-only: Current Running Hours, Next Service Running Hours; common: Next Service Date, Notes
- Step 4 — Condition & Risk: Physical Condition, Criticality, Remarks
- Step 5 — Review & Save: summary of all entered values grouped by section; Back + Save Asset buttons
- Vehicle detection: `selectedMain === "Vehicles"`; machine detection: selectedMain in `["Production Equipment", "Heavy Equipment", "Electrical Equipment", "Workshop Equipment", "Facility / Utility"]`
- Category-aware conditional fields: non-vehicle inputs replaced by hidden empty inputs when category is not Vehicles; non-machine inputs replaced similarly
- All inputs stay in the form DOM at all times (steps hidden via `hidden` Tailwind class); form submits all fields to `upsertAssetAction` unchanged
- Step 1 client-side validation before Next: checks asset_code, asset_name, main category, subcategory, location are non-empty; shows inline error messages
- Review data collected from `FormData(formRef.current)` when advancing to step 5
- "Manage Categories" link shown only when `canManageCategories={true}` (Super Admin only)
- `StepIndicator` shows numbered circles with filled/checked completed steps and red active step
- Existing `upsertAssetAction` unchanged; already redirects to `/assets/${id}?success=asset-saved`

**`app/(dashboard)/assets/new/page.tsx`** (MODIFIED):
- Replaced `AssetForm` import/usage with `AssetWizard`
- Added `canManageCategories` derived from `context.role?.slug === "super_admin"`

**`app/(dashboard)/assets/[id]/edit/page.tsx`** (MODIFIED):
- Replaced `AssetForm` import/usage with `AssetWizard`
- Same `canManageCategories` logic; all asset field mappings unchanged

**`components/assets/asset-form.tsx`** — untouched (can be removed later if no other consumer).

All checks pass: lint ✓, typecheck ✓, build ✓

### P11G — Redesign Reports Module for Complete Maintenance System — COMPLETE

No DB schema changes, no table deletions, no migration changes. Reports module fully redesigned for production maintenance-only scope. All approval/CEO/finance/department-heavy wording removed from UI.

**`lib/reports/data.ts`** (MODIFIED):
- Removed `"pending-approvals"` from `ReportMode` type
- Changed `parseReportMode` default from `"pending-approvals"` to `"overdue"`
- Added `inProgress` and `completed` to `getWorkOrderReport` stats
- Fixed `overdue` stat: now counts active non-terminal WOs past `starting_datetime` (not `next_service_date`)
- Added `getReportLandingStats()`: returns `openWOs`, `overdueWOs`, `criticalAssets`, `lowStockCount` for landing page
- Added `getSparePartsUsageReport()`: flattens `work_order_materials` per work order, returns usage rows
- Added `getLowStockReport()`: returns all parts where `current_stock <= minimum_stock` with shortage calculations
- Added `getAssetRepairHistoryReport()`: groups work orders by asset, returns totals, open ROs, waiting parts counts

**`components/reports/report-mode-nav.tsx`** (MODIFIED):
- Removed `"pending-approvals"` from `MODES` array and removed `ClipboardCheck` import

**`app/(dashboard)/reports/page.tsx`** (NEW — landing page):
- Live stats strip: Open Repair Orders, Overdue, Critical/Breakdown Assets, Low/Out-of-Stock Parts
- 8 report cards: Repair Order Summary, Asset Repair History, Critical Asset Report, Spare Parts Usage, Low Stock Spare Parts, Technician Workload, Preventive Maintenance, Asset Register Report
- Cards link to `/reports/work-orders`, `/reports/asset-history`, `/reports/assets`, `/reports/spare-parts-usage`, `/reports/low-stock`, `/reports/work-orders?report=technician-workload`, `/reports/preventive-maintenance`, `/reports/assets?view=register`
- Cards show live alert badges (e.g. "3 overdue", "5 below minimum") when counts > 0

**`app/(dashboard)/reports/work-orders/page.tsx`** (REWRITTEN):
- Removed entire CEO branch (isCeo early-return, CeoReportModeNav, CeoFilterPanel, CeoPurchaseTable, CeoDeptTable, CeoWOTable, all CEO imports)
- Admin summary cards: replaced old 8-card set with 7 clean cards: Total, Open, In Progress, Waiting for Parts, Completed, Closed, Overdue
- Admin table: removed Department column; added Technician and Action columns; 8 columns total
- Group breakdowns: removed "By Department"; shows By Status + By Type + Monthly Trend
- Manager modes: removed `"pending-approvals"` mode and all references; default mode now `"overdue"`
- Manager mode labels updated: removed approval/purchase/CEO wording
- All cost columns removed from all table views
- Page title: "Repair Order Summary"

**`app/(dashboard)/reports/assets/page.tsx`** (REWRITTEN):
- Title: "Critical Asset Report"
- View toggle: Critical Assets (status=Breakdown/Under Maintenance/Waiting for Parts OR criticality=Critical OR condition=Poor) vs All Assets
- Table columns: Asset, Category, Location, Condition, Criticality, Status, Open ROs, Last Repair, Action (View Asset + ROs)
- Condition and criticality cells color-coded (red for Poor/Critical, amber for Fair/High)
- Status cells use color-coded badge
- Top Breakdown Assets cards retained

**`app/(dashboard)/reports/asset-history/page.tsx`** (NEW):
- Filters: Asset, Date From/To, Status
- Summary: Assets Tracked, Total ROs, Assets with Open ROs
- Table: Asset Code, Asset Name, Category, Location, Total Repairs, Last Repair, Open ROs, Waiting Parts, Action (View Asset + Repair Orders)
- Sorted by open repairs then total repairs
- Empty state: "No repair history found"

**`app/(dashboard)/reports/spare-parts-usage/page.tsx`** (NEW):
- Filters: Date From/To, Asset
- Summary: Parts Usage Records, Unique Parts, Total Quantity
- Table: Part, Part No., Qty Used, Asset/Machine, Repair Order, Date
- Empty state with Package icon: "No parts usage data yet. Parts usage records will appear here after materials are added to repair orders."

**`app/(dashboard)/reports/low-stock/page.tsx`** (NEW):
- No filters (shows all low stock parts)
- Summary: Total Parts, Below Minimum, Out of Stock
- Alert banner when low stock count > 0
- Table: Part, Part No., Current Stock, Minimum Stock, Shortage, Supplier, Bin, Status (Out/Low badge), Action (View Part)
- Empty state: "All parts are sufficiently stocked"

**`components/layout/app-layout.tsx`** (MODIFIED):
- Changed all 5 nav group entries from `href: "/reports/work-orders"` to `href: "/reports"` (CEO, maintenance manager, store keeper, normal user, admin groups)

All checks pass: lint ✓, typecheck ✓, build ✓

### P11F — Asset Category Overview and Category Management UX — COMPLETE

No DB schema changes, no migration changes, no route deletions. Category overview UI added to Assets page. Asset count badges added to Asset Categories admin page. Manage Categories link added to Asset form.

**`app/(dashboard)/assets/page.tsx`** (MODIFIED):
- Added `catOverviewMap: Map<string, number>` derived from existing `categoryChips` raw query (no extra DB queries): maps main category name → total asset count
- Category Overview section added (always visible, above filter chips): header with "Asset Categories" label + "Manage Categories" admin link; grid of compact cards per main category showing asset count or "No assets yet"; clicking a card filters the list; selected card shown with red border/ring
- Improved empty state inside Asset Register: Boxes icon; title "No assets imported yet"; 3 action buttons: Import Excel, New Asset, Manage Categories

**`app/(dashboard)/admin/settings/asset-categories/page.tsx`** (MODIFIED):
- Added `prisma.assets.groupBy` parallel query; built `assetCountMap: Map<string, number>` (lowercase subcategory name → count)
- Added `mainCatAssetCount(mainName, subs)` function: sums direct + subcategory counts
- Stats strip expanded from 3 → 4 tiles: added Total Assets
- Main category row: shows gray count pill when `mainCount > 0`
- Subcategory rows: converted to block arrow function with `const subCount`; shows gray count pill when `subCount > 0`

**`components/assets/asset-form.tsx`** (MODIFIED):
- Added `import Link from "next/link"`
- Added "Need to add a category? Manage Categories" helper link below `<CategorySelectPair>`, linking to `/admin/settings/asset-categories`

**`app/(dashboard)/maintenance/work-orders/page.tsx`** (MODIFIED):
- Simplified from 10 tabs to 6: All, Open, In Progress, Waiting Parts, Completed, Closed
- "Open" is a virtual status mapping to 6 DB statuses via `COMBINED_STATUSES`
- `tabIsActive` updated to handle virtual tab statuses

All checks pass: lint ✓, typecheck ✓, build ✓

### P11E — Asset Category Master + Remove Demo Asset Data — COMPLETE

DB schema change: new `asset_categories` table with self-referential parent/child hierarchy.

**`prisma/migrations/20260709000001_phase11e_asset_categories/migration.sql`** (NEW):
- Creates `asset_categories(id, name, parent_id, is_active, sort_order, created_at, updated_at)` with self-referencing FK (`parent_id → id`, `ON DELETE SET NULL`)
- Seeds 8 main categories: Production Equipment, Vehicles, Heavy Equipment, Electrical Equipment, Workshop Equipment, Facility / Utility, IT / Office Equipment, Other
- Seeds all canonical subcategories via cross-join INSERT with `ON CONFLICT DO NOTHING` (idempotent)
- Three indexes: `parent_id`, `is_active`, `(sort_order, name)`

**`prisma/schema.prisma`** (MODIFIED):
- Added `asset_categories` model with self-referential `"CategoryChildren"` named relation on both `parent` and `children` fields

**`app/actions/asset-categories.ts`** (NEW):
- `createMainCategoryAction`, `createSubcategoryAction`, `toggleCategoryActiveAction`, `renameCategoryAction`
- `loadAllCategories()`, `loadActiveCategories()` — exported async helpers
- `DbCategory` type exported
- All guarded by `requirePermission("admin.settings.manage")`
- All write operations include `writeAuditLog`
- Toggle active deactivation blocked when main category has active children
- Rename catches unique constraint violation and redirects with `?error=name-taken`

**`app/(dashboard)/admin/settings/asset-categories/page.tsx`** (NEW):
- Stats strip: total main categories, total subcategories, total active
- Left panel: New Main Category form + New Subcategory form (parent select) + instructions
- Right panel: Category tree with inline `RenameForm` and activate/deactivate toggle per entry
- `searchParams?: Promise<{ error?: string }>` pattern for Next.js 15 async params
- Error messages decoded from `?error=` search param via `ERROR_MESSAGES` record

**`components/layout/app-layout.tsx`** (MODIFIED):
- Added `{ href: "/admin/settings/asset-categories", label: "Asset Categories", iconKey: "Layers", permission: "admin.settings.manage" }` to Administration nav group

**`components/layout/nav-link.tsx`** (MODIFIED):
- Added `Layers` to lucide-react import and `navIcons` map

**`components/assets/category-select-pair.tsx`** (NEW — "use client"):
- `CategoryOption` type exported; two-select pair (Main Category + Subcategory)
- Main category select is UI-only (no `name`); Subcategory has `name="category"` and is submitted
- Derives `initialMain` from `defaultSubcategory` via parent lookup; handles legacy values (main cat name stored as category) with `(legacy)` fallback option

**`components/assets/asset-form.tsx`** (MODIFIED):
- Replaced hardcoded category `<select>` with `<CategorySelectPair categories={categories} ... />`
- Added `categories: CategoryOption[]` prop

**`app/(dashboard)/assets/new/page.tsx`** (MODIFIED):
- Added `asset_categories` query to `Promise.all`; passes `categories` to `<AssetForm />`

**`app/(dashboard)/assets/[id]/edit/page.tsx`** (MODIFIED):
- Added `asset_categories` query to `Promise.all`; passes `categories` to `<AssetForm />`

**`app/(dashboard)/assets/page.tsx`** (MODIFIED):
- Replaced static `MAIN_CATEGORIES` / `SUBCATEGORIES` / `SUB_TO_MAIN` imports with DB queries to `asset_categories`
- Built `subcatToMain: Map<string, string>`, `getMainCategoryName()`, `subcatNamesForMain()`, `allKnownNames: Set<string>` at runtime
- Category chips, filter dropdowns, WHERE clause, and search expansion all use DB-sourced data

**`app/actions/asset-import.ts`** (MODIFIED):
- Added `CategoryStatus = "matched" | "new"` type; added `category_status?: CategoryStatus` to `ImportPreviewRow`
- `parseAssetExcelAction`: loads `asset_categories` names from DB into case-insensitive Set; tags each row with `category_status`
- `importAssetsAction`: loads `asset_categories`, finds "Other" main category; auto-creates unknown subcategories under "Other" before inserting the asset; audit log includes count of auto-created categories

**`components/assets/asset-import-form.tsx`** (MODIFIED):
- Preview table: Category cell shows `New` blue badge for `category_status === "new"` rows
- Confirmation warning: mentions count of unique new categories that will be auto-created under "Other"

**`scripts/cleanup-demo-assets.mjs`** (NEW):
- Soft-deletes 15 demo assets by asset code + their linked work orders
- Dry-run by default; requires `CONFIRM_DELETE_DEMO_ASSETS=true` env var to execute
- Prints asset list and work order list before acting

All checks pass: lint ✓, typecheck ✓, build ✓

### P11D — Asset Register UI Polish — COMPLETE

No DB schema changes, no migration changes, no table deletions. Assets page and one new optional script only.

**`app/(dashboard)/assets/page.tsx`**:
- Removed `next_service_date` from `AssetRow` type and from the Prisma `select` (field not needed for display; `dueSoonFilter` where-clause still works without it in the select)
- Removed `isOverdue` helper function (no longer used after Next Service column removed)
- Added last-repair query: after the main `Promise.all`, groups `work_orders` by `asset_id` for `status = "Closed"`, `_max: { date_of_order: true }`. Result stored in `lastRepairMap: Map<string, Date | null>`
- Category pills and filter bar now hidden when `totalAssets === 0` (wrapped in `{totalAssets > 0 && (<>...</>)}`)
- Asset register table section now shows three states:
  1. `totalAssets === 0` → professional empty state: "No assets imported yet" title, descriptive message, Import Excel + New Asset action buttons (shown only to `canManage` users)
  2. `count === 0` (filtered, no results) → "No assets match the current filters." with a "Clear filters" link
  3. Normal → full table as before
- "Next Service" column replaced with "Last Repair" column: shows formatted `date_of_order` of most recent closed WO, or "No repair history" when absent
- Search placeholder updated: "Search asset code, name, model, serial, or location…"
- Pagination hidden when `totalAssets === 0`

**`scripts/remove-demo-assets.mjs`** (NEW — optional, do not run automatically):
- Soft-deletes demo assets (AST-CRN-001, AST-BUS-001, AST-TRK-001, AST-FRK-001, AST-GEN-001, AST-BPM-001, AST-HCL-002, AST-ELP-004, AST-CMP-001, AST-CAR-001, AST-WLD-001, AST-GRC-001, AST-PMP-001, AST-TLG-001, AST-PUP-001) and their linked work orders
- Dry-run by default; requires `--confirm` flag to write changes
- Only affects installations that ran the original Supabase migration path (not fresh Prisma installs)

All checks pass: lint ✓, typecheck ✓, build ✓

### P11C — Improve Asset Category Structure — COMPLETE

Scalable 2-level category structure implemented across assets UI, asset form, and Excel import. No DB schema changes, no migration changes, no route deletions.

**`lib/assets/categories.ts`** (NEW — single source of truth):
- `MAIN_CATEGORIES` (8 top-level groups): Production Equipment, Vehicles, Heavy Equipment, Electrical Equipment, Workshop Equipment, Facility / Utility, IT / Office Equipment, Other
- `SUBCATEGORIES` record: canonical subcategory list per main category (e.g., Factory Machine / Batching Plant / Mixer under Production Equipment)
- `SUB_TO_MAIN`: built from canonical subcategories + ~25 legacy aliases (handles existing DB values like "Factory Machine", "HVAC", "Building/Facility", "Vehicle", etc.)
- `getMainCategory(category)`: returns `MainCategory`, defaults to "Other"
- `isMainCategory(value)`: type guard for `MainCategory`

**`app/(dashboard)/assets/page.tsx`**:
- Removed inline `SUB_TO_MAIN`, `TOP_LEVEL_ORDER`, `getMainCategory` — replaced with import from `@/lib/assets/categories`
- Main category pills now use `MAIN_CATEGORIES` (new names: Production Equipment, Vehicles, etc.)
- Search OR expanded: if search term matches a main category name, all its subcategories are added as `{ category: { in: [...] } }` OR clause
- Filter form: replaced hidden `main_category` input with explicit `<select name="main_category">` using `MAIN_CATEGORIES`; subcategory options come from `SUBCATEGORIES[mainCategory]` when a main category is active (all canonical subcategories shown, not just DB-existing ones)
- Table: "Category" header renamed "Main Category"; Status and Next Service columns swapped (Status before Next Service)

**`components/assets/asset-form.tsx`**:
- Removed flat `assetCategories` array
- Category `<select>` now uses `<optgroup>` per main category with canonical subcategories as options; posted value is the subcategory (stored in `category` column)

**`app/actions/asset-import.ts`**:
- Added `assettype` to `HEADER_MAP` → maps to `category` field
- Added `SUBCATEGORY_HEADER_NAMES` set: recognizes "Subcategory", "Subcat", "Sub", "Asset Subcategory", "Subtype" column headers
- During header scan, subcategory column numbers tracked in `subCatColNums`
- Row parsing: if a subcategory column is found and has a value, it wins over the plain "Category" / "Type" column
- Unknown category values are NOT rejected — they are stored as-is (appear under "Other" in the UI)

All checks pass: lint ✓, typecheck ✓, build ✓

### P11B — Assets and Spare Parts UI + Category Structure — COMPLETE

UI-only cleanup. No DB schema changes, no route deletions, no migration changes.

**`app/(dashboard)/assets/page.tsx`:**
- Added `SUB_TO_MAIN: Record<string, string | undefined>` mapping (47 DB categories → 6 top-level groups: Production, Vehicles, Heavy Equipment, Electrical, Utilities, Workshop; anything else → "Other")
- Added `TOP_LEVEL_ORDER` array and `getMainCategory(cat)` helper
- Added `main_category` to `AssetsPageProps` searchParams type
- Where clause: when `main_category` is set and no specific `category`, filters by `{ category: { in: subcats } }` (or `{ notIn: Object.keys(SUB_TO_MAIN) }` for "Other")
- Category filter chips replaced with top-level category pills — only shows groups that have assets; clicking a pill sets `main_category`, clears `category`
- Filter form: "Category" dropdown renamed to "Subcategory"; options filtered to the active `main_category` group when set; hidden `<input name="main_category">` preserves top-level selection through form submit
- Table: added Subcategory column (DB category value); Category column now shows top-level (`getMainCategory()`); `min-w-[900px]` → `min-w-[1100px]`; `colSpan` updated 8 → 9
- `filterHref` and `Pagination` updated to carry `main_category` param

**`app/(dashboard)/store/parts/page.tsx`:**
- Description updated: "Track repair materials, stock balance, and part availability."
- KPI labels: "Active stock" → "In Stock", "Unavailable" → "Out of Stock"
- Removed `unit_price` from Prisma select
- Removed `unit_price` column (header + cell, including `CostVisibilityGuard` usage)
- Removed standalone SS Rec column (header + cell); `ss_rec_code` folded into Part cell as small muted text below part name
- Column order: Part, Part No., Category, Stock, Minimum, Supplier, Bin, Health (8 columns); `min-w-[1120px]` → `min-w-[900px]`
- Removed `formatMoney` function and `CostVisibilityGuard` import (both now unused)
- Note: Action column requires a `/store/parts/[id]` detail route (not yet created); skipped to avoid dead links

All checks pass: lint ✓, typecheck ✓, build ✓

### P11A — Asset and Spare Parts Relationship Restructure — COMPLETE

UI restructure to clarify the Assets (machines) vs Spare Parts (inventory) relationship. No DB schema changes, no table deletions, no migration changes.

**`components/layout/app-layout.tsx`** — Removed `/store/parts-requests` from all 4 nav groups (normalUser, maintenanceManager, storeKeeper, navigationGroups/superAdmin). The route and backend remain fully intact — accessible via direct URL. `proxy.ts` not modified.

**`app/(dashboard)/assets/page.tsx`** — Extended asset search OR conditions to include `model` and `category` (previously only code, name, serial, plate, location). Updated placeholder text.

**`lib/backend/assets/service.ts`** — Added `AssetPartsUsedRow` type and `partsUsed: AssetPartsUsedRow[]` to `AssetMaintenanceSummary`. Per-repair-order flat rows: work order number, date, technician names, material name, part number, quantity. Sorted most-recent-first, capped at 100 rows. Existing `materials` aggregation preserved.

**`app/(dashboard)/assets/[id]/page.tsx`** — Replaced aggregated "Materials & Parts Used" section with new "Parts Used" table showing per-repair-order rows (part, part no., qty, repair order link, date, technician). Aggregated totals kept in a collapsible `<details>` block below for reference.

**`app/actions/maintenance.ts`** — Added `addWorkOrderMaterialAction`: requires `work_orders.manage`, validates work order exists and is not in terminal status, resolves part info from `parts` table by part_id, creates `work_order_materials` row (no stock deduction), writes audit log, redirects with `?success=material-added`.

**`app/(dashboard)/maintenance/work-orders/[id]/page.tsx`** — Added "Record parts used" inline form inside the `#parts` section (visible to `canManage` on non-terminal work orders): spare part select (from existing parts dropdown), quantity input, submit. Added `material-added` success banner. Imported `addWorkOrderMaterialAction`.

Assets page: Tasks 2, 3, 4 were already implemented (clean register with category chips, KPI cards, right table columns — no changes needed). Spare Parts page: Task 7 already correct (unit price behind `CostVisibilityGuard`).

All checks pass: lint ✓, typecheck ✓, build ✓

### P10F — Users Page Layout Redesign — COMPLETE

Moved Create User form from permanent left column into a right-side slide-in drawer. Page is now full-width.

**`components/admin/create-user-drawer.tsx`** — New "use client" component:
- `<CreateUserDrawer initialOpen?>` renders a trigger `<Button>` and a fixed overlay with a `max-w-md` aside panel
- Slide-in/out via `translate-x-0` / `translate-x-full` + `transition-transform duration-200`; backdrop fade via `transition-opacity`
- Escape key closes; body scroll locked while open
- Form uses `action={createLocalUserAction}` directly; action always calls `redirect()` so navigation closes the drawer naturally

**`components/admin/users-directory.tsx`** — New "use client" component replacing the static server-rendered table:
- `SerializedProfile` and `SerializedAuthUser` types exported for the page
- Client-side search (name, email, employee number) + 3-way status filter (All/Active/Inactive) via `useMemo`
- Toolbar embedded in section header alongside result count
- Inline account type form preserves `phone`, `job_title`, `department_id`, `can_view_costs` via hidden fields

**`app/(dashboard)/admin/users/page.tsx`** — Rewritten:
- Removed left-column create form; `<CreateUserDrawer>` passed to `<PageHeader actions>`; auto-opens on create-specific errors
- Compact KPI cards: `text-2xl`, `px-4 py-3`; inline success/error banner
- Serializes profiles (no raw Date fields) before passing to `<UsersDirectory>`

All checks pass: lint ✓, typecheck ✓, build ✓

### P11 — Asset-Linked Repair Order Creation Flow — COMPLETE

Improved the end-to-end flow for creating and viewing repair orders linked to assets. No DB schema changes, no migration changes, no route deletions.

**`components/work-orders/work-order-form.tsx`:**
- Added `FullAssetOption` type (`AssetOption` extended with `location`, `status`, `condition`, `criticality`, `brand`, `model`)
- Added `preselectedAsset?: FullAssetOption | null` prop (default `null`)
- In the `isNew` branch: added a prominent "Machine / Asset" section card rendered **before** the paper-form grid. When `preselectedAsset` is provided, shows a locked green summary card (asset code, name, category·location, status/condition/criticality chips, brand/model, "View asset profile →" link) with a `<input type="hidden" name="asset_id">`. When not provided, shows a full-width `<select>` dropdown with asset code + name + category + plate in each option.
- Removed the old "Machine / asset" select from inside the paper-form table; restructured rows: serial/plate + start/end datetime now share a row; running hours/kms moved to a full-width colSpan=2 row

**`app/(dashboard)/maintenance/work-orders/new/page.tsx`:**
- Added a fourth parallel query: when `preselectedAssetId` is set, fetches the full asset record (id, asset_code, asset_name, category, serial_number, plate_number, location, status, condition, criticality, brand, model) via `findUnique`
- Passes `preselectedAsset={preselectedAsset ?? null}` to `WorkOrderForm`

**`app/(dashboard)/maintenance/work-orders/[id]/page.tsx`:**
- Added `Condition` and `Criticality` `InfoBlock` entries to the Linked Asset section's detail grid (values default to "Not set" when null); `assets: true` include already provided all fields

**`app/(dashboard)/maintenance/work-orders/page.tsx`:**
- Added `{ assets: { asset_code: { contains: search } } }` to the standard-view search OR conditions (joins asset_code to the existing asset_name + plate_number search)

All checks pass: lint ✓, typecheck ✓, build ✓

### P1 — Phase 1 UI Cleanup — COMPLETE

Scope change applied. System is now branded and navigated as RECAFCO Maintenance Department System.

Changes made (no database changes, no route deletions):
- `components/layout/brand-logo.tsx`: Default subtitle → "Maintenance & Asset Management"
- `components/layout/app-layout.tsx`: Sidebar subtitle, header label, and default navigation refactored — removed CEO Approvals, Assignments, Finance, Purchase, Inventory Moves from the Super Admin/default nav; removed Purchase from Maintenance Manager nav; split into "Maintenance" and "Assets & Store" groups
- `components/layout/mobile-navigation.tsx`: "RECAFCO MMS" → "RECAFCO Maintenance Dept."
- `app/(auth)/login/page.tsx`: Login branding updated
- `app/(auth)/layout.tsx`: Auth sidebar copy updated
- `app/(dashboard)/dashboard/page.tsx`: Removed Finance/CEO and Purchase Queue from generic stat arrays (criticalStats, secondaryStats, operationStats); CEO and Finance dashboards remain intact for those specific roles

All checks pass: lint ✓, typecheck ✓, build ✓ (41 static, 63 dynamic routes)

### P2 — Phase 2 Navigation Cleanup — COMPLETE

Reduced Administration and System Control nav to maintenance-department scope only. No database changes, no route or backend deletions.

Changes made:
- `components/layout/app-layout.tsx`: Administration — removed Departments and Notification Settings; System Control — removed Architecture, System Map, Map Editor, Demo Guide; kept Users, Roles, Notifications, Settings, Audit Logs, System Health
- `app/(dashboard)/dashboard/page.tsx`: Removed Departments shortcut from globalControlActions
- `app/(dashboard)/admin/system-health/page.tsx`: Removed "Notification logs" button (link to /admin/notification-settings)
- `proxy.ts`: Added disabled-routes redirect block — 6 routes redirected to /dashboard before auth enforcement: /admin/departments, /admin/notification-settings, /admin/architecture, /admin/system-map, /admin/system-map/edit, /admin/demo-guide

All checks pass: lint ✓, typecheck ✓, build ✓ (41 static, 63 dynamic routes)

### P3 — Two-Account Model UI — COMPLETE

Simplified the user/role system to a two-account-type model (System Administrator / Normal User). No database schema changes, no role or table deletions.

Changes made:
- `app/actions/admin.ts`: `createLocalUserAction` now accepts an `account_type` field (`system_admin` or `normal_user`) and resolves it to the correct role_id (super_admin or maintenance_data_entry) before schema validation
- `app/(dashboard)/admin/users/page.tsx`: Create form — removed Department dropdown, Job Title field, complex role dropdown; replaced with Account Type selector (default: Normal User). Profile directory table — removed Department column, replaced Role column with Account Type column (simplified two-option selector). Unlinked auth users section simplified to match. Removed `inferRoleSlug`, `inferDepartmentCode` helper functions; removed departments DB fetch
- `app/(dashboard)/admin/users/[id]/page.tsx`: Profile details shows "Account Type" (System Administrator / Normal User) instead of raw role name. Change Role card simplified to "Change account type" with only two options. Status badge shows account type label. Removed unused `roleLabels` and `RoleSlug` imports
- `components/layout/app-layout.tsx`: Added `normalUserNavigationGroups` — same Maintenance + Assets & Store sections as Super Admin nav but without Administration and System Control. Replaced `dataEntryNavigationGroups` (removed). Updated nav group mapping: `super_admin` → full nav; all non-special roles → `normalUserNavigationGroups`

Access control behavior:
- System Administrator (super_admin): full nav including Administration and System Control; bypasses all permission checks
- Normal User (maintenance_data_entry + all other non-special roles): sees Maintenance + Assets & Store + Account (Notifications) only; navigating to any admin URL redirects to `/dashboard?error=permission-denied` via existing `requirePermission()` guards

All checks pass: lint ✓, typecheck ✓, build ✓ (41 static, 63 dynamic routes)

### P10E — Users Page Cleanup (Two-Account Model) — COMPLETE

Simplified `app/(dashboard)/admin/users/page.tsx` to match the two-account-type maintenance system. No DB schema changes, no role or table deletions, no auth/session changes.

**Subtitle:** "Create user accounts and manage system access."

**KPI cards (5 → 4):**
- Total Users (was "Total profiles")
- Active Users (unchanged)
- System Administrators (new — count where role slug = super_admin)
- Normal Users (new — total minus sysAdminCount)
- Removed: No Role Assigned, No Login Account, Must Reset Password

**Create User form:**
- Removed: "Can view costs" checkbox
- Changed description: "Create a login account for maintenance system users." (removed bcrypt mention)
- Fields kept: Email, Temporary password, Full name, Employee number (optional), Phone (optional), Account type (default Normal User), Active checkbox

**User Directory:**
- Renamed section heading from "Profile Directory" to "User Directory"
- Changed helper text to "Manage user account type and access status."
- Removed "Archived" tab from UI (backend still handles `?view=archived` URL)
- Table: removed "No employee ID" placeholder text; employee number only shown when set; removed job_title display; removed "Role required" warning badge
- Status column: removed "Costs" badge (can_view_costs no longer surfaced in list)
- Inline account type dropdown: removed "No role" option; two options only — Normal User / System Administrator; `defaultValue` falls back to `normalUserRoleId` for unassigned profiles
- All existing hidden fields (job_title, department_id, can_view_costs) preserved in inline form to avoid unintended data loss on account-type save

**Section removed:** "Profiles Without Login Accounts" (technical admin debug section, not needed in production UI)

**Access control (no code changes required):**
- Normal User: blocked from all `/admin/*` routes via `requirePermission("admin.users.manage")` guard
- Sidebar navigation: `normalUserNavigationGroups` has no admin entries; super_admin sees full nav
- Confirmed: normal users cannot reach Users, Roles, Settings, Audit Logs, or System Health

**Removed import:** `AlertTriangle` (no longer used after removing "Role required" badge)
**Removed queries:** `archivedCount` (no longer shown in UI)

All checks pass: lint ✓, typecheck ✓, build ✓

### P10D — Assets Page UI Cleanup — COMPLETE

Rewrote the standard (non-CEO) view of `app/(dashboard)/assets/page.tsx` into a clean Asset Register. No DB schema changes, no route deletions, no migration changes. CEO early-return section kept 100% intact.

**Sections removed:**
- Large colorful category cards grid (Grouped Asset Register section)
- "Operational risk" red alert strip (breakdown / waiting-for-parts banner)
- Status Mix panel (right-side card listing each status with count)
- Due-soon amber filter banner
- Spare Parts and Unavailable Parts KPI cards
- Due in 30 Days KPI card

**KPI cards (4, all-time counts, not filtered):**
- Total Assets → `/assets`
- Critical Assets (Breakdown or Out of Service) → `/assets?status=Breakdown`
- Poor Condition (condition=Poor or Out of Service) → `/assets?condition=Poor`
- Waiting / Maintenance (Waiting for Parts or Under Maintenance) → `/assets?status=Waiting+for+Parts`

**New category filter chips:**
Replaced large cards with compact pill-shaped `<Link>` chips. "All" chip clears category; each category chip applies a category filter while preserving all other active filters. Count shown in muted text next to each chip label.

**Filter bar:**
Single horizontal flex-wrap bar with: search (expands to fill), location, category dropdown, status dropdown, condition dropdown, criticality dropdown, Apply button, and conditional Reset link (only shown when any filter is active). All inputs use `h-9` for consistent height. Search placeholder: "Search asset code, machine name, serial number, or location...".

**Table changes:**
- Added "Action" column (8th column, right-aligned "View" button linking to `/assets/{id}`)
- "Asset / Machine" column now shows model · serial_number on a third line when available
- Null condition → "Not set" (grey text); null criticality → "Not set" (grey text)
- Row highlight: red-50 for Breakdown/Out of Service only
- `colSpan` on empty-state row updated to 8

**Access control:**
Import Excel and New Asset buttons now gated — only rendered for `super_admin` role or users with `assets.manage` permission. Normal users see the register read-only.

**Removed helpers:** `categoryIconMap`, `categoryUrgency`, `categoryCardClass`, `categoryIconClass`, `statusDotClass`, `CategorySummary` (full), `StatusSummary`, `PartInventorySummary` types.
**Removed imports:** `CalendarClock`, `Component`, `Factory`, `Forklift`, `Truck` (no longer used after category cards removed).

Queries simplified: removed `statusSummaries`, `partSummaryRows`, `dueSoonCount` parallel queries; added `criticalStatusCount`, `poorConditionCount`, `waitingCount` count queries; simplified `categoryChips` SQL (category + count only).

All checks pass: lint ✓, typecheck ✓, build ✓

### P10C — Fix /assets Page Runtime Error — COMPLETE

Root cause: migration `20260708000001_phase7_asset_condition_criticality` added `condition`, `criticality`, and `remarks` columns to the `assets` table. `prisma generate` was subsequently run and regenerated the TypeScript types correctly (`node_modules/.prisma/client/index.d.ts` had `condition: string | null`). However, the running Turbopack dev server had compiled and cached an older bundle of the Prisma client module before the regeneration. The Turbopack cache in `.next/` still used the pre-migration DMMF, so at runtime Prisma's field validator threw `Unknown field 'condition' for select statement on model 'assets'`, causing the error boundary to catch it and render "This module could not load".

Fix applied:
- Deleted `.next/` to clear the stale Turbopack compiled bundle. No page code changes were required — the page's select/where usage of `condition`, `criticality`, and `next_service_date` is correct and matches the migrated schema.
- Attempted `prisma generate` during fix: EPERM on the query engine DLL because the dev server had it open; but the DLL and TypeScript types were already at the correct post-migration version (confirmed by standalone Prisma query tests passing for `condition`/`criticality`).

Dev server note: after clearing `.next/`, restarting the dev server will recompile with the current Prisma client. The production build rebuilds from scratch each time and is unaffected.

No database changes. No schema changes. No code changes.

All checks pass: lint ✓, typecheck ✓, build ✓

### P10B — Dashboard Redesign — COMPLETE

Complete rewrite of `app/(dashboard)/dashboard/page.tsx` (1887 lines → ~290 lines). No DB schema changes, no route deletions, no backend workflow changes.

**Removed entirely:**
- `CeoExecutiveDashboard` component (CEO-only executive view)
- `SystemStatusCard` component (platform/DB/backup/sessions/login status)
- `RiskAlertCard` and `CeoFinancialLine` helper components
- All role-specific stat arrays: `primaryStats`, `secondaryStats`, `criticalStats`, `operationStats`, `dataEntryStats`, `managerDecisionStats`, `managerOperationStats`, `managerWorkflowStats`, `ceoAttentionStats`, `ceoRiskStats`, `financeDecisionStats`, `financeCostStats`, `financeRiskStats`, `adminStats`
- All role-specific sections: Super Admin Command Center, Needs Action Now, System Status, Manager Workspace header, Finance Approval Cockpit, Cost Approval Queue, Maintenance Workflow Overview / Repair Order Flow, Master Data and Security Overview, Supervisor/Technician/Parts Queue, Cost and Purchase Risk, Finance Report Access, Cost Review Overview, System Readiness, Current User card, In-App Notifications section, Recent Audit Activity section
- All approval-queue tables (manager approval queue, CEO decision queue)
- Security queries: active sessions, locked accounts, failed logins, backup status
- CEO/finance/manager/data-entry conditional branches
- 50+ DB queries reduced to 6 count queries + 2 `findMany` queries

**New layout (same for all roles):**
- Title: "Dashboard" / "Monitor assets, repair orders, machine condition, and maintenance activity."
- 4 quick action buttons: Create Repair Order, Add Asset, Import Assets, View Repair Orders
- 6 KPI cards: Total Assets, Total Repair Orders, Open Repair Orders, In Progress, Waiting for Parts, Closed (each links to the relevant filtered list)
- "Assets Requiring Attention" section: shows up to 6 assets with condition=Critical/Poor, criticality=Critical, or overdue next_service_date; shows "All assets healthy" when none match
- "Recent Repair Orders" table: 8 most recent rows — No., Asset, Issue/Problem (operator_complaint or maintenance_type), Status (via displayStatus()), Priority, Date, View button; red tint for Urgent/Rejected rows, amber for Waiting rows
- `getWorkOrderVisibilityFilter(context)` applied to all work order queries

**Imports remaining:** `Link`, lucide icons (AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, FileSpreadsheet, Gauge, PlusCircle, Upload, Wrench), `StatCard`, `PageHeader`, `StatusBadge`, `requireUser`, `prisma`, `formatDateTime`, `displayStatus`, `getWorkOrderVisibilityFilter`

All checks pass: lint ✓, typecheck ✓, build ✓

### P10A — Remove Unnecessary Action Badges and Approval-Style Buttons — COMPLETE

UI-only cleanup on the Repair Orders list page. No DB changes, no backend changes, no route deletions.

**`app/(dashboard)/maintenance/work-orders/page.tsx`:**

- Removed the "N submitted" amber badge from the Repair Order Records table header — header now shows only record count and "Clear filters" link
- Removed the amber dot indicator (`bg-amber-500` circle) from table rows — approval-workflow feeling eliminated
- Deleted `rowNeedsAction` function (no longer needed after removing the dot and the generic Act button)
- Added `getRowActLabel(status, context)` helper — returns a specific label (`"Assign"`, `"Parts"`, `"Close"`) or `null` (View-only row)
- Replaced generic `"Act"` button with labeled button using `actLabel` — only shown for roles with a direct action at that status; `null` rows get View only
- Simplified `getNextAction` labels: role-blind, plain English — "Assign technician", "Technician to start", "Job in progress", "Waiting for parts", "Close repair order", "Closed", "Rejected"
- Updated `rowBg` — removed Submitted/Pending Approval from amber tint; red only for Rejected/Cancelled, Overdue, Urgent; amber only for Waiting for Parts/Purchase; blue for active; green for closed/completed

**Action button mapping:**
| Status | Button shown for |
|---|---|
| Submitted / Pending Approval | `Assign` — users with `work_orders.approve` |
| Approved | `Assign` — users with `work_orders.assign` |
| Waiting for Parts / Purchase | `Parts` — users with `store.issue` |
| Completed / Verified / Confirmed | `Close` — users with approve or assign |
| All others | View only |

All checks pass: lint ✓, typecheck ✓, build ✓

### P9B — Remove Approval System / Final Repair Orders UI Polish — COMPLETE

UI-only cleanup. No DB schema changes, no status string changes, no workflow action deletions, no route deletions.

**Business decision confirmed:** RECAFCO Maintenance & Asset Management is maintenance-department-only. There is no CEO approval, no finance approval, no cross-department approval, no formal supervisor approval workflow. Simplified lifecycle: Asset/Machine → Repair Order → Assign Technician → In Progress → Waiting for Parts (if needed) → Completed → Closed.

**`lib/display/work-order-labels.ts`** — expanded `displayStatus` mapping (7 entries):
- "Pending Approval" → "Submitted"
- "Approved" → "Ready to Assign"
- "Waiting for Purchase" → "Waiting for Parts"
- "Parts Issued" → "In Progress"
- "Completed by Technician" → "Completed"
- "Verified by Supervisor" → "Pending Closure"
- "Confirmed by Requester" → "Pending Closure"
- Updated `displayNextAction`: "Submit repair order", "Proceed to assignment", "Awaiting assignment"

**`components/layout/app-layout.tsx`** — Supervisor Review link removed from all three nav groups (maintenanceManagerNavigationGroups, normalUserNavigationGroups, navigationGroups). Maintenance group now 3 items: Repair Orders, My Jobs, Reports (plus Assignments for manager).

**`app/(dashboard)/maintenance/approvals/page.tsx`** — replaced with redirect to `/maintenance/work-orders`.

**`app/(dashboard)/maintenance/work-orders/page.tsx`** — major update:
- Added `displayStatus` import
- Added `COMBINED_STATUSES` constant + `expandStatuses`, `tabCount`, `tabIsActive` helpers to support tabs that span multiple DB statuses
- TAB_LIST reduced from 13 to 10 tabs: removed "Pending Review" (Pending Approval), "Parts On Order" (Waiting for Purchase), "Verified" (Verified by Supervisor)
- "Submitted" tab now covers Submitted + Pending Approval via `expandStatuses`; "In Progress" covers In Progress + Parts Issued; "Waiting Parts" covers Waiting for Parts + Waiting for Purchase; "Completed" covers Completed by Technician + Verified by Supervisor + Confirmed by Requester
- List filter updated to expand combined statuses into `{ status: { in: [...] } }` when needed
- `pendingApproval` variable renamed to `submittedCount`
- KPI card: "Pending Review" → "Submitted", href updated to `?status=Submitted`, detail updated
- Header badge: "N pending review" → "N submitted"
- Tab bar rendering uses `tabIsActive` and combined `tabCount`
- Quick Filters: super_admin and maintenance_manager "Pending Review" → "Submitted"
- `getNextAction`: "Submit for review" → "Submit repair order"; "Review / Decide" → "Proceed to assignment"; "Awaiting supervisor review" → "Awaiting assignment"
- Table status badge: `label={wo.status}` → `label={displayStatus(wo.status)}`

**`components/work-orders/workflow-actions.tsx`** — label updates:
- "Submit for supervisor review" → "Submit Repair Order"
- "Approve repair order" → "Proceed to assignment"
- "submit again for supervisor review" → "resubmit"

**`app/(dashboard)/maintenance/work-orders/[id]/page.tsx`** — text/banner cleanup:
- Status badge: `label={wo.status}` → `label={displayStatus(wo.status)}`
- Recovery-draft banner: "resubmit for supervisor review" → "resubmit"
- Clarification-responded banner: "supervisor notified / can now approve or reject" → "repair order will now be processed for assignment"
- Clarification-sent banner: "status remains Pending Review until you approve or reject" → "creator will provide the requested information"
- Pending clarification header: "Clarification requested by supervisor" → "More information requested"
- Pending clarification respond hint: "back for supervisor review / status remains Pending Review" → "back for processing / proceed to assignment once reviewed"
- Work description fallback: removed "before approval" phrase
- `currentBlocker()`: "Manager approval needed" → "Awaiting assignment" for Submitted/Pending Approval

**`components/work-orders/work-order-form.tsx`** — new form button/hint:
- Description: "Submit sends this request for supervisor review." → "Submit sends this repair order for assignment."
- Button: "Submit for Review" → "Submit Repair Order" (value="submit_for_approval" unchanged — backend intent key stays)

All checks pass: lint ✓, typecheck ✓, build ✓

### P9 — Repair Orders UI Simplification — COMPLETE

UI-only redesign of the Repair Orders list page and sidebar navigation. No DB changes, no status string changes, no route deletions.

**`app/(dashboard)/maintenance/work-orders/page.tsx`** — updated:

Page header:
- Subtitle changed from `getRoleDescription(context)` to "Track asset repair requests, technician work, waiting parts, and repair history."
- `getRoleDescription` import removed (no longer used in this file)
- "Create Request" → "Create Repair Order"; dropdown header "Select Form Type" → "What needs repair?"; first option label "Maintenance Work Order" → "Asset / Machine Repair"; hint text updated to asset-first language

KPI cards:
- Reduced from 8 to 6 cards; grid changed from `grid-cols-4` to `sm:grid-cols-3 lg:grid-cols-6`
- Removed: "High / Urgent" card (used `Zap` icon + `urgentHigh` count) and "Parts Order Pending" card (`ShoppingCart` icon + `waitingPurchase` count)
- Retained: Total, Pending Review, Active Jobs, Waiting for Parts, Overdue, Closed
- `ShoppingCart` import removed; `urgentHigh` / `waitingPurchase` computed vars removed; `countPriority` helper removed; `PrioritySummary` type removed; `prioritySummaries` parallel query removed

Quick Filters (was Quick Actions):
- Section heading changed from "Quick actions — {role name}" → "Quick Filters"
- super_admin: "Pending Approval" → "Pending Review", "All Work Orders" → "All Repair Orders"
- maintenance_manager: "Needs Approval" → "Pending Review", "Waiting Purchase" → "Waiting Parts"
- purchase_officer: "Waiting Purchase" → "Parts On Order"

Filters (FilterSection):
- Removed Department dropdown and Worker Type dropdown from visible UI
- Search placeholder updated to "Repair order no., asset name, requester, location…"
- Grid simplified from `xl:grid-cols-6` to `xl:grid-cols-5`
- Department and worker_type URL params still parsed and applied server-side for backwards compatibility
- Departments DB fetch removed from parallel query; `departmentFilterWhere` removed; `Department` type removed; `WORKER_TYPES` constant removed

Status tabs (TAB_LIST):
- `{ label: "Waiting (Order)", status: "Waiting for Purchase" }` → `{ label: "Parts On Order", status: "Waiting for Purchase" }`
- `{ label: "Approved", status: "Approved" }` → `{ label: "Ready to Assign", status: "Approved" }`

Table columns:
- "Work Order" → "Repair Order"
- "Asset / Vehicle" → "Asset / Machine"
- Removed "Department" column
- Removed "Type" column
- Added "Issue / Problem" column (shows `operator_complaint`, line-clamp-2, max-w-[180px])
- `operator_complaint: true` added to Prisma select
- `colSpan` updated from 9 to 8; `min-w` updated from 1120px to 1040px

Row design:
- Row color coding added via inline `rowBg` IIFE:
  - Red tint: Rejected / Cancelled, or Overdue, or Urgent
  - Amber tint: Waiting for Parts / Waiting for Purchase / Submitted / Pending Approval
  - Blue tint: Assigned / In Progress / Parts Issued / Approved
  - Green tint: Closed / Completed / Verified / Confirmed
- Removed left-border urgent stripe (replaced by row background)
- `isUrgent` variable removed

Action buttons:
- View button (always shown, secondary border style) + Act button (only shown when needsAct, red primary style) as separate elements
- Print icon unchanged
- "Print work order" title → "Print repair order"

Other text:
- Record count: "total work orders" → "total repair orders"
- "need approval" badge → "pending review"
- Empty state titles and messages updated from "work orders" to "repair orders"
- Pagination counter: "work orders" → "repair orders"

**`components/layout/app-layout.tsx`** — updated:
- `label: "Approvals"` → `label: "Supervisor Review"` in all three nav groups: `normalUserNavigationGroups`, `maintenanceManagerNavigationGroups`, `navigationGroups`

All checks pass: lint ✓, typecheck ✓, build ✓ (no route count change)

### P8 — Production-Safe Asset Import — COMPLETE

Improved import safety, traceability, and duplicate handling. No schema changes, no route deletions.

**`components/assets/asset-import-form.tsx`** — full rewrite:

Preview step:
- 5-stat summary strip: Total rows / Ready to import / Duplicate in file / Duplicate in DB / Validation errors — each with color-coded border (green=ready, amber=dup, red=invalid, neutral=total)
- Color-coded table rows: white=ready, amber=dup, red=invalid
- Result badge shows specific error type: "Ready", "Dup (file)", "Dup (DB)", or the first validation error text; title attribute shows all errors on hover
- Preview table columns updated: Row, Asset Code, Asset Name, Category, Department, Status, Condition, Criticality, Result (added Condition/Criticality from P7; removed Manufacturer which is less useful in the preview)
- Confirmation warning block (amber callout) with bullet list and a required checkbox: "I have reviewed the rows above and confirm I want to import N assets." Import button stays disabled until checkbox is ticked.
- Import button: disabled unless `confirmed === true` and `validRows.length > 0`

Done step:
- Stats strip: Imported (green) / Skipped duplicate (amber) / Failed error (red) — failures split by type
- "Rows not imported" table rows are colored amber for duplicates, red for other failures
- Added "Import history" link button below the View assets button

Upload step:
- Column reference table updated to include Condition, Criticality, Remarks columns from P7
- Added "Existing asset codes are never overwritten" note

Error classification helpers (module-level):
- `isDupFile(row)` — error includes "Duplicate code in this file"
- `isDupDb(row)` — error includes "already exists in database" (exclusive of dupFile)
- `rowTone(row)` → "valid" | "dup" | "invalid"
- `rowLabel(row)` → display string for the Result badge

**`app/(dashboard)/assets/import/history/page.tsx`** — new:
- Gated by `assets.manage`
- Queries `audit_logs` where `action = "asset.import"`, ordered by `created_at desc`, `take: 50`
- Loads actor profiles for all actor_ids in one batch query
- Table: Date/Time, Imported by, Total rows, Imported (green badge), Skipped (amber badge), Failed (red badge), Summary
- Colored badge counts: only shows colored badge when count > 0; shows plain "0" otherwise
- Empty state when no import operations exist yet

**`app/(dashboard)/assets/import/page.tsx`** — updated:
- Added "Import history" button link to `/assets/import/history` in PageHeader actions
- Updated description to mention duplicate handling behavior

**Access control** (unchanged):
- `assets.manage` required for import (`parseAssetExcelAction`, `importAssetsAction`, `/assets/import`, `/assets/import/history`)
- `assets.view` users can view assets but cannot access import pages

**Duplicate behavior** (clarified, not changed):
- parseAssetExcelAction detects duplicates against DB (fetched once before loop) and within the file (seenCodes Set)
- importAssetsAction re-checks both on the server side before creating each asset
- No asset is ever overwritten — codes that already exist are skipped with a failure entry

All checks pass: lint ✓, typecheck ✓, build ✓ (41 static, 65 dynamic routes — /assets/import/history added)

### P7 — Asset Master Data Finalization — COMPLETE

New nullable fields on the assets table, fully wired through form, list, detail, and Excel import. No destructive changes. No data loss. All existing asset records remain valid.

**Migration created and applied:**

`prisma/migrations/20260708000001_phase7_asset_condition_criticality/migration.sql`:
- `ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "condition" TEXT`
- `ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "criticality" TEXT`
- `ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "remarks" TEXT`
- Partial indexes on `condition` and `criticality` (where `deleted_at IS NULL`)

`prisma/schema.prisma`: added `condition String?`, `criticality String?`, `remarks String?` to `assets` model with corresponding `@@index` entries.

Prior migrations baselined via `prisma migrate resolve --applied` (0_init, phase5c, phase5e1) so `prisma migrate deploy` could track history. Prisma client types updated successfully (DLL rename EPERM on Windows is cosmetic — types in `index.d.ts` confirmed updated).

**Files changed:**

`app/actions/maintenance.ts`:
- Added `condition: optionalString`, `criticality: optionalString`, `remarks: optionalString` to `assetSchema`
- Both fields pass through to `prisma.assets.create` and `prisma.assets.update` via the existing `clean({ ...values })` spread

`components/assets/asset-form.tsx`:
- New "Condition and Risk Classification" `FormSection` added after "Status and Next Service"
- Physical condition dropdown (Excellent / Good / Fair / Poor / Out of Service; blank = "Not assessed")
- Criticality dropdown (Critical / High / Medium / Low; blank = "Not classified")
- Remarks textarea

`app/(dashboard)/assets/[id]/edit/page.tsx`:
- Passes `condition`, `criticality`, `remarks` from `rawAsset` to the form

`app/(dashboard)/assets/page.tsx`:
- `searchParams` type: added `condition?` and `criticality?`
- `params` destructuring: added `condition` and `criticality` variables
- `where` clause: added `condition` and `criticality` exact-match filters
- `AssetRow` type: added `condition: string | null` and `criticality: string | null`; removed `current_kilometer_reading` and `current_running_hours` (columns replaced in table)
- Prisma `select`: added `condition`, `criticality`; removed `current_kilometer_reading`, `current_running_hours`
- Filter form: expanded to 7-col xl grid; added Condition and Criticality `<select>` dropdowns
- Asset table: replaced KM/Hours columns with Condition and Criticality; both render as colored inline badges using `conditionClass()` / `criticalityClass()` helpers; `—` shown when null
- `filterHref()`: added `condition` and `criticality` params
- `Pagination`: added `condition` and `criticality` props
- New helper functions: `conditionClass(c)` and `criticalityClass(c)` — return Tailwind classes for color-coded badges
- Removed now-unused `formatValue()` function

`app/(dashboard)/assets/[id]/page.tsx`:
- Added "Condition & Risk" sub-section below the main dl list in Asset Information card
- Only rendered when at least one of `condition`, `criticality`, `remarks` is set
- Shows: Physical condition, Criticality (each as labeled field), Remarks (full-width with whitespace-pre-wrap)

`app/actions/asset-import.ts`:
- `ImportPreviewRow`: added `condition`, `criticality`, `remarks` fields
- `HEADER_MAP`: added mappings for condition (condition, physicalcondition, assetcondition), criticality (criticality, criticalitylevel, priority, riskpriority), remarks (remarks, additionalremarks, comments, internalcomments)
- Normalization functions: `normalizeCondition()` and `normalizeCriticality()` — case-insensitive match against canonical value maps; unknown values silently become null (import not rejected)
- `importAssetsAction`: applies normalization before `prisma.assets.create`; passes `condition`, `criticality`, `remarks` to create data

**Allowed values (canonical):**
- Condition: Excellent, Good, Fair, Poor, Out of Service
- Criticality: Critical, High, Medium, Low

**Access control:** unchanged — `assets.manage` required for create/edit/import; `assets.view` for read-only access; already enforced.

All checks pass: lint ✓, typecheck ✓, build ✓ (41 static, 64 dynamic routes)

### P6 — Asset Profile and Repair History Enhancement — COMPLETE

Full Phase 6 implementation. No schema changes, no route deletions, no DB value changes.

**New file created:**

`lib/backend/assets/service.ts`:
- `import "server-only"` present
- `getAssetMaintenanceSummary(assetId)` — single Prisma query fetching work orders with embedded `work_order_assignments` (profile names) and `work_order_materials` (count + aggregation), returns `AssetWorkOrderRow[]` (with `technician_names: string[]` and `materials_count: number`), distinct `AssetTechnicianRow[]`, aggregated `AssetMaterialRow[]`, plus `totalRepairs`, `openOrders`, `closedOrders`, `lastRepairedDate`
- Materials aggregated by `material_name` (sum qty + amount), sorted by qty desc, capped at 30
- Distinct technician history built in one pass over raw assignments, keyed by profile id
- Replaces separate `workOrderIds` → `rawTechnicianRows` + `rawMaterialRows` queries that were in the page

**`app/(dashboard)/assets/[id]/page.tsx` — rewritten:**
- Now uses `getAssetMaintenanceSummary()` — reduces 5 queries to 3 (asset, summary, documents)
- Added `canEdit = super_admin || assets.manage`; Edit button now gated behind `{canEdit && ...}`
- Repair history table: removed Type and Team columns; added Issue/Problem (dedicated column, truncated), Technician (from `wo.technician_names`, "—" when empty), Mats (count, "—" when zero), View (ExternalLink icon + "Open" link); `min-w` widened to 1050px
- Open orders table: removed Type column; added Technician column (shows "Unassigned" in gray when empty), View column; `min-w` widened to 860px
- Technician History section: key changed from `t.full_name` to `t.id` (prevents duplicate key warning when two techs share a name)
- Materials & Parts Used section: unchanged (service provides same aggregated data)
- `ExternalLink` icon added to lucide imports; `Plus` retained

**`app/(dashboard)/maintenance/work-orders/[id]/page.tsx`:**
- Added `Cpu` to lucide-react imports
- Added "Linked Asset" section (id="linked-asset") in main content column, inserted before "Repair Order Overview"; only renders when `wo.assets !== null`
- Shows: asset_code + asset_name (bold headline), category + location (subtitle), StatusBadge for asset status (red for Breakdown, green otherwise), Brand, Model, Serial number as InfoBlock grid, "View full asset profile →" link to `/assets/${wo.asset_id}`

All checks pass: lint ✓, typecheck ✓, build ✓ (41 static, 64 dynamic routes)

### P6 — Backend Review and Hardening — COMPLETE

Systematic review of asset backend, repair order backend, access control, audit logs, and Excel import. No schema changes, no route deletions.

**Reviewed and confirmed correct (no changes):**
- `requirePermission` (action layer) + `assertBackendPermission` (service layer): dual enforcement confirmed on all workflow actions
- `getWorkOrderVisibilityFilter`: applied consistently to every work order list/detail query
- Status control: client can never inject a status string — only `save_draft` / `submit_for_approval` intent flags are accepted by `upsertWorkOrderAction`
- `import "server-only"`: present in all sensitive modules (context, service, import)
- `canTransition` + `status-rules.ts`: enforced on every service-layer transition
- `withBackendTransaction`: used for all multi-step writes
- Asset model: all 9 business-required fields present
- `asset_id` URL param → `WorkOrderForm` default → `upsertWorkOrderAction` → DB: complete and correct

**Changes made:**

`app/actions/asset-import.ts`:
- Added `import { writeAuditLog }` and a summary `asset.import` audit log written after every import run (imported count, skipped count, failure count)
- Fixed N+1 department query: replaced per-row `prisma.departments.findFirst()` with a single pre-loaded `Map<name, id>` built once before the loop
- Added server-side row count cap (500 rows max) — prevents clients bypassing the preview limit

`lib/backend/work-orders/service.ts`:
- Added `wasAlreadyInStatus: boolean` to `transitionWorkOrderInTransaction` return type and value
- Threaded `wasAlreadyInStatus` through `transitionWorkOrder`
- Guarded `approvals.create` in `approveWorkOrder`, `rejectWorkOrder`, `verifyWorkOrder`, and `closeWorkOrder` with `!result.wasAlreadyInStatus` to prevent duplicate approval records when a transition is a no-op (the `canTransition` idempotency bypass for re-assign allows `fromStatus === toStatus`)

`app/actions/maintenance.ts`:
- Fixed notification metadata for new submitted repair orders: now fetches actual asset name from DB when `asset_id` is provided, instead of literal `"selected asset"` placeholder

**Schema gaps identified (no migration recommended now — explain first per CLAUDE.md):**
- `assets.condition` — not in schema. Safe nullable addition if needed.
- `assets.criticality` — not in schema. Safe nullable addition if needed.

All checks pass: lint ✓, typecheck ✓, build ✓ (41 static, 64 dynamic routes)

### P5 — Visible Wording Cleanup and Asset Repair History — COMPLETE

Completed wording conversion from "Work Order" to "Repair Order" across all visible maintenance UI. No database schema changes, no route deletions, no DB value changes.

Changes made:

**Reports page (`app/(dashboard)/reports/work-orders/page.tsx`):**
- Page title: "Work Order Reports" → "Repair Order Reports"
- `MODE_META` labels/descriptions updated: "Pending Approvals" → "Pending Review", "Overdue Work Orders" → "Overdue Repair Orders", "Waiting Parts / Purchase" → "Waiting for Parts / Parts Order", all descriptions updated to "repair orders"
- CEO executive-summary card: "Work Orders This Period" → "Repair Orders This Period", "Pending Approval" → "Pending Review"
- CEO blocked-operations card: "Waiting for Purchase" → "Parts Order Pending"
- CEO department-performance card: "Pending Approvals" → "Pending Review"
- `computeModeSummary` for monthly-summary: "Pending approval" → "Pending review"
- `computeModeSummary` for asset-history: "Total work orders" → "Total repair orders"
- `computeModeSummary` for waiting-parts: "Waiting for purchase" → "Parts order pending"
- Admin cards: "Total work orders" → "Total repair orders", "Pending approvals" → "Pending review", "Waiting purchase" → "Parts order pending"
- Scope banner in manager view: "Work orders from other departments" → "Repair orders from other departments"
- Admin section table heading: "Work Order List" → "Repair Order List"
- Manager scope description updated

**Asset detail page (`app/(dashboard)/assets/[id]/page.tsx`) — new sections:**
- Added `work_order_assignments` query to fetch technician history for this asset's work orders
- Added `work_order_materials` query to fetch materials used across this asset's work orders
- Added "Technician History" section: table showing distinct technicians, job title, and last assigned date
- Added "Materials & Parts Used" section: table aggregating total qty and cost per material/part (cost gated by `canViewCosts`)
- Both sections only render when data exists

**Workflow actions (`components/work-orders/workflow-actions.tsx`):** Already updated in P4 sub-tasks.
**Technician jobs page (`app/(dashboard)/technician/jobs/page.tsx`):** Already updated in P4 sub-tasks.
**Dashboard (`app/(dashboard)/dashboard/page.tsx`):** Already updated in P4 sub-tasks.
**Repair order detail (`app/(dashboard)/maintenance/work-orders/[id]/page.tsx`):** Already updated in P4 sub-tasks.

All checks pass: lint ✓, typecheck ✓, build ✓ (41 static, 64 dynamic routes)

### P4 — Asset-First Repair Order System — COMPLETE

Converted the system into an asset-first repair order workflow. No database schema changes, no route or table deletions.

Changes made:

**Terminology / labels (display only — DB values unchanged):**
- `lib/display/work-order-labels.ts` (NEW): `displayStatus()` maps "Pending Approval" → "Pending Review", "Waiting for Purchase" → "Waiting for Parts"; `displayNextAction()` maps all status strings to user-facing action labels
- All nav groups in `components/layout/app-layout.tsx`: "Work Orders" → "Repair Orders"
- `app/(dashboard)/maintenance/work-orders/page.tsx`: Page title "Work Orders" → "Repair Orders"; KPI card titles updated ("Total Work Orders" → "Total Repair Orders", "Pending Approval" → "Pending Review", "Waiting for Purchase" → "Parts Order Pending"); `getNextAction()` labels updated; TAB_LIST labels updated
- `components/work-orders/work-order-form.tsx`: Form title "Work Order" → "Repair Order"; submit button "Submit for Approval" → "Submit for Review"; action description updated; asset select pre-selection from `workOrder.asset_id` now applied in new-form branch
- `app/(dashboard)/maintenance/work-orders/new/page.tsx`: Page title "New Repair Order"; reads `?asset_id=` from searchParams and passes `{ id: null, asset_id }` as `workOrder` prop

**Asset detail page (`app/(dashboard)/assets/[id]/page.tsx`) — full rewrite:**
- "Create Repair Order" button in page header (gated by `work_orders.manage`)
- Repair summary stats strip (total repairs, open orders, last repaired)
- "Open Repair Orders" section (amber styling, shown only when open orders exist)
- "Maintenance History" renamed → "Repair History" with "New Repair Order" button
- Repair history table: added operator_complaint preview, ending_datetime, displayStatus() on badges; limit increased 20→50

**Asset list page (`app/(dashboard)/assets/page.tsx`):**
- `location` filter param added to search form, Prisma `where` query, `filterHref`, and `Pagination` component
- Search text also matches `location` field
- "Import Excel" button added to page header linking to `/assets/import`
- `Upload` icon added to imports

**Excel import feature (NEW):**
- `app/actions/asset-import.ts`: `parseAssetExcelAction()` — parses .xlsx using ExcelJS, maps flexible column headers, validates required fields, detects duplicates (both in file and in DB), returns up to 500 preview rows; `importAssetsAction()` — re-validates server-side, resolves department by name, creates assets, returns import result
- `components/assets/asset-import-form.tsx`: Client component — 3-step flow (upload → preview table with valid/invalid rows → results); shows errors, skipped rows, and success count
- `app/(dashboard)/assets/import/page.tsx`: Server page gated by `assets.manage`

All checks pass: lint ✓, typecheck ✓, build ✓ (41 static, 64 dynamic routes, +1 /assets/import)

### R2.2 — Execute Demo User Seed

Run `DEMO_USER_PASSWORD=<password> npm run seed:demo-users` and verify all 7 users are created. Confirm profiles, roles, departments, active status, cost visibility, and must_reset_password in the database. Do not run until a suitable demo password is ready.

### R2 — Recreate Essential Users (tracking)

Seed script implemented (R2.1 complete). Execution and verification pending (R2.2).

### R3 — Controlled Work Order

Select or create one controlled demo work order and record its ID, number, initial status, requester, required parts, technician, and expected transitions.

### R4 — Lifecycle Dry Run

Verify submit, approve, assign, start, complete, verify, and close. Inspect status, history, assignment, workflow records, audit, and notifications after each step.

### R5 — Store and Purchase Dry Run

After the lifecycle is stable, enable inventory checking only in a controlled environment and verify required parts, availability, assignment gate, shortage, purchase, approvals, receipt, movement, and continuation.

## Stabilization Backlog

1. Automated tests
2. Version-controlled PostgreSQL bootstrap
3. ~~Idempotent development seed command~~ — done (R2.1)
4. Backup revalidation
5. Restore test documentation
6. Real signed URL implementation or renaming
7. MinIO/S3 plan
8. Workflow-engine source-of-truth decision
9. Resolve workflow-only manager roles
10. Requester confirmation action
11. Cancel action
12. General reopen action
13. Formal purchase-order scope
14. Construction workflow scope

## Future Architecture Backlog

- Monorepo
- NestJS backend
- Redis/Valkey
- MinIO/S3
- Realtime gateway
- Background worker
- Multi-instance deployment
- API versioning

## Open Questions

1. Are Production, Factory, and Purchase Manager approvals required?
2. When should inventory checking be enabled?
3. Who performs requester confirmation?
4. Is requester confirmation mandatory before closure?
5. What is the cancellation policy?
6. Which statuses can be reopened?
7. Should shortages automatically create parts requests?
8. Should shortages automatically create purchase requests?
9. Is formal purchase-order management required?
10. Is Construction Project Request in scope?
11. Should the workflow engine replace status strings?
12. What is the target deployment environment?
13. When should local storage move to MinIO/S3?
14. What backup retention and recovery objectives are required?

## Architecture Decisions

- Custom local auth remains active.
- Local filesystem remains active for development and single-instance deployment.
- Status strings remain the operational source of truth.
- Workflow engine remains a tracking/future layer.
- SSE remains the active notification realtime method.
- Recovery and verification take priority over broad new features.
- Dead Supabase runtime files (`lib/supabase/*`, `lib/db/local-query-client.ts`) removed after confirming zero live call sites; Prisma/PostgreSQL is the sole active data-access path.

## Session Notes

- The previous operational database was not recovered.
- Current DB contains migration-seeded demo assets, parts, work orders, and audit data.
- Two usable accounts exist.
- Super Admin was recreated manually.
- Inventory checking is off.
- The project runs locally.
- Next coding begins after missing role users and a controlled lifecycle test are prepared.
- 2026-07-09: Cleanup pass removed dead Supabase runtime files and the `local-query-client.ts` adapter (no remaining imports), archived `supabase/migrations/` (29 files) to `docs/archive/supabase-migrations/` for historical reference, removed `supabase/seed/README.md`, and updated README.md, docs/LOCAL_DEVELOPMENT.md, docs/architecture.md, docs/SAFETY_RULES.md, context/architecture.md, lib/architecture/config.ts, and related architecture-page components so documented setup/architecture wording matches the active Prisma/PostgreSQL/local-auth stack.
- 2026-07-09: Cleanup phase 2 removed stale demo/debug scripts (`remove-demo-assets.mjs`, `inspect-demo-wo.cjs`, `reset-demo-inventory-wo.cjs`; no references elsewhere), and archived 9 stale multi-role/demo docs to `docs/archive/old-demo-role-docs/` and 3 dev logs (`experiment-log.md`, `feature-brief.md`, `testing-checklist.md`) to `docs/archive/dev-logs/`. Operational scripts, backup/password scripts, Prisma migrations, and the core docs set (LOCAL_DEVELOPMENT, BACKUP_AND_RESTORE, SAFETY_RULES, USER_LIFECYCLE, WORK_ORDER_VISIBILITY, WORK_ORDER_OPERATIONS, architecture, technical-architecture, security, notifications, REALTIME_EVENTS, FORM_HEADER_STANDARD, workflows/inventory-shortage-path) were left untouched.
- 2026-07-09: Production backend stabilization audit ahead of today's deploy. Fixed a real access-control gap: asset category management (`app/actions/asset-categories.ts`, its page, and the sidebar nav entry) was gated by `admin.settings.manage` (Super Admin/IT Admin only) instead of `assets.manage`, silently blocking Maintenance Manager/Supervisor/Data Entry — the roles that actually hold `assets.manage` — from managing categories; now aligned. Added the previously-uncommitted `prisma/migrations/migration_lock.toml` (provider = postgresql). Flipped `.env.example`'s `AUTH_COOKIE_SECURE` default from `true` to `false` to match today's internal-HTTP deployment. **Open risk**: the real `.env` has no `AUTH_COOKIE_SECURE` set at all — `lib/auth/session.ts` falls back to `NODE_ENV === "production"`, so a production build will default secure cookies to `true` and silently break login over internal HTTP unless this is added before go-live. Full backend review (assets, asset categories, work orders/repair orders, spare parts, parts requests, users, notifications, reports, audit logs) found the rest of the permission/transaction/audit model sound — see conversation for detailed per-module findings. `npm run lint`, `npm run typecheck`, `npm run build` all pass.
- 2026-07-09: Fixed "Save failed" on new asset creation. Root cause: a legacy `assets_category_check` CHECK constraint (hardcoded 11-value enum: Vehicle, Bus, Car, Truck, Crane, Forklift, Generator, Factory Machine, Electrical Equipment, Building/Facility, Other) existed on the live database as untracked drift — never represented in any Prisma migration — and rejected every asset save/import using any of the Phase 11E `asset_categories` master-table categories (Production Equipment, Batching Plant, Heavy Equipment, Workshop Equipment, IT / Office Equipment, etc.), since `assets.category` is intentionally free-text and validated at the app layer, not the DB layer. Added migration `20260709120000_drop_stale_assets_category_check` (`ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_category_check`), applied via `prisma migrate deploy`, and verified with a direct create using a new-style category. Also fixed `upsertAssetAction`/`upsertPartAction` in `app/actions/maintenance.ts`, which previously swallowed the real Prisma error in a bare `catch {}` before redirecting to a generic "Save failed" toast — both now log full error detail (code/message/meta) like `upsertWorkOrderAction` already did, so future failures are diagnosable instead of a black box.
- 2026-07-09: Found and fixed the *actual* remaining cause of "Save failed" after the category-constraint fix (dropping that constraint alone wasn't enough — a second, deeper bug was masked behind it). Root cause: `optionalDate` in `app/actions/maintenance.ts` passed raw `"YYYY-MM-DD"` strings from date inputs straight through to Prisma without converting to a `Date` object; Prisma 6 requires a full ISO-8601 datetime or a native `Date`, not a bare date-only string, and threw `Invalid value for argument 'purchase_date': premature end of input. Expected ISO-8601 DateTime.` — silently swallowed by the same bare `catch {}`. Fixed `optionalDate` (and added `requiredDate`) to parse into real `Date` objects. This same helper was also used for `workOrderSchema`'s `date_of_order` (required, on every work order) and `starting_datetime`/`ending_datetime` — meaning **work order creation had the identical latent bug** and was very likely broken in production too; fixed there as well. While verifying the work-order path, also found `components/work-orders/work-order-wizard.tsx`'s `WORKER_TYPES` used `"Welding / Fabrication"` (with spaces) while the DB's `work_orders_worker_type_check` constraint and the sibling `work-order-form.tsx` component both use `"Welding/Fabrication"` (no spaces) — selecting that option in the new-work-order wizard would have failed the CHECK constraint; aligned the wizard to the no-space form. Diagnosis method: added a `logSystemError()` call to `upsertAssetAction`'s catch block (queryable via `system_error_logs` table) since the running dev server's terminal output wasn't accessible directly — this surfaced the real Prisma error with the exact failing field/value, which a hand-rolled reproduction using only `null` date fields had been masking. Audited all CHECK constraints across every public table (`pg_constraint` query) to confirm no other stale/mismatched enum constraints remain outside this one wizard label typo. `npm run lint`, `npm run typecheck`, `npm run build` all pass; verified end-to-end with direct Prisma calls mirroring the exact real form payloads for both assets and work orders.
