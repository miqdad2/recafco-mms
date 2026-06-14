# Data Entry Dashboard and Sidebar

The Maintenance Data Entry role (`maintenance_data_entry`) has a simplified dashboard and sidebar designed for daily non-technical use. All access control and permission rules remain enforced on the backend — only the navigation and dashboard UI is simplified.

---

## Sidebar

Data entry users see a focused sidebar instead of the full navigation tree:

| Item | Route | Icon |
|------|-------|------|
| Dashboard | `/dashboard` | LayoutDashboard |
| Create Request | `/maintenance/work-orders/new` | PlusCircle |
| My Requests | `/maintenance/work-orders` | ClipboardList |
| Drafts | `/maintenance/work-orders?status=Draft` | FileText |
| Rejected / Fix | `/maintenance/work-orders?status=Rejected` | RotateCcw |
| Assets | `/assets` | Gauge |
| Notifications | `/notifications` | Bell |

Hidden from data entry sidebar (routes still exist and are accessible by permission, just not surfaced in navigation):

- Reports, Approvals, CEO Approvals, Assignments, My Jobs
- Parts Requests (standalone), Inventory Moves, Purchase, Finance
- Users, Roles, Departments, Settings, Audit Logs
- System Health, Architecture, System Map, Map Editor, Demo Guide

**Implementation:** `dataEntryNavigationGroups` in [app-layout.tsx](../components/layout/app-layout.tsx) is used when `context.role.slug === "maintenance_data_entry"`. All other roles continue to use `navigationGroups`.

---

## Dashboard (Desktop)

### Create Request Banner

A dark CTA banner at the top of the desktop section with three action buttons:

- **Create Request** (red, primary) → `/maintenance/work-orders/new`
- **My Requests** (ghost white) → `/maintenance/work-orders`
- **Rejected / Fix** (ghost white) → `/maintenance/work-orders?status=Rejected`

### My Request Status

Six stat cards showing user-scoped counts (the user's own work orders only):

| Card | Field | Tone |
|------|-------|------|
| My Work Orders | `myTotalWorkOrders` | blue |
| Drafts | `myDraftWorkOrders` | gray |
| Submitted | `mySubmittedWorkOrders` | blue |
| Pending Approval | `myPendingApprovalWorkOrders` | amber |
| Rejected | `myRejectedWorkOrders` | red |
| Closed | `myClosedWorkOrders` | green |

These are fetched from `work_orders WHERE created_by = current_user_id` — never company-wide counts.

### My Recent Requests Table

Fetches up to 8 of the user's most recently updated work orders. Columns:

- Reference No. (work_order_number)
- Form Type (static: "Work Order")
- Asset / Vehicle (joined from assets table)
- Status (StatusBadge with tone)
- Last Updated (formatted datetime)
- Action button:
  - **Fix** (red) for Rejected
  - **Continue** (outline) for Draft → links to edit page
  - **View** (outline) for all others → links to detail page

### Sections Hidden from Data Entry

The "Maintenance Workflow Overview" section (company-wide status bars and stat cards) is hidden for data entry users. Data entry users see only their own scoped stats.

---

## Dashboard (Mobile)

### Quick Action Buttons

| Button | Route |
|--------|-------|
| Create Request | `/maintenance/work-orders/new` |
| My Requests | `/maintenance/work-orders` |
| Rejected / Fix | `/maintenance/work-orders?status=Rejected` |

### Status Summary

Mobile status pills show user-scoped counts:

| Label | Value |
|-------|-------|
| Drafts | `myDraftWorkOrders` |
| Submitted | `mySubmittedWorkOrders` |
| Waiting Approval | `myPendingApprovalWorkOrders` |
| Rejected | `myRejectedWorkOrders` |
| Closed | `myClosedWorkOrders` |

Section header: **My Requests / My Request Status**

### Stat Cards

Mobile stat cards remain the same user-scoped `dataEntryStats` array (already user-scoped from a previous session).

---

## Language Rules

Data entry users see plain, operational language:

| Old label | New label |
|-----------|-----------|
| New Work Order | Create Request |
| Work Orders | My Requests |
| Entry Tracking | My Request Status |
| Work order entry | My requests (eyebrow) |
| Maintenance Workflow Overview | (hidden for data entry) |
| Export Work Orders | (removed) |

---

## Page Title

For data entry users, the dashboard `<PageHeader>` title becomes **"Maintenance Data Entry Workspace"** with description **"Create, submit, and track your maintenance forms."**

All other roles continue to see **"Dashboard"**.

---

## Access Control

This simplification is UI-only:

- Backend permission checks are unchanged — no routes are removed or unprotected.
- `canSee()` still filters the simplified nav items by permission.
- Row-level access, work order visibility filters, and Supabase RLS remain active.
- Data entry users cannot reach admin, finance, or reports pages regardless of navigation visibility.
