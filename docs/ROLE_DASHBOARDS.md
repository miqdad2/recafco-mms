# Role Dashboards

Each role in RECAFCO sees a tailored dashboard scoped to their responsibilities. This document describes the data sources, sections, and UI logic for each role-specific dashboard variant.

---

## Maintenance Manager Dashboard

### Data Scope

All counts and rows are department-scoped using `getWorkOrderVisibilityFilter` logic:

- If manager has a `department.id`: filter by `requested_by_department_id = deptId`
- Fallback (no dept): filter by `created_by = userId`

This ensures the Maintenance Manager never sees global company totals — only work orders routed through or created in their department.

### Variables

| Variable | Source | Description |
|---|---|---|
| `mgrPendingApprovals` | Prisma count | WOs in Submitted / Pending Approval |
| `mgrPendingPartsApprovals` | Prisma count | Parts requests in Pending Approval linked to dept WOs |
| `mgrAwaitingClosure` | Prisma count | WOs in Completed / Verified / Confirmed |
| `mgrWaitingParts` | Prisma count | WOs in Waiting for Parts / Purchase / Parts Issued |
| `mgrInProgress` | Prisma count | WOs In Progress |
| `mgrApproved` | Prisma count | WOs Approved |
| `mgrAssigned` | Prisma count | WOs Assigned |
| `mgrOverdue` | Prisma count | Open WOs past `starting_datetime` |
| `mgrHighPriority` | Prisma count | High / Urgent WOs not yet closed |
| `mgrTotal` | Prisma count | All dept WOs (any status, not deleted) |
| `mgrPendingParts` | Prisma count | Parts requests in active workflow states linked to dept WOs |
| `mgrApprovalQueue` | Prisma findMany | Up to 8 oldest Submitted/Pending Approval WOs with asset join |

### Desktop Sections (lg+)

1. **Manager Workspace Header** — dark (`#111827`) branded banner
   - Eyebrow: "Manager workspace"
   - Title: "Maintenance Manager Workspace"
   - Primary button: **Review Approvals** — red fill, `font-black`, badge count when `mgrPendingApprovals > 0`
   - Secondary button: **Work Orders** — ghost outline (`border-gray-400 text-white`), no fill, `font-semibold`
   - Tertiary button: **Reports** — text-only link (`text-gray-400 text-xs`), separated by thin `|` divider, `title` tooltip describing report types; shown if `reports.view` permission

2. **Needs Manager Decision** — 6 stat cards (xl grid)
   - WO Approvals (`mgrPendingApprovals`, amber)
   - Parts Approvals (`mgrPendingPartsApprovals`, amber)
   - Awaiting Closure (`mgrAwaitingClosure`, green)
   - Waiting Parts / Purchase (`mgrWaitingParts`, red)
   - Urgent / High Priority (`mgrHighPriority`, amber)
   - Overdue (`mgrOverdue`, red)

3. **Pending Approval Queue** — shown if `mgrApprovalQueue.length > 0`
   - Columns: WO / No., Requester, Asset / Vehicle, Type, Priority, Submitted (age), Action
   - Age is calculated relative to server render time using `daysOld(date)` helper
   - Action: **Review** button links to `/maintenance/work-orders/[id]`
   - Header link: **Review all** → `/maintenance/approvals`

4. **Blocked Work** — shown if `mgrWaitingParts > 0 || mgrOverdue > 0 || mgrHighPriority > 0`
   - Waiting for Parts / Purchase card (red) — links to work orders
   - Overdue Work Orders card (amber) — links to work orders
   - Urgent / High Priority card (amber) — links to work orders

5. **Department Workload Overview** — shared section (also visible to other non-CEO roles)
   - Title changed to "Department Workload Overview" for manager
   - Stats: `managerOperationStats` (all dept-scoped)
   - Work Order Flow bars use `workOrderFlowSummary` and `workOrderFlowTotal` (dept-scoped)

6. **Supervisor, Technician, and Parts Queue** — 4 stat cards
   - Supervisor Verification (`mgrAwaitingClosure`)
   - Technician Assignments (`mgrAssigned`)
   - Parts Request Queue (`mgrPendingParts`)
   - Low Stock (global inventory — not dept-scoped, applies company-wide)

### Mobile Sections

- Quick actions: Pending Approvals, Work Orders, Parts Requests, Reports
- Status summary (`mgrMobileStatus`): Need Approval, In Progress, Waiting Parts, Awaiting Closure, Overdue, High Priority
- Stat cards: `[...managerDecisionStats, ...managerWorkflowStats]`

### IT Admin Restriction

The Maintenance Manager workspace header, "Needs Manager Decision" section, Pending Approval Queue, and Blocked Work section are gated by `isMaintenanceManager` (role slug `maintenance_manager`). IT Admin does not see manager approval UI — they see the Super Admin / IT Admin layout with system stats.

---

## Maintenance Data Entry Dashboard

See [DATA_ENTRY_DASHBOARD.md](DATA_ENTRY_DASHBOARD.md) for full documentation.

### Key Scope

All counts are `created_by = userId` — only the data entry user's own work orders.

---

## CEO / Management Dashboard

Renders `CeoExecutiveCockpit` component — a separate presentation block with global counts. No department scoping. See component at `components/ceo/ceo-executive-cockpit.tsx`.

---

## Finance Manager Dashboard

Uses global counts for all purchase request, cost, and work order data. Finance visibility is permission-gated by `costs.view` and `finance.approve`.

---

## Super Admin / IT Admin Dashboard

Full-system counts with no scoping. Shows system health, security stats, user/dept/role counts, audit logs.

---

## How to Test as Maintenance Manager

1. Log in as a user with role `maintenance_manager` and a department assigned.
2. Navigate to `/dashboard`.
3. Verify:
   - Dark workspace header shows "Maintenance Manager Workspace"
   - "Review Approvals" button has a badge count matching pending WOs in the manager's department only
   - "Needs Manager Decision" cards show counts from the department, not global totals
   - "Pending Approval Queue" table shows up to 8 oldest WOs pending approval in dept
   - "Blocked Work" section appears only when waiting-parts, overdue, or high-priority WOs exist in dept
   - "Department Workload Overview" title (not "Maintenance Workflow Overview")
   - Work Order Flow bars use department totals
4. Create a work order from a different department as another user — confirm it does NOT appear in the manager's counts.
5. Log in as IT Admin and confirm the manager approval UI is NOT shown.
