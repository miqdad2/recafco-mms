# Maintenance Manager Reports

The Work Order Reports page (`/reports/work-orders`) adapts its layout, data scope, and available filters based on the logged-in user's role.

For the **Maintenance Manager** role (`maintenance_manager`), the page transforms into a **Report Center** — a focused, department-scoped reporting tool with six pre-built report modes designed for daily, weekly, and monthly manager workflows.

---

## Why Maintenance Manager cannot see global company reports

Global reports are designed for Super Admin, IT Admin, and CEO/Management roles who have company-wide visibility authority.

The Maintenance Manager's responsibility is their department's maintenance operations. Showing global company data would:
- Expose other departments' operational details and potential cost data
- Create noise that makes it harder to focus on actionable items
- Violate the principle of minimum necessary access

All counts, charts, tables, and Excel exports for the Maintenance Manager are scoped using:
- `requested_by_department_id = manager's department ID` for work orders
- `getMgrFilterOptions(deptId)` for filter dropdown options (assets are dept-scoped; technicians remain company-wide since assignment crosses departments)

---

## How Super Admin / IT Admin / CEO differ

| Role | Reports scope | Layout |
|------|--------------|--------|
| Super Admin | All departments, all data | Generic layout with dept filter dropdown |
| IT Admin | All departments, all data | Generic layout with dept filter dropdown |
| CEO / Management | All departments, all data | Generic layout with dept filter dropdown |
| Maintenance Manager | Own department only | Report Center with 6 mode cards |
| Others (read-only) | `reports.view` permission required | Generic layout |

Super Admin and others see the original layout with:
- All departments in the department dropdown
- Global totals in summary cards
- Generic work order list (all departments)

---

## Department scoping rule (implementation)

In `app/(dashboard)/reports/work-orders/page.tsx`:
```typescript
const mgrDeptId = isManager ? (context.department?.id ?? null) : null;
const filters: ReportFilters = { ...baseFilters };
if (mgrDeptId) filters.departmentId = mgrDeptId; // locked, not user-overridable in page
```

In `app/api/exports/[kind]/route.ts`:
```typescript
// Server-side enforcement — cannot be bypassed via URL param manipulation
if (context.role?.slug === "maintenance_manager" && context.department?.id) {
  filters.departmentId = context.department.id;
}
```

In `components/reports/report-filter-panel.tsx`:
- If `lockedDepartmentId` is provided: renders a read-only "Locked" badge instead of a dropdown
- Adds `<input type="hidden" name="departmentId" value={lockedDepartmentId} />` so form submission always includes the locked value

---

## Report Modes

Navigate between modes using the horizontal report mode card row at the top of the Manager Report Center. Each card links to `?report=<mode>` — other active filters are cleared on mode switch.

### 1. Pending Approvals (`?report=pending-approvals`)

**Purpose:** The manager's primary daily action. Shows all work orders in `Submitted` or `Pending Approval` status for the department.

**When to use:** Every day — the manager's first responsibility is to clear the approval queue.

**Default for Maintenance Manager:** Yes. Navigating to `/reports/work-orders` without a `?report=` param loads Pending Approvals.

**Summary cards:**
- Pending count
- High / Urgent priority count
- Oldest waiting (days since created)

**Group breakdowns:**
- By Priority
- By Maintenance Type

**Table columns:** WO No. | Requester | Asset / Vehicle | Type | Priority | Submitted (age) | **Review** (red button)

**Active filters shown:** From, To, Priority, Asset

**Status filter:** Locked to `["Submitted", "Pending Approval"]` — not user-overridable

**Excel export:** Exports all pending-approval WOs scoped to manager's department

---

### 2. Overdue (`?report=overdue`)

**Purpose:** Work orders where `starting_datetime` is in the past and the status is still active (not Closed/Cancelled/Rejected). Identifies jobs running late.

**When to use:** Weekly review. Use this to follow up with supervisors and technicians about delayed jobs.

**Summary cards:**
- Overdue count
- High / Urgent priority overdue
- Avg. overdue (days)
- Oldest overdue (days)

**Group breakdowns:**
- By Asset (which assets are most often causing overdue WOs)
- By Technician

**Table columns:** WO No. | Asset / Vehicle | Status | Technician | Priority | Overdue (days, red) | View

**Active filters shown:** From, To, Priority, Asset, Technician

**Status filter:** Locked to active status in `["Approved", "Assigned", "In Progress", "Waiting for Parts", "Waiting for Purchase"]` with `starting_datetime < now`

---

### 3. Waiting Parts / Purchase (`?report=waiting-parts`)

**Purpose:** Department jobs currently blocked by the store or purchase process.

**When to use:** Daily or when investigating why jobs are stuck. Helps the manager chase parts requests or escalate purchase approvals.

**Summary cards:**
- Waiting for parts (store)
- Waiting for purchase (procurement)
- Parts issued — pending closure
- Oldest blocked (days)

**Group breakdowns:**
- By Asset
- By Status (distinguishes parts vs. purchase blocked)

**Table columns:** WO No. | Asset / Vehicle | Status | Type | Created (age) | View

**Active filters shown:** Asset, Maintenance Type

