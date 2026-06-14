# Phase 5-E Management Demo Runbook
## Inventory Check Workflow — End-to-End

**Demo work order:** `REC/MD/MECH/JOB/0013`  
**Asset:** Toyota Coaster Bus (AST-BUS-001)  
**Prepared for:** RECAFCO Management Review  
**Phase:** 5-E (Inventory Check Gate — no shortage automation yet)

---

## Before You Start

| Prerequisite | Confirm |
|---|---|
| App running at localhost | ☐ |
| `inventory_check_enabled = true` in Admin → Settings | ☐ |
| WO `REC/MD/MECH/JOB/0013` exists and is in Approved status | ☐ |
| Required parts: 3 rows, all "unchecked" | ☐ |
| Store Keeper, Supervisor, Technician users active | ☐ |

> **Reset tip:** If the demo WO has already been assigned from a previous run, go to the work order detail page as Super Admin and note the status. A fresh demo requires the WO to be in Approved status with required parts as "unchecked". Run `node demo-setup.cjs` again only if data was consumed.

---

## Role Sequence Overview

```
Data Entry  →  Maintenance Manager  →  Store Keeper  →  Supervisor  →  Technician
(context)       (context)               (LIVE DEMO)      (LIVE DEMO)    (LIVE DEMO)
```

Steps 1 and 2 are pre-done context — the WO is already Approved in the system.  
The live demo begins at Step 3 (Store Keeper).

---

## Step 1 — Maintenance Data Entry (Context)

**Role:** Maintenance Data Entry  
**Page:** `/maintenance/work-orders/REC/MD/MECH/JOB/0013`

### What to show

Open the work order detail page. Point to the **Required Parts** section.

| Field | Value |
|---|---|
| Motor belt | Part no: DEMO-BELT-001 · Qty: 2 · PCS |
| Hydraulic oil filter | Part no: DEMO-FILTER-001 · Qty: 1 · PCS |
| Bearing set | Part no: DEMO-BEARING-001 · Qty: 1 · PCS |

Point to the status badge showing **Approved** and the workflow tracking panel showing the current step as **Inventory Check — Pending**.

### What to click

- Work order number in header — confirm `REC/MD/MECH/JOB/0013`
- Scroll to Required Parts section
- Scroll to workflow tracking panel

### Expected result

Three required parts rows visible with `unchecked` status badges. Workflow panel shows:
- Draft Submission ✓ completed
- Manager Review ✓ completed  
- Inventory Check ⏳ pending ← current step

### Talking point

> "When Data Entry creates a work order, they can list the parts they expect to need. This is a pre-job checklist — not a stock request. The Store Keeper will confirm availability before any technician is assigned. This prevents sending a technician to a job site where the required materials are not ready."

---

## Step 2 — Maintenance Manager (Context)

**Role:** Maintenance Manager  
**Page:** `/maintenance/work-orders/REC/MD/MECH/JOB/0013`

### What to show

Point to the workflow tracking panel:
- Manager Review step shows **Approved** with the manager's name and timestamp.
- Work order status is **Approved** — not yet assigned.
- Inventory Check step shows **Pending** — Store Keeper has not confirmed yet.

### What to click

- Scroll to approval history / tracking panel on the work order detail page

### Expected result

Manager approval is recorded. Work order is in Approved status awaiting inventory check.

### Talking point

> "The Manager approves the work request — confirms it is a valid job and the right priority. But approval does not mean the parts are available. The system immediately moves to the inventory check step. Store must confirm material availability before assignment can proceed."

---

## Step 3 — Store Keeper Inventory Check (LIVE)

**Role:** Store Keeper  
**Page:** `/store/inventory-check`

### What to click

1. Login as Store Keeper
2. Navigate to **Store → Inventory Check** in the sidebar
3. Locate `REC/MD/MECH/JOB/0013` in the queue
4. Click to expand the work order
5. Confirm each required part:
   - **Motor belt** → set to **Available** → confirm
   - **Hydraulic oil filter** → set to **Partial** → confirm
   - **Bearing set** → set to **Unavailable** → confirm

### Expected result after each confirmation

- Motor belt: status badge changes to green **Available**
- Hydraulic oil filter: status badge changes to amber **Partial**
- Bearing set: status badge changes to red **Unavailable**
- After confirming Bearing set (the last unchecked row):
  - Success message shown
  - Notification fires to Maintenance Manager and Maintenance Supervisor
  - Inventory check step in tracking panel advances to **completed**
  - Work order status remains **Approved** (no status change)
  - No stock is deducted
  - No parts request is created

### What NOT to see (verify these are absent)

- No inventory movement created
- No parts request created automatically
- No purchase request created automatically
- Work order status does NOT change from Approved

### Talking point

