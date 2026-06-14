# CEO Executive Dashboard

The `/dashboard` page for users with role `ceo_management` renders the **CEO Executive Dashboard** — a purpose-built executive view that surfaces only what the CEO needs to act on: critical approvals, blocked operations, cost exposure, and high-risk maintenance.

---

## Dashboard Purpose

The CEO has authority but limited time. The dashboard is designed so the CEO can open it and within 10 seconds know:

1. Is there anything that **requires my decision right now?**
2. What is **blocking operations** and which department is responsible?
3. What does **maintenance cost this month**, and what is **pending high-value approval**?
4. Which work is **high-risk or overdue** and needs escalation?

---

## Page Title

`CEO Executive Dashboard`

**Subtitle:** Review critical approvals, blocked operations, cost exposure, and high-risk maintenance items.

---

## Header Action Buttons

The header uses a clear 3-tier button hierarchy:

| Button | Style | Target |
|--------|-------|--------|
| CEO Approvals | Primary red, badge count | `/ceo/approvals` |
| Cost Reports | Secondary ghost/outline | `/reports/costs` |
| Work Orders | Tertiary text link | `/maintenance/work-orders` |
| Purchase | Tertiary text link | `/purchase/requests` |

**Visible only to CEO/Management role.** The header is inside `hidden lg:block` — on mobile the standard mobile stat cards and quick actions are shown instead.

---

## Overall Status Badge

The header shows a live status badge next to the title:

| Condition | Badge text | Badge color |
|-----------|-----------|-------------|
| `ceoApprovalQueue > 0` | Action Required | Red |
| Blocked ops OR high risk > 0 | Monitor Closely | Amber |
| Everything clear | Operations Stable | Green |

---

## Executive Summary Cards (4 cards)

### A. Needs CEO Decision
- **Source:** `ceoApprovalQueue` — count of `purchase_requests` in `"Pending CEO Approval"` status
- **Tone:** Red if count > 0, Green if 0
- **Empty state:** "No CEO approvals waiting. Operations are clear for final decision."
- **Link:** `/ceo/approvals`

### B. Blocked Operations
- **Source:** `waitingPartsWorkOrders + waitingPurchaseWorkOrders`
  - `waitingPartsWorkOrders` = WOs in `"Waiting for Parts"`, `"Waiting for Purchase"`, `"Parts Issued"`
  - `waitingPurchaseWorkOrders` = WOs in `"Waiting for Purchase"`
- Shows `Oldest: Xd waiting` if `oldestBlockedDays > 0`
- **Tone:** Orange if blocked, Green if clear
- **Link:** `/maintenance/work-orders?status=Waiting+for+Parts`

### C. High Risk Work
- **Source:** `highPriorityWorkOrders` — WOs with priority `"High"` or `"Urgent"` not in Closed/Cancelled/Rejected
- Also shows `overdueHighRisk` — overdue HIGH/URGENT jobs (past `starting_datetime`)
- **Tone:** Amber if count > 0, Green if 0
- **Empty state:** "No high-risk maintenance items currently open."
- **Link:** `/maintenance/work-orders`

### D. Maintenance Spend This Month
- **Source:** `maintenanceCostThisMonth` — sum of `total_work_order_cost` for non-cancelled/rejected WOs updated this month
- Also shows `pendingCeoApprovalTotal` — sum of `estimated_total` for CEO-pending purchase requests
- **Label:** "Recorded cost only — excludes unrecorded estimates."
- **Tone:** Always blue/info (no risk tone — informational)
- **Link:** `/reports/costs`

---

## CEO Approval Banner

If `ceoApprovalQueue > 0`, a full-width red banner appears between the 4 cards and the decision queue:

> `{N} purchase requests need your final approval`
> `These have passed finance review. Your decision is the final step before procurement.`
> **[Review Now →]**

---

## Executive Decision Queue

A table showing the top 8 `purchase_requests` in `"Pending CEO Approval"` status, ordered oldest first.

**Columns:**
| Column | Source |
|--------|--------|
| Type | Always "Purchase" (badge) |
| Reference No. | `purchase_request_number` |
| Description / Reason | "Pending CEO approval" |
| Amount (KWD) | `estimated_total` |
| Waiting Since | `created_at` relative age (e.g. "3 days ago") |
| Action | Red "Review" button → `/purchase/requests/{id}` |

**Empty state:** If no items are pending, a green confirmation card displays:
> "No CEO approvals waiting. Operations are clear for final decision. All purchase requests are within finance authority."

---

## Operational Risk Alerts

Six alert cards in a 3-column grid, each showing count + responsible stage + link:

| Alert | Source | Stage | Link |
|-------|--------|-------|------|
| Waiting for Parts | `waitingPartsWorkOrders` | Store / Inventory | `/maintenance/work-orders?status=Waiting+for+Parts` |
| Waiting for Purchase | `waitingPurchaseWorkOrders` | Purchase Department | `/maintenance/work-orders?status=Waiting+for+Purchase` |
| Waiting for Finance | `financeQueue` (pending finance or CEO) | Finance Department | `/finance/approvals` |
| Overdue High/Urgent Jobs | `overdueHighRisk` | Maintenance Team | `/maintenance/work-orders` |
| Low Stock Parts | `lowStockCount` | Store / Inventory | `/store/low-stock` |
| CEO Decisions Pending | `ceoApprovalQueue` | Executive | `/ceo/approvals` |

