# CEO Executive Reports Center

The `/reports/work-orders` page for users with role `ceo_management` renders the **CEO Executive Reports Center** — a purpose-built executive reporting view that replaces the generic work order list with six focused report modes designed around what the CEO actually needs to see.

---

## Purpose

The CEO needs executive-level summaries, not granular operational lists. The CEO Executive Reports Center surfaces:

1. **Cross-department performance summaries** — not department-scoped lists
2. **CEO approval queue** — purchase requests requiring final sign-off
3. **Cost exposure** — total procurement value in the pipeline
4. **Blocked operations** — what is stuck and needs executive attention
5. **Department performance** — which departments are generating delays
6. **Asset risk** — high-priority and frequently breaking equipment

---

## How It Differs from Other Roles

| Role | Reports layout |
|------|---------------|
| Super Admin / IT Admin | Generic work order table, all departments, global totals |
| CEO / Management | **6-mode Executive Reports Center — this page** |
| Maintenance Manager | 6-mode department-scoped Report Center |
| Other roles | Generic layout (permission-gated) |

The CEO branch is an **early-return** inside `app/(dashboard)/reports/work-orders/page.tsx` — it runs before the `isManager` check and completely separates the CEO layout from both the manager and admin branches.

---

## Report Modes

Navigate between modes using the horizontal scrollable mode navigation cards. Each card links to `?report=<mode>`. Switching modes clears other filters.

### 1. Executive Summary (`?report=executive-summary`)

**Default mode** — loads when no `?report=` param is set for CEO.

**Default date range:** Automatically defaults to first of the current month if no dates are set.

**Purpose:** Monthly overview of all work orders across the company. The CEO's starting point for any reporting session.

**Summary cards:**
- Work Orders This Period
- Closed This Period
- Pending Approval
- CEO Approvals Waiting

**Group breakdowns:**
- By Department
- By Status
- By Type

**Table:** WO No | Department | Asset | Type | Status | Priority | View

**Filters:** From, To, Department

---

### 2. CEO Approval Queue (`?report=ceo-approvals`)

**Purpose:** Purchase requests that have cleared finance review and need the CEO's final decision. This is the CEO's primary action mode.

**Summary cards:**
- Pending CEO Approval (count)
- Total Value (KWD)
- Oldest Waiting (days)

**Table:** PR No | WO No | Department | Priority | Supplier | Status | Est. Total (KWD) | Waiting | Review button

**Empty state:** "No CEO approvals waiting. All purchase requests are within finance authority. No CEO action required."

**Filters:** From, To, Priority

**Action:** "Review" button (red) → `/purchase/requests/{id}`

---

### 3. Cost Exposure (`?report=cost-exposure`)

**Purpose:** All active purchase requests in the procurement pipeline — total cost exposure across statuses.

**Summary cards:**
- Active Purchase Rows
- Total Estimated Value (KWD)
- Pending CEO Approval (KWD)

**Table:** PR No | WO No | Department | Priority | Supplier | Status | Est. Total (KWD) | Created | View

**Empty state:** "No active purchase requests match the current filters."

**Filters:** From, To, Department, Min Value (KWD), Max Value (KWD)

**Export kind:** `purchase-requests` (not work-orders)

---

### 4. Blocked Operations (`?report=blocked-operations`)

**Purpose:** Work orders currently blocked by parts availability or the purchase process. These are operations that cannot proceed without intervention.

**Statuses included:** `Waiting for Parts`, `Waiting for Purchase`, `Parts Issued`

**Summary cards:**
- Waiting for Parts
- Waiting for Purchase
- Parts Issued (pending)
- Oldest Blocked (days)

**Group breakdowns:**
- By Department
- By Priority

**Table:** WO No | Department | Asset | Type | Status | Priority | Blocked (days) | Escalate button

**Empty state:** "No blocked operations found."

**Filters:** From, To, Department, Priority

**Action:** "Escalate" button (red) → `/maintenance/work-orders/{id}`

---

### 5. Department Performance (`?report=department-performance`)

**Purpose:** Side-by-side view of work order volumes per department. Helps the CEO identify which departments have high pending queues or blocked operations.

**Summary cards:**
- Departments with WOs
- Total Blocked Operations
- Pending Approvals

**Table (grouped by department):**
| Department | Pending Approval | In Progress | Blocked | Closed (Period) | Total |

**Sorting:** Departments with most blocked operations shown first.

**Empty state:** "No department data found."

**Filters:** From, To (no department filter — always shows all)

---

### 6. Asset Risk (`?report=asset-risk`)