> "The Store Keeper opens the inventory check queue — this only shows work orders that are approved and waiting for part confirmation. They check the physical shelves and confirm what is available, what is only partially available, and what is not in stock at all. This is a planning check — no stock is moved and no purchase is triggered yet. The system records the known shortage. What happens next is a business decision."

---

## Step 4 — Notification (LIVE)

**Role:** Maintenance Manager or Maintenance Supervisor  
**Page:** Notification bell in the top bar → `/notifications`

### What to show

After Store Keeper confirms the last required part, switch to the Manager or Supervisor login. Show the notification bell with an unread count. Open the notification center.

### Expected result

Notification reads:

> **Inventory check complete — REC/MD/MECH/JOB/0013**  
> All required parts have been confirmed by Store Keeper. Work order REC/MD/MECH/JOB/0013 is ready for technician assignment.  
> [Open assignments]

### Talking point

> "The system automatically notifies the responsible users when a work order has cleared the inventory check. No manual follow-up calls or emails needed. The Supervisor knows immediately that they can proceed with assigning a technician — and they also know in advance that some parts are only partially available."

---

## Step 5 — Supervisor Assignment (LIVE)

**Role:** Maintenance Supervisor  
**Page:** `/maintenance/assignments`

### What to click

1. Login as Maintenance Supervisor
2. Navigate to **Maintenance → Assignments** in the sidebar
3. Locate `REC/MD/MECH/JOB/0013`

### Expected result — before any parts were checked (context to explain)

> If the demo were run before Store Keeper confirmed, the card would show:
> - Amber warning: "Inventory check pending"
> - Assign button **disabled**  
> — The system prevents assignment until Store Keeper reviews all parts.

### Expected result — now (after Store Keeper confirmed all parts)

- Green label: **"Inventory check complete — ready for assignment"**
- Amber note: shortage information visible (partial/unavailable parts noted)
- Assign button **enabled**

4. Click **Assign technician**
5. Select **Tariq Al-Hamad** from the technician list
6. Submit

### Expected result after assignment

- Work order status changes to **Assigned**
- Work order disappears from inventory check queue (it is no longer in Approved status)
- Technician receives assigned job notification

### Talking point

> "The Supervisor sees a clear signal — green means ready, amber means there is a known shortage to be aware of. In this phase, a partial or unavailable part does not block assignment. The Supervisor makes the business call: proceed with what is available, or wait. The shortage is recorded. The next phase will add a formal shortage decision flow — today we are confirming that the information is correct before we build the rules around it."

---

## Step 6 — Technician Job View (LIVE)

**Role:** Technician  
**Page:** `/technician/jobs`

### What to click

1. Login as Technician (Tariq Al-Hamad)
2. Navigate to the technician mobile dashboard

### Expected result

- Job `REC/MD/MECH/JOB/0013` appears in the assigned jobs list
- Technician can tap the job to view details
- Technician can start the job, add notes, add labor hours, upload photos, and mark complete — the normal job flow is unchanged

### What NOT to see

- No other work orders visible (technicians only see assigned jobs)
- No cost data, no approval history, no purchase information

### Talking point

> "Technicians only see their assigned jobs. All the approval, inventory check, and shortage decisions happened before this stage — the technician simply sees the job is ready and can begin. The mobile view is designed for field use: large buttons, quick actions, photo upload."

---

## Step 7 — Feature Flag / Rollback (LIVE)

**Role:** Super Admin  
**Page:** `/admin/settings`

### What to show

1. Login as Super Admin
2. Navigate to **Admin → Settings**
3. Locate `Inventory Check` toggle (or `inventory_check_enabled`)
4. Show it is currently **ON**

Explain the rollback path:

> "If we disable this flag, the inventory check queue disappears from the Store Keeper's menu. The assignment page returns to the previous behavior — no inventory labels, no gate, assign button always enabled. Existing assigned work orders are not affected. No database rollback needed — it is a single toggle."

5. (Optional) Disable the flag, switch to Store Keeper login, show the queue is gone, switch back to Supervisor to show the gate is removed, then re-enable.

### Talking point

> "Every new workflow step is gated behind a feature flag. We can roll back at any point without touching the code or the database. This gives management and IT full control over when each feature is active."

---

## Non-Goals — Explicitly Confirm with Management

Explain clearly before or after the demo that the following are **not yet implemented** and will require a separate business decision (E5):

| Not yet built | Reason it is deferred |
|---|---|
| Automatic parts request creation from shortage | Need to confirm: who initiates it and who approves it |
| Automatic purchase request from unavailable parts | Need to confirm approval chain (Production Manager → Factory Manager → Purchase Manager → Finance → CEO?) |
| "Waiting for Parts" automatic status | Need to confirm: auto or manager decision? |
| Stock deduction from inventory check | Stock moves only when parts are physically issued (Store Issue flow — already built) |
| Re-confirmation of parts after purchase received | Pending E5 — loop back to inventory check after PO receipt |
| CEO/Finance cost chain for shortages | Already built for existing purchase flow — needs mapping to shortage path |

