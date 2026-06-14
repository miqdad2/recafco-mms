# Cost Control Workflow

This document describes the cost control and financial approval workflow in the RECAFCO Maintenance Management System, covering the roles involved, their responsibilities, and when each stage is triggered.

---

## Overview

The cost control workflow is a multi-stage validation chain that ensures all maintenance-related expenditures are reviewed, validated, and approved by the appropriate authority before procurement takes place.

```
Work Order / Parts Need
       ↓
Purchase Officer (supplier quote, purchase process)
       ↓
Cost Controller / Accounting (cost validation, budget check)
       ↓
Finance Manager (payment approval, financial validation)
       ↓
CEO (if amount exceeds approval threshold — currently 1,000 KWD)
       ↓
Procurement proceeds
```

---

## Roles and Responsibilities

### 1. Maintenance Manager / Supervisor

**Stage:** Technical approval and work authorization.

**Responsibilities:**
- Approve or reject work orders based on maintenance necessity
- Authorize parts requests for technical reason
- Assign technicians and verify completed work
- Close work orders after verification

**Does NOT handle:**
- Cost validation
- Budget checking
- Supplier selection
- Payment approval

---

### 2. Store Keeper

**Stage:** Parts availability check and stock issue.

**Responsibilities:**
- Check stock availability for requested parts
- Issue available parts and reduce inventory
- Mark unavailable parts and trigger purchase request creation
- Record partial issues when only some items are available

---

### 3. Purchase Officer

**Stage:** Supplier-side procurement process.

**Responsibilities:**
- Receive purchase requests for unavailable parts
- Contact suppliers and obtain quotations
- Attach quotation documents
- Update purchase status (ordered, received)
- Record supplier details and delivery notes
- Attach invoices and delivery documentation

**Does NOT handle:**
- Internal cost validation
- Budget approval
- Financial authorization

**Note:** The Purchase Officer provides the supplier's cost information (quotation). The internal cost validation is done by the Cost Controller.

---

### 4. Cost Controller

**Stage:** Internal cost validation before Finance approval.

**Responsibilities:**
- Review estimated cost for reasonableness
- Check budget availability for the relevant cost center
- Identify duplicate purchase requests
- Flag unusual or inflated cost items
- Verify cost center allocation is correct
- Review and compare against historical costs
- Forward validated requests to Finance
- Flag requests for CEO escalation if above policy limits

**Permissions required:**
- `cost.review` — Review and validate cost items
- `cost.approve` — Approve or flag cost items after review
- `cost.reports.view` — View cost controller reports
- `budget.check` — Check budget availability
- `costs.view` — View sensitive cost data
- `purchase_requests.view` — View purchase requests
- `finance.reports.view` — Access finance reports

**Does NOT handle:**
- Payment processing
- Bank/accounting journal entries
- Supplier payment confirmation

**Workflow note:** The cost review step (dedicated "Pending Cost Review" status in purchase requests) is a planned enhancement. In the current version, Cost Controllers access active purchase requests directly through `/purchase/requests` and review them before Finance approval.

---

### 5. Accounting Reviewer

**Stage:** Accounting department cross-check (parallel or sequential with Cost Controller).

**Responsibilities:**
- Review cost entries against accounting standards
- Validate cost center and account codes
- Check for compliance with company financial policies
- Prepare cost reports for management
- Support Cost Controller with historical cost data

**Permissions required:**
- `cost.review`
- `cost.reports.view`
- `budget.check`
- `costs.view`
- `purchase_requests.view`
- `finance.reports.view`

---

### 6. Finance Manager

**Stage:** Financial payment authorization.

**Responsibilities:**
- Review purchase requests that have passed cost review
- Provide final financial validation before payment
- Approve or reject based on financial policy
- Add finance comments
- Coordinate with Cost Controller and Accounting on cost queries
- View cost reports and export finance reports

**Permissions required:**
- `finance.approve`
- `finance.reports.view`
- `costs.view`
- `purchase_requests.view`

**Note:** Finance Manager confirms payment authorization. The detailed cost correctness check is handled by Cost Controller / Accounting before this stage.

---

### 7. CEO / Management

**Stage:** Final executive approval for high-value items only.

**Responsibilities:**
- Approve or reject purchase requests above the configured threshold (default: 1,000 KWD)
- Review cost exposure at executive level (summary only)
- Make final procurement decisions for high-value items