**Purpose:** High-priority and breakdown work orders grouped and sorted by asset. Helps the CEO identify problem equipment requiring investment or retirement decisions.

**Summary cards:**
- High / Urgent Priority
- Breakdown Type WOs
- Assets with Open WOs

**Group breakdowns:**
- By Asset (most WOs)
- By Maintenance Type

**Table:** WO No | Department | Asset | Type | Status | Priority | View

**Empty state:** "No high-risk work orders found."

**Filters:** From, To, Department, Asset, Priority

---

## Dashboard Integration

The CEO dashboard (`/dashboard`) links to the Executive Reports Center in two places:

| Element | Previous link | Updated link |
|---------|--------------|-------------|
| Header "Cost Reports" button | `/reports/costs` | `/reports/work-orders?report=cost-exposure` |
| CEO mobile quick actions "Cost Reports" | `/reports/costs` | `/reports/work-orders?report=cost-exposure` |

---

## Scope and Security

- CEO has **no department scoping** — all modes show cross-department data.
- The `isCeo` check (`context.role?.slug === "ceo_management"`) triggers the early-return branch.
- The export route (`/api/exports/[kind]/route.ts`) applies no forced department scoping for CEO.
- Cost fields (`estimated_total`) are visible to CEO since the role has cost visibility authority.
- The CEO branch does **not** affect the Maintenance Manager branch or the Admin/generic branch.

---

## Data Sources

| Mode | Primary data source |
|------|-------------------|
| executive-summary | `getWorkOrderReport(ceoFilters)` — current month default |
| ceo-approvals | `getCeoPurchaseApprovals()` — `status = "Pending CEO Approval"` |
| cost-exposure | `getCeoAllPurchaseRows()` — all non-cancelled/rejected purchase requests |
| blocked-operations | `getWorkOrderReport()` with `statusIn: ["Waiting for Parts", "Waiting for Purchase", "Parts Issued"]` |
| department-performance | `getWorkOrderReport()` then JS-grouped by department |
| asset-risk | `getWorkOrderReport()` then displayed by asset |

All CEO-specific queries are in `lib/reports/data.ts`:
- `getCeoPurchaseApprovals(filters)` — CEO approval queue
- `getCeoAllPurchaseRows(filters)` — cost exposure purchase data
- `parseCeoReportMode(raw)` — parses URL param to `CeoReportMode`, defaults to `"executive-summary"`

---

## Filter Behavior Per Mode

| Filter field | Modes where visible |
|---|---|
| From / To (date range) | All modes |
| Department | All except department-performance |
| Priority | ceo-approvals, blocked-operations, asset-risk |
| Asset | asset-risk only |
| Cost Min / Max | cost-exposure only |

---

## How to Test as CEO

1. Log in as a user with role `ceo_management`.
2. Navigate to `/reports/work-orders`.
3. Verify:
   - Red scope banner: **"Scope: Executive cross-department view"**
   - 6 mode cards are shown: Executive Summary (selected by default), CEO Approvals, Cost Exposure, Blocked Operations, Dept. Performance, Asset Risk
   - Default date range auto-set to first of current month for Executive Summary
   - Summary cards, group breakdowns, and table columns change per mode
4. Click "CEO Approvals" mode → verify purchase table appears with PR No, WO No, Department, Estimated Total columns
5. If no CEO approvals exist → verify green empty state: "No CEO approvals waiting."
6. Click "Blocked Operations" → verify table shows only WOs in Waiting for Parts / Waiting for Purchase / Parts Issued
7. Click "Department Performance" → verify grouped department table (no regular WO table)
8. Apply a date filter and click Apply → verify results narrow; click Clear → verify filters reset but mode stays
9. Click "Export Current Report" → verify Excel download with relevant data
10. Navigate from CEO dashboard "Cost Reports" button → verify it links to `?report=cost-exposure`

---

## How Super Admin / Manager Differ

| Aspect | CEO | Super Admin | Maintenance Manager |
|--------|-----|-------------|-------------------|
| Report type | Executive Reports Center | Generic work order list | Department-scoped Report Center |
| Modes available | 6 CEO modes | None (generic layout) | 6 manager modes |
| Scope | All departments | All departments | Own department only |
| Filter: Department | Optional drill-down | Full dropdown | Locked badge |
| Filter: Technician | Not shown | Available | Available |
| Cost fields | Visible | Visible | Permission-gated |
| Default mode | executive-summary | — | pending-approvals |
| Export kind | work-orders or purchase-requests | work-orders | work-orders |