---

## Questions to Ask Management

Present these as decisions needed before E5 implementation begins. Record answers in the meeting.

**Q1 — Partial/unavailable blocking policy**  
*"Should partial or unavailable parts block technician assignment, or should the Maintenance Supervisor decide case by case?"*

- Option A: Block assignment until shortage is resolved or Manager overrides
- Option B: Allow assignment with a visible shortage note (current behavior)
- Option C: Block only for Unavailable; allow for Partial

**Q2 — Shortage request initiation**  
*"When parts are unavailable after inventory check, who creates the shortage/parts request — the Store Keeper or the Maintenance Manager?"*

- Option A: Store Keeper clicks "Create shortage request" directly from inventory check page
- Option B: Maintenance Manager receives notification and decides whether to create a request
- Option C: System creates a draft; Manager reviews and submits

**Q3 — Shortage approval chain**  
*"For shortage-triggered parts requests, which approval levels are required before a purchase is authorized?"*

- Current purchase flow: Purchase Officer → Finance Manager → CEO (above threshold)
- Proposed for shortages: Production Manager → Factory Manager → Purchase Manager → Finance → CEO?
- Question: Is this chain for all shortage requests, or only above a certain value?

**Q4 — Waiting for Parts status**  
*"Should the work order automatically move to 'Waiting for Parts' when a shortage is detected, or only after the Manager makes a decision?"*

- Automatic: work order moves to Waiting for Parts when Store confirms unavailable
- Manual: Manager reviews the shortage notification and explicitly pauses the work order

**Q5 — Parts re-confirmation after purchase**  
*"After parts are ordered and received, should Store Keeper re-confirm required parts availability before assignment proceeds again?"*

- Yes: re-run the inventory check gate after PO receipt
- No: Manager or Supervisor manually reviews and re-assigns

**Q6 — CEO/Finance cost threshold**  
*"Should the existing CEO approval threshold (currently 1,000 KWD) apply to shortage-driven purchases, or should shortages have a separate policy?"*

**Q7 — Production/Factory Manager scope**  
*"Should Production Manager and Factory Manager be involved in all shortage approvals, or only for project-site and construction-site work orders?"*

---

## Decisions Needed Before E5 Can Begin

| Decision | Owner | Status |
|---|---|---|
| Q1: Blocking policy for partial/unavailable parts | Maintenance Manager | ☐ Pending |
| Q2: Who initiates the shortage request | Maintenance Manager + Store Manager | ☐ Pending |
| Q3: Approval chain for shortage purchases | Finance Manager + CEO | ☐ Pending |
| Q4: Auto vs. manual "Waiting for Parts" transition | Maintenance Manager | ☐ Pending |
| Q5: Re-confirmation after purchase receipt | Store Manager | ☐ Pending |
| Q6: CEO threshold for shortage purchases | CEO / Finance | ☐ Pending |
| Q7: Production/Factory Manager involvement scope | Operations / CEO | ☐ Pending |

> **Recommendation:** Complete this demo, collect answers to all 7 questions, and document them before any E5 code is written. The answers determine the workflow definition — building before the rules are confirmed risks rework.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Management wants auto-purchase on unavailable parts | Medium | High | Defer: E5 safety rules require human initiation first |
| Approval chain for shortage is different per department | Medium | High | Capture in Q7; build as configurable workflow steps, not hardcoded |
| Store Keeper re-confirmation loop increases cycle time | Medium | Medium | Show the business value: prevents assigning jobs with known shortages |
| Flag is disabled by mistake in production | Low | High | Add confirmation dialog to settings; IT Admin only permission for this flag |
| Technician starts job before parts arrive | Medium | Medium | E5 "Waiting for Parts" status blocks technician start; not yet active |

---

## Presenter Notes

- **Keep the demo under 20 minutes.** Steps 1–2 are context (1 min each). Steps 3–7 are live (3–4 min each). Questions: 10 min.
- **Do not show passwords** during screen share. Login before the demo starts for each role.
- **Disable screen sharing during login.** Resume after the dashboard is loaded.
- **Prepare a second browser tab** per role so switching is instant.
- **If the notification does not appear immediately** after Store Keeper confirms the last part, refresh the tab — the notification poll interval may delay it by up to 45 seconds.
- **If WO is already Assigned** (from a prior run), the inventory check queue will be empty. Re-run `node demo-setup.cjs` in the project directory to reset the demo data cleanly.

---

*Document prepared: Phase 5-E — Demo Data Ready*  
*No code changes in this document. No E5 implementation included.*
