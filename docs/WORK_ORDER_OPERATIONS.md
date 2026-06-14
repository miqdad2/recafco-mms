# Work Order Operations Guide

## Overview

The Work Orders page (`/maintenance/work-orders`) is the daily operations command center for RECAFCO's maintenance department. It surfaces operational status, role-specific quick actions, and the full maintenance workflow in one view.

---

## Role-Based Views

Each role sees the same page but with different quick actions, highlighted "Needs My Action" items, and contextually adapted next-action labels.

| Role | Primary Focus | Primary Quick Action |
|------|--------------|----------------------|
| Maintenance Manager | Approve/reject pending work | Needs Approval → Pending Approval list |
| Maintenance Supervisor | Assign technicians, verify completions | Ready to Assign → Approved list |
| Maintenance Data Entry | Create and submit work orders | New Work Order |
| Technician | Start and complete assigned jobs | My Jobs → /technician/jobs |
| Store Keeper | Issue parts for waiting work orders | Waiting for Parts list |
| Purchase Officer | Process purchase requests | Waiting for Purchase list |
| Finance Manager | Approve finance-related items | Finance Approvals → /finance/approvals |
| CEO / Management | Final approvals, high-value oversight | CEO Approvals → /ceo/approvals |
| Super Admin / IT | Full system view and monitoring | Pending Approval + Needs My Action |

---

## Operational KPI Cards

Eight operational cards at the top of the page:

| Card | Statuses Counted | Urgent Highlight |
|------|-----------------|-----------------|
| Total Work Orders | All | No |
| Pending Approval | Submitted + Pending Approval | Yes — amber border when > 0 |
| High / Urgent | Active WOs with High or Urgent priority | Yes — red border when > 0 |
| Active Jobs | Approved + Assigned + In Progress | No |
| Waiting for Parts | Waiting for Parts + Parts Issued | Yes — amber when > 0 |
| Waiting for Purchase | Waiting for Purchase | Yes — amber when > 0 |
| Overdue | Open WOs with date of order > 7 days ago | Yes — red when > 0 |
| Closed | Closed | No — shows pending-closure count as detail |

---

## Workflow Status Tabs

Tabs appear above the table and allow one-click filtering by status while preserving all other active filters (search, priority, department, date range, etc.).

```
All | Draft | Submitted | Pending Approval | Approved | Assigned | In Progress
    | Waiting Parts | Waiting Purchase | Completed | Verified | Closed | Rejected
```

Each tab shows a count badge. The active tab is highlighted in RECAFCO red.

---

## Status Meanings

| Status | Meaning |
|--------|---------|
| Draft | Created, not yet submitted for approval |
| Submitted | Submitted to manager queue |
| Pending Approval | Manager is reviewing |
| Approved | Manager approved — supervisor to assign |
| Rejected | Rejected — data entry must correct and resubmit |
| Assigned | Technician assigned — job not yet started |
| In Progress | Technician has started the job |
| Waiting for Parts | Job paused — parts request open |
| Waiting for Purchase | Parts unavailable — purchase request open |
| Parts Issued | Store issued parts — work can resume |
| Completed by Technician | Technician marked job done |
| Verified by Supervisor | Supervisor confirmed completion |
| Confirmed by Requester | Requester confirmed job done |
| Closed | Manager closed the work order |
| Cancelled | Work order cancelled |
| Reopened | Closed work order reopened for additional work |

---

## Status Pipeline (Mini Indicator)

Each row shows a compact 8-segment progress bar indicating which stage the work order is in.

```
[Draft] → [Submitted] → [Approval] → [Approved] → [Assigned] → [Active] → [Completed] → [Closed]
```

Segments filled in red = completed stages. The current stage is shown at ~60% opacity. Rejected or cancelled work orders show the filled segments in red (failure state).

---

## Needs My Action

An orange dot appears next to the work order number when the logged-in user must take action. The "Act" button (red) replaces the standard "View" button.

Action is triggered based on role and permissions:

