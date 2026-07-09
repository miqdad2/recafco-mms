# CEO Asset & Parts Risk Page

## Overview

The CEO / Management role sees a **single combined executive risk view** at `/assets`. This page merges:

- Critical assets (Breakdown, Out of Service, Waiting for Parts)
- At-risk spare parts (Low Stock, Unavailable, Discontinued)
- Purchase delays blocking operations

The separate "Spare Parts" page (`/store/parts`) redirects CEO to `/assets`.

For the full business model distinction between assets and spare parts, see `docs/ASSETS_AND_SPARE_PARTS_MODEL.md`.

---

## Page Identity

| Field | Value |
|---|---|
| Route | `/assets` |
| Title | Asset & Parts Risk |
| Subtitle | Critical assets, repeated breakdowns, critical stock shortages, and operations blocked by missing parts. |

---

## What CEO Sees

### Asset Risk KPIs (row 1)

| Card | Source | Tone |
|---|---|---|
| Critical Assets at Risk | status IN (Breakdown, Out of Service) | Red |
| Repeated Breakdowns | assets with 2+ breakdown-type work orders | Red |
| Assets Waiting Parts | status = Waiting for Parts | Amber |

### Parts & Supply Risk KPIs (row 2)

| Card | Source | Tone |
|---|---|---|
| Critical Low Stock | current_stock ≤ minimum_stock | Amber |
| Unavailable Parts | status IN (Unavailable, Discontinued) | Red |
| Purchase Delays | work_orders with status = Waiting for Purchase | Amber |

### Combined Risk Table

Merges up to 20 at-risk assets and 15 at-risk parts. Sorted by severity: red → amber → blue → gray.

| Column | Source |
|---|---|
| Type | "Asset" (blue badge) or "Part" (purple badge) |
| Item | code + name + category |
| Risk Reason | See risk reason logic |
| Department / Location | departments.name or location (assets only; parts show "—") |
| Responsible Stage | Asset status or "Purchase / Procurement" / "Store Keeper / Purchase" |
| Action | "View Details" → asset detail page or parts inventory page |

---

## What CEO Does NOT See

- Full asset register (all active/inactive assets)
- Normal operational asset list
- Spare parts operational inventory (full list, pricing, supplier, bin)
- "+ New asset" or "+ New part" buttons
- Asset edit, delete, or category management
- Part edit, stock adjustment, inventory movement controls
- Service due or preventive maintenance schedule (not in combined view)

---

## Risk Reason Logic

**Assets** — evaluated in priority order:
1. Breakdown — status = Breakdown
2. Out of service — status = Out of Service
3. Waiting for parts — status = Waiting for Parts
4. Under maintenance — status = Under Maintenance
5. Service overdue — next_service_date < today
6. Service due soon — next_service_date ≤ 30 days
7. High-priority open work — open High/Urgent work orders linked to asset
8. Executive visibility — fallback

**Parts** — simple two-level:
- status IN (Unavailable, Discontinued) → "Unavailable" (red)
- current_stock ≤ minimum_stock → "Low Stock" (amber)

---

## Actions CEO Can Take

| Action | Where |
|---|---|
| View asset details (read-only) | `/assets/[id]` |
| View blocked work orders | `/maintenance/work-orders?ceo_tab=blocked` |
| View CEO approval queue | `/ceo/approvals` |

---

## Actions Reserved for Other Roles

| Action | Who can do it |
|---|---|
| Create asset | Super Admin, IT Admin, Maintenance Manager (`assets.manage`) |
| Edit asset | Super Admin, IT Admin, Maintenance Manager (`assets.manage`) |
| Create spare part | Super Admin, IT Admin, Store Keeper (`parts.manage`) |
| Edit spare part | Super Admin, IT Admin, Store Keeper (`parts.manage`) |
| Issue parts | Store Keeper (`store.issue`) |
| Inventory movements | Store Keeper (`store.issue`, `inventory.movements.view`) |

---

## Backend Protection

| Route | Required Permission | CEO Result |
|---|---|---|
| `/assets/new` | `assets.manage` | Access denied |
| `/assets/[id]/edit` | `assets.manage` | Access denied |
| `/store/parts` | `parts.view` | Redirected to `/assets` |
| `/store/parts/new` | `parts.manage` | Access denied |

The redirect from `/store/parts` is implemented as a server-side early return using `redirect("/assets")` from `next/navigation`. This fires before any data is fetched.

---

## CEO Sidebar Navigation

The CEO sidebar shows a single executive item (not two separate labels):

| Label | Route |
|---|---|
| Asset & Parts Risk | `/assets` |

There is no separate "Spare Parts Risk" or "Spare Parts" label in the CEO sidebar.

---

## How to Test

### As CEO

1. Log in as a user with role `ceo_management`
2. Check sidebar — should show "Asset & Parts Risk" (not two separate items)
3. Navigate to `/assets`:
   - Title: "Asset & Parts Risk"
   - Two KPI rows: "Asset Risk" and "Parts & Supply Risk" (3 cards each)
   - Combined risk table with "Type" column (Asset / Part badges)
   - No "+ New asset" button
4. Navigate to `/store/parts` — should redirect to `/assets`
5. Navigate to `/assets/new` — should get access denied
6. Navigate to `/store/parts/new` — should get access denied
7. Click "View Details" on an Asset row — goes to `/assets/[id]`
8. Click "View blocked work orders" footer link — goes to work orders blocked view

### As Maintenance Manager

1. Sidebar shows "Assets & Inventory" group with: Asset Register, Spare Parts Stock, Parts Requests
2. Click "Asset Register" → full operational `/assets` page (no CEO redirect)
3. Click "Spare Parts Stock" → full inventory page (no CEO redirect)

### As Super Admin / IT Admin

1. Sidebar shows "Assets" and "Spare Parts" labels
2. No CEO filtering or grouping applied
3. Both pages show full operational views with create/edit buttons (if permitted)