**Tone rules:**
- Red: if count > 0 (except Low Stock which is amber at 1–5, red above 5)
- Green: if count = 0

---

## Financial Snapshot

A 2×2 grid of financial summary cards (left column of bottom section):

| Card | Value | Link |
|------|-------|------|
| Maintenance Spend This Month | `maintenanceCostThisMonth` KWD | `/reports/costs` |
| Pending Purchase Value | `totalPurchaseEstimatedCost` KWD | `/purchase/requests` |
| CEO Approval Value | `pendingCeoApprovalTotal` KWD | `/ceo/approvals` |
| Closed This Month | `completedThisMonth` work orders | `/reports/work-orders` |

**Note on cost data:** All monetary figures are labelled "Recorded cost only" since unrecorded or estimated costs may not be captured in the database until entered by the relevant role.

---

## Department Performance Snapshot

A panel showing up to 6 departments with active work orders, ordered by most pending:

**Data source:** Raw SQL query grouping `work_orders` by `departments.id`, counting:
- `pending` — WOs in `"Submitted"` or `"Pending Approval"`
- `in_progress` — WOs in `"In Progress"` or `"Assigned"`
- `blocked` — WOs in `"Waiting for Parts"`, `"Waiting for Purchase"`, `"Parts Issued"`
- `closed_month` — WOs in `"Closed"` updated since first of current month

Only departments with at least one work order are shown.

Each row shows red `{N} blocked` badge and amber `{N} pending` badge when non-zero. If a department has no active blockers, a green `clear` badge is shown.

---

## CEO Visibility Rules

### What CEO sees

- CEO/final approval items (purchase requests in `"Pending CEO Approval"`)
- High-value/high-risk work orders (high/urgent priority, open)
- Blocked operations (waiting parts, purchase, finance)
- Executive summaries and KPIs
- Cost exposure and pending purchase value
- Cross-department delay summaries
- Completed work this month

### What CEO does NOT see

- Normal drafts and routine operational records
- Low-priority work order lists
- Technician task micro-details
- Data-entry working forms
- All-time maintenance cost totals (CEO sees this-month only)
- Per-technician assignment tables

### Access for CEO to drill deeper

The CEO can navigate to:
- `/ceo/approvals` — detailed approval list with full action capability
- `/maintenance/work-orders` — full work order list (all statuses)
- `/purchase/requests` — all purchase requests
- `/reports/costs` — cost report with date filters
- `/reports/work-orders` — full work order report (generic admin layout for CEO, not manager-scoped)

---

## Data Queries

All CEO-specific data queries are gated behind `isCeoManagement` check to avoid unnecessary DB calls for other roles.

| Variable | Query |
|----------|-------|
| `maintenanceCostThisMonth` | `SUM(total_work_order_cost)` where `updated_at >= first_of_month` and status not Cancelled/Rejected |
| `pendingCeoApprovalTotal` | `SUM(estimated_total)` where `status = "Pending CEO Approval"` |
| `overdueHighRisk` | COUNT WOs where `starting_datetime < now` AND priority High/Urgent AND status not Closed/Cancelled/Rejected |
| `oldestBlockedDays` | `findFirst` WO in blocking statuses ordered by `updated_at ASC`, days since then |
| `ceoDecisionQueueRows` | `findMany` purchase_requests in `"Pending CEO Approval"`, ordered `created_at ASC`, limit 8 |
| `deptPerformance` | Raw SQL grouped by department, counts pending/in_progress/blocked/closed_month |

---

## How to Test as CEO

1. Log in as a user with role `ceo_management`.
2. Navigate to `/dashboard`.
3. Verify:
   - Page title: **CEO Executive Dashboard**
   - Dark header with status badge (Action Required / Monitor / Stable)
   - Header buttons: CEO Approvals (primary red), Cost Reports (outline), Work Orders + Purchase (text links)
   - Four summary cards: Needs CEO Decision, Blocked Operations, High Risk Work, Maintenance Spend This Month
   - If `ceoApprovalQueue > 0`: red full-width banner appears
   - Executive Decision Queue shows top 8 pending CEO approval items (or green empty state)
   - Operational Risk Alerts: 6 cards across 3 columns
   - Financial Snapshot: 4 financial tiles
   - Department Performance: department rows with blocked/pending badges
4. Click "CEO Approvals" — verify it goes to `/ceo/approvals`
5. Click a "Review" button in the decision queue — verify it goes to `/purchase/requests/{id}`
6. Click "Cost Reports" — verify it goes to `/reports/costs`
7. Verify no draft work orders, no technician tables, no per-employee details are visible.

---

## How Super Admin and Other Roles Differ

| Aspect | CEO | Super Admin / IT Admin |
|--------|-----|----------------------|
| Dashboard title | CEO Executive Dashboard | Dashboard |
| Header section | Dark + focused buttons | No CEO section |
| 4 summary cards | CEO-specific (Decision/Blocked/Risk/Cost) | Not shown |
| Decision queue | CEO-pending purchase requests | Not shown |
| Risk alerts | 6 operational risk cards | Not shown |
| Financial snapshot | Monthly cost + pending purchase | Not shown |
| Dept performance | Top 6 departments by pending | Not shown |
| Maintenance Workflow Overview | Hidden for CEO | Shown |