| Permission | Triggers "Needs Action" |
|-----------|------------------------|
| `work_orders.approve` | Submitted, Pending Approval, Verified by Supervisor, Confirmed by Requester |
| `work_orders.assign` | Approved, Completed by Technician |
| `store.issue` | Waiting for Parts |
| `purchase_requests.manage` | Waiting for Purchase |
| `work_orders.manage` (no approve) | Draft or Rejected WOs created by this user |

The **"Needs my action" checkbox filter** in the filter bar narrows the list to only these records.

---

## Filters

Available filters:

| Filter | Description |
|--------|-------------|
| Search | Work order number, asset name, plate number, ordered by, job location, complaint |
| Priority | Low / Normal / High / Urgent |
| Department | Any active department |
| Worker Type | Auto / Mechanical / Electrical / Civil / AC / Plumbing / Welding / Other |
| Date From | Work orders on or after this date |
| Date To | Work orders on or before this date |
| Needs My Action | Show only items requiring action from the logged-in user |

All filters are applied server-side. Filters compose with each other (AND logic). The workflow tab also applies as a status filter and stacks with other active filters.

---

## Table Columns

| Column | Contents |
|--------|---------|
| Work Order | Number, ordered by, mini pipeline |
| Asset / Vehicle | Asset name, code, plate number |
| Department | Requesting department |
| Type | Maintenance type + worker type |
| Priority | Priority badge (red for Urgent, amber for High) |
| Status & Next Action | Status badge + contextual next-action label |
| Technician | Assigned technician name(s) |
| Age | Days since work order was created; shown in red if overdue |
| Action | "Act" (red) if needs action, "View" otherwise + optional print button |

Urgent work orders have a red left border on the row for at-a-glance visibility.

---

## Template Picker (New Work Order)

The "New Work Order" button opens a dropdown with available form types:

| Template | Status | Route |
|----------|--------|-------|
| Maintenance Work Order | Available | `/maintenance/work-orders/new` |
| Vehicle Requisition | Coming soon | — |
| Daily Inspection Checklist | Coming soon | — |

Future templates will be added to this list once the dynamic template system is implemented. The UI is already prepared to display them.

---

## Daily Workflow Usage

### Maintenance Data Entry — Daily flow

1. Open Work Orders → click **New Work Order** → fill Maintenance Work Order form
2. Save as Draft or Submit for Approval directly
3. Monitor **My Submitted** quick action to track pending approvals
4. If rejected: **Rejected / Fix** quick action shows WOs to correct

### Maintenance Manager — Daily flow

1. Open Work Orders → **Needs Approval** quick action to see queue
2. Open each work order → Approve or Reject with comments
3. Monitor **Waiting Purchase** and **Ready to Close** buckets
4. Close work orders from Verified/Confirmed list

### Maintenance Supervisor — Daily flow

1. Open Work Orders → **Ready to Assign** quick action (Approved status)
2. Open each WO → assign one or more technicians
3. Monitor **In Progress** and **Need Verification** buckets
4. Verify completed jobs from Completed by Technician list

### Technician — Daily flow

1. Go to `/technician/jobs` (mobile-optimized) for personal job list
2. Or open Work Orders → **In Progress** to see active work
3. Start job, add notes, upload photos, mark complete

### Store Keeper — Daily flow

1. Open Work Orders → **Waiting for Parts** quick action
2. Open each WO → navigate to related parts request → issue parts

---

## Performance

- All queries use indexed columns (`status`, `priority`, `department_id`, `date_of_order`, `created_at`)
- Page size: 25 records with server-side pagination
- Status summaries and priority summaries are `GROUP BY` queries (fast, no row iteration)
- Work order list uses selective `select` to avoid loading large text fields
- The overdue count is a single `COUNT` query with an indexed date filter

---

## Future Template Support

The template picker dropdown and the form type UI are already in place. When the dynamic template system is built:

1. Add templates to a `work_order_templates` table
2. Update the `TemplatePickerButton` component to fetch and list active templates
3. Add template selection to the work order creation form
4. The Work Orders list will add a "Form Type" column when templates are active
