# Inventory Shortage Path — Phase 5-E5 Planning Document

**Status:** Planning / Not yet implemented  
**Phase:** 5-E5 (future)  
**Last updated:** Phase 5-E4-E

---

## 1. Purpose

This document defines the planned E5 shortage workflow for required parts marked **partial** or **unavailable** during Store Keeper inventory check.

Phase 5-E4 delivered the inventory check queue, the assignment gate, and the ready-for-assignment notification. E4 deliberately does **not** automate any shortage handling — Store Keeper has evaluated the parts, but no purchase or request chain is triggered automatically.

This document captures all decisions, data mappings, safety rules, and the proposed implementation split for when E5 is activated.

---

## 2. Current Completed Behavior (E3 + E4)

The following is fully implemented and committed as of Phase 5-E4-D:

- **Data Entry** can list required parts on the work order form when creating or editing a work order.
- Required parts are stored in `work_order_required_parts` with fields: `description`, `part_number`, `quantity_required`, `unit_of_measure`, `availability_status` (default `"unchecked"`), `confirmed_by`, `confirmed_at`, `notes`.
- **Store Keeper** can confirm each required part as `available`, `partial`, or `unavailable` via the Inventory Check queue (`/store/inventory-check`).
- The inventory check queue is guarded by the `inventory_check_enabled` feature flag (`app_settings`). When the flag is `false`, the page shows a disabled card and the service throws before any DB write.
- **Assignment is blocked** on the first assignment (`Approved → Assigned`) only while any required part still has `availability_status = "unchecked"`. Both the UI (disabled button + amber warning) and the backend service (`assignTechnicians`) enforce this.
- Once all required parts are confirmed (regardless of whether they are `available`, `partial`, or `unavailable`), assignment can proceed.
- When the last `"unchecked"` part is confirmed, a `work_order.inventory_check_completed` notification is sent to Maintenance Manager, Maintenance Supervisor, and the assigned supervisor (if set).
- Re-assignment of already-`Assigned` work orders is never blocked by the inventory gate.
- Work orders with no `work_order_required_parts` rows always pass the gate (backward compatibility).
- **No stock is deducted** during inventory check.
- **No `inventory_movements` row is created** during inventory check.
- **No parts request is automatically created** during inventory check.
- `work_orders.status` is not changed by the inventory check process.

---

## 3. Why Partial / Unavailable Does Not Block Assignment in E4

E4 enforces that Store Keeper has **evaluated** all required parts — not that all parts are in stock.

Blocking assignment on `partial` or `unavailable` parts in E4 would require a manager override or shortage approval flow that does not yet exist. Introducing that block without the resolution path would halt daily maintenance work with no escape route.

The shortage decision — whether to proceed with available materials, request missing parts, or pause the work order — belongs to the Maintenance Manager or Supervisor. That decision workflow is the scope of E5.

`partial` and `unavailable` mean the shortage is **known and recorded**, not **ignored**. The assignment page shows informational labels when the flag is on:

- Green "Inventory check complete — ready for assignment" when all parts are confirmed.
- An additional amber note when some parts are `partial` or `unavailable`, alerting the supervisor that shortage handling will need to be addressed separately.

---

## 4. Future E5 Target Flow

The following is the intended shortage path when E5 is implemented:

1. Store Keeper confirms a required part as `partial` or `unavailable` on the Inventory Check page.
2. System displays shortage state to Maintenance Manager and Supervisor (via notification and shortage labels on work order detail and assignment pages).
3. **Maintenance Manager or Supervisor decides** whether to:
   a. Proceed with available materials (no parts request needed),
   b. Request the missing parts (triggers a human-initiated parts request), or
   c. Pause the work order as `"Waiting for Parts"` until the shortage is resolved.
4. If missing parts are required, the system creates or **drafts** a parts request linked to the work order — initiated by a human action, never automatically.
5. The parts request goes through the normal approval chain before any purchase activity begins.
6. The purchase/approval chain should follow (subject to company policy and configurable workflow definition):

   ```
   Store Keeper confirms shortage
         ↓
   Maintenance Manager / Supervisor decision
         ↓
   Parts Request created (human-initiated)
         ↓
   Maintenance Manager approves parts request
         ↓
   Store checks stock (again, after potential restocking)
         ↓
   If still unavailable → Purchase Request created
         ↓
   Purchase Officer / Manager → Finance Manager → CEO (if above threshold)
         ↓
   Purchase Officer creates PO and orders parts
         ↓
   Parts received → Stock updated → inventory_movements created
         ↓
   Store Keeper re-confirms required part availability
         ↓
   Assignment gate passes → Technician assigned
   ```

7. The exact approval path must be **workflow-definition driven** (via `workflow_definitions` / `workflow_steps` tables), not hardcoded in service files.

---

## 5. Data Mapping Proposal

| Table | Role |
|---|---|
| `work_order_required_parts` | Planned/required parts listed at work order creation. Store Keeper confirms availability status here. This is the **source of truth for the inventory check**. |
| `parts_requests` | Operational store/request flow for parts needed by a work order. Created by human action in the shortage path. |
| `parts_request_items` | Item-level shortage/request details within a parts request. |
| `purchase_requests` | Current purchase approval flow (Purchase Officer → Finance → CEO). Triggered when parts are unavailable after store check. |
| `purchase_request_items` | Item-level purchase requirements within a purchase request. |
| `purchase_orders` / `purchase_order_items` | Formal PO layer — currently schema-only. **Not to be activated until the current `purchase_requests` flow is fully mapped and stable.** |
| `inventory_movements` | Actual stock issue/receive log only. Created when physical stock moves in or out. Never created during inventory check phase. |
| `work_order_materials` | Actual/planned material usage currently used by the existing issue flow. Not the source of required-parts inventory check — `work_order_required_parts` is separate. |

