# CEO Work Orders Page

## Why CEO Cannot Create Work Orders

The CEO / Management role is an executive decision-maker, not a data entry or maintenance operations role. Work orders are created by Maintenance Data Entry staff. The CEO sees work orders only when they require executive attention — approval above a cost threshold, unresolved high-risk items, or blocked operations affecting company operations.

The "Create Request" button, parts request form, vehicle requisition, and daily inspection checklist are **not shown** to CEO / Management.

---

## What CEO Sees

The page at `/maintenance/work-orders` for CEO / Management shows only executive-relevant work orders:

| Category | Criteria |
|---|---|
| **Needs CEO Decision** | Work orders linked to a purchase request with status "Pending CEO Approval" |
| **High Risk Work** | Work orders with High or Urgent priority that are still open (not Closed/Cancelled) |
| **Blocked Operations** | Work orders with status "Waiting for Parts" or "Waiting for Purchase" |
| **Overdue Critical** | Work orders still open after 7+ days (not Closed/Cancelled) |
| **Cost Exposure** | Work orders with `total_work_order_cost ≥ 500 KWD` (only if cost visibility is granted) |
| **Waiting Finance/Purchase** | Work orders linked to purchase requests in "Pending Finance Approval" or "Pending CEO Approval" |

This filtering is enforced both in the visibility layer (`lib/work-orders/visibility.ts`) and as tab conditions on top.

---

## What CEO Does NOT See

- Ordinary draft work orders
- Routine low-priority work
- All submitted/pending approval forms (unless they are High/Urgent)
- Technician operational task lists
- Data-entry working records
- Normal operational tabs: Draft, Submitted, Pending Approval, Approved, Assigned, In Progress, Waiting Parts, Completed, Verified, Closed, Rejected

---

## Page Title

| Field | Value |
|---|---|
| Title | Executive Work Orders |
| Subtitle | High-risk work orders, blocked operations, and items needing executive attention. |

---

## Executive KPI Cards (6)

| Card | Count source | Tone |
|---|---|---|
| Needs CEO Decision | purchase_requests.some status = "Pending CEO Approval" | Red |
| High Risk Work | priority in High/Urgent, status not terminal | Amber |
| Blocked Operations | status in Waiting for Parts / Waiting for Purchase | Amber |
| Overdue Critical | created_at < 7 days ago, status not terminal | Red |
| Cost Exposure | Link to cost-exposure report (or high_cost tab if cost visible) | Blue |
| Waiting Finance/Purchase | purchase_requests.some in Finance/CEO approval status | Amber |

---

## Executive Tabs

| Tab | URL param | Filter |
|---|---|---|
| All Executive Items | `ceo_tab=` (empty) | No additional filter |
| Needs CEO Decision | `ceo_tab=decisions` | purchase_requests.some Pending CEO Approval |
| High Risk | `ceo_tab=high_risk` | priority in High/Urgent + not terminal |
| Blocked | `ceo_tab=blocked` | status Waiting for Parts / Waiting for Purchase |
| Overdue | `ceo_tab=overdue` | created_at < overdueThreshold + not terminal |
| High Cost | `ceo_tab=high_cost` | total_work_order_cost ≥ 500 KWD (only if canViewCosts) |

---

## Executive Filters

| Filter | Notes |
|---|---|
| Search | Work order no., asset name, requester, complaint |
| Priority / Risk | Low / Normal / High / Urgent |
| Department | All active departments |
| Executive Stage | Dropdown matching the tabs |
| Date range | From / To (applies to created_at) |
| Min cost (KWD) | Only shown if canViewCosts is true |

**Hidden from CEO:** Worker type, Technician, Maintenance type dropdown, Needs my action checkbox.

---

## Table Columns

| Column | Source |
|---|---|
| Reference No. | work_order_number + date_of_order |
| Department | departments.name |
| Asset / Vehicle | assets.asset_name + asset_code + plate_number |
| Reason / Description | maintenance_type + job_location |
| Why CEO Sees This | Computed from status, purchase_requests, priority, age |
| Risk / Priority | StatusBadge on priority |
| Current Stage | StatusBadge on status |
| Waiting Since / Age | Days since created_at; red if overdue |
| Cost (KWD) | total_work_order_cost (only if canViewCosts) |
| Action | Approve/Reject (if CEO approval needed) or Review |

---

## "Why CEO Sees This" Label Logic

Evaluated in priority order:

1. Any linked purchase request has status "Pending CEO Approval" → **"Waiting CEO approval"** (red)
2. status = "Waiting for Purchase" → **"Blocked by purchase"** (amber)
3. status = "Waiting for Parts" → **"Blocked by parts"** (amber)
4. created_at < overdueThreshold and status not terminal → **"Overdue N days"** (red)
5. priority = "Urgent" → **"Urgent — high-risk open work"** (red)
6. priority = "High" → **"High priority open work"** (amber)
7. Fallback → **"Executive visibility"** (gray)

---

## Action Rules

| Scenario | Button shown | Links to |
|---|---|---|
| Work order has purchase request "Pending CEO Approval" | **Approve / Reject** (red) | `/ceo/approvals` |
| All other executive items | **Review** (outlined) | `/maintenance/work-orders/[id]` |

The CEO is NOT shown edit, assign, or close buttons. Those actions belong to Maintenance Manager / Supervisor.

---

## Empty State

When no executive work orders match:

> "No executive work order items need attention right now."

With subtext: "All executive-relevant work orders are up to date." (or "Try adjusting or clearing the filters." if filters are active)

---

## How to Test as CEO

1. Log in as a user with role `ceo_management`
2. Navigate to `/maintenance/work-orders`
3. Verify:
   - Page title is "Executive Work Orders"
   - No "Create Request" button visible
   - Only executive KPI cards shown (6 cards)
   - Executive tabs shown (not Draft / Submitted / etc.)
   - Worker type filter not present
   - "Needs my action" checkbox not present
   - Table has "Why CEO Sees This" column
   - Rows with "Pending CEO Approval" show "Approve / Reject" action
   - All other rows show "Review" action
4. Click "CEO Decisions" tab — only purchase-approval items shown
5. Click "Blocked" tab — only Waiting for Parts / Purchase shown
6. Click "Approve / Reject" on a CEO approval row — goes to `/ceo/approvals`

---

## How Other Roles Are Unaffected

The CEO logic is implemented as an **early-return block** at the top of `WorkOrdersPage`, guarded by:

```typescript
if (context.role?.slug === "ceo_management") {
  // CEO-specific UI
  return (...);
}
// All existing code continues for all other roles
```

- Maintenance Data Entry: sees only their own created work orders + Create Request button
- Maintenance Manager: sees department work orders + approval actions
- Super Admin: sees all work orders + full operational view
- None of these code paths are touched by the CEO early-return
