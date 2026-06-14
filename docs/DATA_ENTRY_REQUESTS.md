# Data Entry — Creating Requests

This document explains how Maintenance Data Entry staff create and track maintenance requests in the RECAFCO system.

---

## Available Form Types

The **Create Request** button on the Work Orders page opens a form-type picker.

| Form | Status | Purpose |
|------|--------|---------|
| **Maintenance Work Order** | Enabled | Digitise the standard RECAFCO paper work order |
| **Parts Request** | Enabled | Request spare parts or materials against a work order |
| Vehicle Requisition | Coming soon | — |
| Daily Inspection Checklist | Coming soon | — |

---

## Work Order Form

### How to fill it

The digital form mirrors the company's paper work order layout — same sections, same field order, same signature structure.

**Required fields (marked with `*`):**

- **Order taken by** — name of the person recording the work order
- **Department** — the department requesting the maintenance work
- **Date of order** — defaults to today; adjust if entering a paper form retroactively
- **Operator complaint** — describe the fault or issue reported
- **Maintenance type** — pre-selected as Routine; change if needed
- **Worker team** — pre-selected as Mechanical; change to match the job

**Optional but recommended:**

- Asset / machine — link the work order to the asset master so history is tracked
- Job location — helps technicians and supervisors locate the job quickly
- Priority — set to High or Urgent for breakdowns
- Labor entries — can be filled later by the supervisor or technician
- Material entries — can be filled later; leave blank if unknown at submission time

### Saving vs. submitting

| Button | Status set | Effect |
|--------|-----------|--------|
| **Submit for Approval** | Pending Approval | Sends the WO to the Maintenance Manager for review — primary action for daily use |
| **Save Draft** | Draft | Saves without sending; visible only to you until submitted — use only if the form is incomplete |

A reference number (e.g. `REC/MD/MECH/JOB/0001`) is generated automatically when you save or submit.

**Submit requires these fields to be filled:**

- Order taken by
- Department
- Operator complaint
- Description of work
- Maintenance type (pre-selected — change if needed)
- Worker team (pre-selected — change if needed)

**Auto-recovery on submit failure:**
If the submit unexpectedly fails but you have entered meaningful data, the system will automatically save your work order as a Draft and redirect you to it with a warning. No data is lost. From the draft view, use the workflow action panel to resubmit for approval once any issues are resolved.

---

## Parts Request Form

The Parts Request form is at `/store/parts-requests/new` and is also reachable from the **Create Request** picker.

### How to fill it

1. Select the **Work Order** the parts are needed for — the dropdown shows only work orders visible to your role.
2. Add one or more parts rows: description, part number, SS rec code, quantity, unit price.
3. Fill in requested by, prepared by, and any remarks.
4. Submit for approval or save as a draft.

Parts requests go to the Maintenance Manager for approval, then to the Store Keeper for issue.

---

## Lifecycle — Draft to Closed

```
Draft  →  Pending Approval  →  Approved  →  Waiting for Store
       ↘ (rejected)                        →  Partially Issued
                                            →  Issued
                                            →  Waiting for Purchase  →  Closed
```

---

## Tracking Your Requests

Use the **Quick Actions** bar on the Work Orders page to jump directly to filtered views:

| Quick Action | Shows |
|--------------|-------|
| My Requests | All work orders you created, any status |
| My Drafts | Work orders saved as Draft — not yet submitted |
| My Submitted | Work orders you submitted — awaiting or past approval |
| Rejected / Fix | Work orders returned for correction |

Work orders progress through the workflow automatically after you submit them. You do not need to push them forward — the Maintenance Manager, Supervisor, and Store Keeper each act from their own dashboards.

---

## Access Control

- Data Entry staff see **only the work orders and parts requests they created**.
- They cannot view records created by colleagues, even within the same department.
- The work order dropdown on the Parts Request form is scoped to the same visibility rule — Data Entry staff see only their own work orders in that list.
- Workflow action buttons (approve, assign, close) are not available to Data Entry users unless their profile has been explicitly granted those permissions.