**Important:** `work_order_required_parts` and `work_order_materials` serve different purposes:
- `work_order_required_parts` = pre-job planning / Store Keeper pre-check
- `work_order_materials` = actual usage recorded during/after job execution (via store issue or technician update)

---

## 6. Proposed E5 Implementation Split

| Sub-phase | Scope |
|---|---|
| **E5-A** | Shortage path preflight audit — read-only inspection of current schema, service boundaries, parts request flow, and existing purchase chain before writing any code. |
| **E5-B** | Read-only shortage labels on work order detail and assignment pages — show which required parts are `partial`/`unavailable` without adding any actions. |
| **E5-C** | Store Keeper or Maintenance Manager can create a **draft** parts request from `partial`/`unavailable` required parts — human-initiated, single action, no automatic creation. |
| **E5-D** | Link `work_order_required_parts` rows to `parts_request_items` rows if schema supports a direct FK, or via a joining approach; migration only if risk is low. |
| **E5-E** | Feature-flagged `"Waiting for Parts"` status transition on the work order after human decision — must use existing `status-rules.ts` and backend workflow service. |
| **E5-F** | Purchase chain mapping — document and implement the manager approval steps (Production Manager → Factory Manager → Purchase Manager → Finance → CEO) as workflow steps; must be workflow-definition driven. |
| **E5-G** | Receive parts flow — link PO receipt to stock update, `inventory_movements` creation, and required part re-confirmation. |
| **E5-H** | Assignment readiness after shortage resolved — re-check inventory gate or provide human "shortage resolved" confirmation that unblocks assignment. |

Each sub-phase requires its own preflight audit before implementation begins.

---

## 7. E5 Safety Rules

The following safety rules must be enforced throughout all E5 sub-phases:

- **No automatic purchase request** without explicit human review and action.
- **No frontend-controlled status transitions** — all `work_orders.status` changes must go through the backend workflow service (`lib/backend/work-orders/service.ts`) with `canTransition` checks.
- **No stock deduction** until Store Keeper physically issues parts via the store issue flow.
- **No `inventory_movements` row** until a real stock issue or receive event occurs.
- **No `work_orders.status` change** except through the backend workflow service. The inventory check confirmation must not change work order status directly.
- **Every shortage decision must be audited** via `writeAuditLog` with a clear `action` key and `metadata`.
- **Old work orders** (those without `work_order_required_parts` rows) must remain backward compatible and fully operational throughout E5.
- **`inventory_check_enabled` feature flag** must remain the master rollback switch. Disabling it must instantly restore the pre-E3 assignment flow with no migration rollback required.
- **E5 shortage automation should have its own separate feature flag** — the inventory check flag controls the check queue and assignment gate; a separate flag should control any automatic shortage action.
- **`purchase_orders` / `purchase_order_items` tables must not be activated** until the existing `purchase_requests` flow is stable, mapped, and the business process is validated.
- **No NestJS**, no external microservices, no queue workers introduced as part of E5.

---

## 8. Future Test Plan

The following cases must be covered before any E5 sub-phase ships:

| Test case | Expected behavior |
|---|---|
| Work order with all required parts `available` | No shortage label, assignment proceeds normally |
| Work order with one `unchecked` required part | Assignment blocked, amber warning shown |
| Work order with one `partial` required part (all others confirmed) | Assignment allowed, shortage note shown |
| Work order with one `unavailable` required part (all others confirmed) | Assignment allowed, shortage note shown |
| Old work order with no `work_order_required_parts` rows | No inventory gate applied, assignment proceeds normally |
| Shortage parts request created from required parts | Exactly one parts request created per shortage decision; duplicate prevention checked |
| Duplicate prevention on shortage request | Second "create shortage request" action does not create a second parts request for the same required parts |
| Receive purchased part and update availability | `inventory_movements` created, required part availability can be re-confirmed, assignment gate re-evaluated |
| Assignment after shortage resolved | Assignment succeeds once all required parts have been re-confirmed as `available` or confirmed at least once |
| Feature flag rollback (`inventory_check_enabled = false`) | Inventory check queue hidden, assignment gate bypassed, existing assigned work orders unaffected |
| Notification behavior | `work_order.inventory_check_completed` fires once when last unchecked part confirmed; no second notification on re-edits |

---

## 9. Rollback Strategy

- Setting `inventory_check_enabled = false` in **Admin → Settings** disables:
  - The Inventory Check nav link (Store Keeper sidebar)
  - The Inventory Check queue page (shows disabled card)
  - The `confirmRequiredPartAvailability` service (throws `WORKFLOW_ERROR` before any DB write)
  - The assignment gate in `assignTechnicians` (gate is skipped entirely)
  - No migration rollback is required.

- E5 shortage automation must have its **own separate feature flag** so that:
  - The inventory check queue can remain active without enabling automatic shortage actions.
  - Either flag can be toggled independently.

- **Rollback must not require migration rollback** to restore assignment flow. All E4/E5 tables are additive (`work_order_required_parts` is new); disabling the feature flags restores pre-E3 behavior without dropping columns or tables.

- **Old work orders remain fully assignable** regardless of flag state, because the assignment gate exits immediately when no `work_order_required_parts` rows exist.

---

## 10. Current Non-Goals (E4-E)

Phase 5-E4-E is documentation only. The following are **explicitly not implemented** in this phase or any prior E4 phase:

- Parts request creation from shortage
- Purchase request creation
- Purchase order (PO) creation
- Stock issue / stock deduction
- Stock receive / restocking flow
- `"Waiting for Parts"` status transition
- Manager override for blocked assignment
- Assignment gate changes beyond what E4-B/C shipped
- Any new schema columns or migrations
- Any NestJS or background worker infrastructure