**Status filter:** Locked to `["Waiting for Parts", "Waiting for Purchase", "Parts Issued"]`

---

### 4. Asset Breakdown History (`?report=asset-history`)

**Purpose:** All work orders for department assets — sorted by asset. Useful for identifying assets with high maintenance frequency or recurring breakdowns.

**When to use:** Monthly or before procurement review. Use this to justify asset replacement or preventive maintenance schedule changes.

**Summary cards:**
- Total work orders
- Assets affected
- Breakdown type count
- Other maintenance types

**Group breakdowns:**
- By Asset (top repeated — ranked by work order count)
- By Type (Breakdown vs. Routine vs. Preventive etc.)

**Table columns:** WO No. | Asset / Vehicle | Type | Date | Status | View

**Active filters shown:** Asset, Maintenance Type, From, To

**Status filter:** Not locked — shows all statuses by default (full history)

---

### 5. Monthly Work Order Summary (`?report=monthly-summary`)

**Purpose:** A department summary of all work orders in a selected month. Used for monthly reporting to management.

**When to use:** End of month reporting. Export to Excel and share with department head or management.

**Default date range:** Automatically defaults to the first day of the current month to today when no date range is set.

**Summary cards:**
- Total created
- Completed / Closed
- Pending approval
- Rejected

**Group breakdowns:**
- By Status
- By Type
- By Month (useful if the filter spans multiple months)

**Table columns:** WO No. | Date | Asset / Vehicle | Type | Status | Priority | [Cost if permitted] | View

**Active filters shown:** From, To, Status, Priority, Maintenance Type, Worker Type

**Excel export:** All monthly WOs with cost columns if the manager has `costs.view` permission

---

### 6. Technician / Team Workload (`?report=technician-workload`)

**Purpose:** Shows the current workload of assigned technicians and worker teams in the department.

**When to use:** Weekly planning. Helps supervisors and managers redistribute work, identify under/over-utilized technicians.

**Default status filter:** Shows active WOs in `["Approved", "Assigned", "In Progress", "Waiting for Parts", "Waiting for Purchase", "Completed by Technician", "Verified by Supervisor"]`

**Summary cards:**
- Assigned (not yet started)
- In Progress
- Completed / Closed
- Overdue

**Group breakdowns:**
- By Technician (ranked by WO count — top loaded technicians first)
- By Status

**Table columns:** WO No. | Technician | Asset / Vehicle | Status | Priority | View

**Active filters shown:** Technician, From, To

---

## Excel Export behavior

The **Export Current Report** button exports the currently selected report mode with the current filters, always dept-scoped.

The export URL is built in the page:
```typescript
const exportParams = new URLSearchParams(...rawParams);
if (mgrDeptId) exportParams.set("departmentId", mgrDeptId);
if (isManager) exportParams.set("report", reportMode);
```

The export route (`/api/exports/work-orders`) additionally enforces dept scoping server-side — a manager cannot bypass it by editing the URL.

Cost columns (`total_labor_cost`, `total_material_cost`, `total_work_order_cost`) are included in the export only if the manager has `costs.view` permission or `can_view_costs = true` on their profile.

---

## Filter behavior per mode

| Filter field | Modes where visible |
|---|---|
| From / To (date range) | pending-approvals, overdue, asset-history, monthly-summary, technician-workload |
| Priority | pending-approvals, overdue |
| Asset | pending-approvals, overdue, waiting-parts, asset-history |
| Technician | overdue, technician-workload |
| Maintenance Type | waiting-parts, asset-history, monthly-summary |
| Worker Type | monthly-summary |
| Status (free text) | monthly-summary only |
| Department | Always locked — shown as read-only badge, not dropdown |
| Cost Min / Max | Never shown for Maintenance Manager (cost visibility is permission-gated) |

---

## How to test as Maintenance Manager

1. Log in as a user with role `maintenance_manager` and a department assigned.
2. Navigate to `/reports/work-orders`.
3. Verify:
   - Blue scope banner: `Scope: Maintenance Department — All report data is scoped to your department only.`
   - 6 mode cards are shown: Pending Approvals (selected by default), Overdue, Waiting Parts, Asset History, Monthly Summary, Technician Workload
   - Summary cards show department-scoped counts only
   - Group breakdowns show department data only
   - Work order table shows department WOs with mode-specific columns
   - Filter panel shows only mode-relevant fields; department field is locked
   - Export button says "Export Current Report"
4. Click each mode card and verify the layout, filters, and table columns change.
5. Apply a filter (e.g., priority = "Urgent") and submit — verify results narrow within the department.
6. Click "Export Current Report" — verify the downloaded Excel has only department WOs.
7. Try manually appending `&departmentId=<another-dept-id>` to the export URL — verify the server ignores it and uses the manager's own dept.

---

## How to test Super Admin global report behavior

1. Log in as Super Admin.
2. Navigate to `/reports/work-orders`.
3. Verify:
   - No scope banner is shown
   - No mode cards are shown
   - Department dropdown is available with all departments
   - Summary cards show global company totals
   - Group breakdown "By Department" shows all departments
   - Export button says "Export Excel"
   - No department scoping is applied
4. Select a specific department from the dropdown and apply — verify the report filters to that department only.