**CEO does NOT:**
- Perform daily cost checking
- Review individual quotations for reasonableness
- Validate accounting entries or cost centers
- Review routine operational purchases below the threshold

**What CEO sees:**
- High-value approvals (above CEO approval threshold)
- Escalated cost items needing executive decision
- Summarized cost exposure (recorded maintenance cost, pending purchase value)
- Critical operational risk affecting business continuity
- Department-level performance summaries

**Permissions required:**
- `ceo.approve`
- `costs.view`
- `finance.reports.view`

---

## Approval Limits (Concept)

The system uses a configurable CEO approval threshold (default: 1,000 KWD). This means:

| Amount | Approval path |
|--------|--------------|
| Below threshold | Cost Controller → Finance Manager |
| At or above threshold | Cost Controller → Finance Manager → CEO |

The threshold is configurable in **Admin → Settings → CEO Approval Threshold**.

Future enhancement: additional intermediate limits can be configured (e.g., department manager limit, supervisor limit) to create a tiered approval chain.

---

## Purchase Request Status Flow

Current workflow statuses for purchase requests:

```
Draft
  → Submitted
    → Pending Purchase         (Purchase Officer working on it)
      → Pending Finance Approval  (Cost Controller validated — Finance pending)
        → Pending CEO Approval    (Finance approved — CEO decision required)
          → Approved
            → Ordered
              → Received
```

**Planned enhancement — Cost Review step:**

```
Draft → Submitted → Pending Purchase
  → Pending Cost Review        ← NEW (Cost Controller validates)
    → Pending Finance Approval
      → Pending CEO Approval
        → Approved → Ordered → Received
```

The "Pending Cost Review" status is planned for a future release when the cost review workflow is fully activated.

---

## Permissions Reference

### New permissions added for Cost Control

| Permission key | Description | Granted to |
|---|---|---|
| `cost.review` | Review and validate cost items before finance approval | Cost Controller, Accounting Reviewer |
| `cost.approve` | Approve or flag cost items after review | Cost Controller |
| `cost.reports.view` | View cost controller reports and cost summaries | Cost Controller, Accounting Reviewer |
| `budget.check` | Check budget availability and cost center allocation | Cost Controller, Accounting Reviewer |
| `cost_center.manage` | Manage cost centers and budget allocations | Cost Controller (future) |

### Existing permissions used in cost workflow

| Permission key | Used by |
|---|---|
| `costs.view` | CEO, Finance Manager, Cost Controller, Accounting Reviewer |
| `finance.reports.view` | Finance Manager, Cost Controller, Accounting Reviewer |
| `finance.approve` | Finance Manager |
| `ceo.approve` | CEO / Management |
| `purchase_requests.view` | Purchase Officer, Finance Manager, Cost Controller, Accounting Reviewer |

---

## CEO Dashboard — Cost Wording

The CEO dashboard shows **executive-level cost summaries**, not detailed accounting data.

| Label used | Meaning |
|---|---|
| "Recorded Cost Exposure This Month" | Sum of recorded `total_work_order_cost` for non-cancelled WOs updated this month |
| "Pending Purchase Value" | Sum of `estimated_total` for all active purchase requests in workflow |
| "Pending Executive Cost Decision" | Sum of `estimated_total` for purchase requests in "Pending CEO Approval" status |
| "Executive cost summary" | Section label — clarifies this is a summary, not an accounting ledger |

**Note:** The label "Maintenance Spend This Month" was deliberately replaced with "Recorded Cost Exposure This Month" to clarify that:
1. The figure is recorded cost only — unrecorded estimates are not included
2. The CEO is not doing cost validation — that happens at the Cost Controller / Accounting level
3. The CEO is reviewing cost exposure as an executive decision-maker, not as a daily cost checker

---

## Future Enhancements

1. **Cost Review Status** — Add "Pending Cost Review" status to purchase request workflow
2. **Cost Review Action** — Allow Cost Controller to record review decision with comment
3. **Budget Integration** — Link cost centers to budget limits and warn when exceeded
4. **Cost Center Assignment** — Allow work orders and purchase requests to have cost center fields
5. **Approval Tiers** — Configurable multi-level approval limits (supervisor / manager / finance / CEO)
6. **Cost Alerts** — Notify Cost Controller when high-value items are submitted
7. **Accounting Journal** — Optional integration with accounting system for journal entry validation
