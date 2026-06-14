# Assets and Spare Parts — Business Model and Navigation Guide

## The Core Distinction

| Concept | Definition | Examples | Managed By |
|---|---|---|---|
| **Asset** | Long-term physical equipment tracked for maintenance lifecycle, service history, registration, and cost | Crane, Forklift, Generator, Company Car, Factory Machine | Maintenance Manager, IT Admin, Super Admin |
| **Spare Part** | Consumable inventory item issued to maintenance jobs when needed | Engine Oil Filter, Hydraulic Hose, Brake Pad, Battery, Bearing | Store Keeper, IT Admin, Super Admin |

Assets are **registered once and tracked over years**. Spare parts are **stocked and consumed**.

---

## Navigation Labels by Role

### CEO / Management

The CEO sees a **single combined executive risk view** at `/assets`.

| Sidebar Label | Route | What it shows |
|---|---|---|
| Asset & Parts Risk | `/assets` | Combined: critical assets + critical stock shortages + purchase delays |

The CEO does NOT see separate "Assets" and "Spare Parts" operational labels. Everything critical is surfaced in one executive view.

Navigating to `/store/parts` as CEO automatically redirects to `/assets` (the combined view).

---

### Maintenance Manager

The Maintenance Manager sees a structured **Assets & Inventory** group, distinguishing between the equipment register and spare parts stock.

| Group | Sidebar Label | Route | Purpose |
|---|---|---|---|
| Maintenance | Work Orders | `/maintenance/work-orders` | All work orders |
| Maintenance | Approvals | `/maintenance/approvals` | Approve / reject work |
| Maintenance | Assignments | `/maintenance/assignments` | Assign technicians |
| Assets & Inventory | Asset Register | `/assets` | Full equipment master |
| Assets & Inventory | Spare Parts Stock | `/store/parts` | Inventory levels and health |
| Assets & Inventory | Parts Requests | `/store/parts-requests` | Requests linked to work orders |
| Operations | Purchase | `/purchase/requests` | Purchase workflow |
| Operations | Reports | `/reports/work-orders` | Maintenance reports |
| Operations | Notifications | `/notifications` | Inbox |

The group label **"Assets & Inventory"** reinforces that these are operationally related but conceptually different: equipment vs. stock.

---

### Store Keeper

The Store Keeper sees a **Stock Management** group with stock-focused labels. Their primary responsibility is inventory health and issuing parts.

| Group | Sidebar Label | Route | Purpose |
|---|---|---|---|
| — | Dashboard | `/dashboard` | Overview |
| Stock Management | Spare Parts Stock | `/store/parts` | Full inventory list with stock levels |
| Stock Management | Parts Requests | `/store/parts-requests` | Requests from maintenance to issue parts |
| Stock Management | Stock Movements | `/store/inventory-movements` | Issue history and stock changes |
| Stock Management | Low Stock Alert | `/store/parts?status=Low+Stock` | Quick filter to at-risk stock only |
| Operations | Notifications | `/notifications` | Inbox |

The label **"Spare Parts Stock"** (not "Spare Parts" or "Inventory") communicates that this is specifically about the stock of consumable maintenance materials.

---

### Super Admin / IT Admin

Super Admin and IT Admin see the full operational navigation without executive framing. Labels are direct:

- **Assets** → `/assets` (full asset register, all operational controls)
- **Spare Parts** → `/store/parts` (full inventory with part editing, supplier, bin)

No role-specific filtering or executive grouping is applied.

---

## CEO Combined Risk Page (`/assets`)

### Purpose

The `/assets` route for CEO is not an asset register. It is an **executive risk snapshot** combining:

1. Critical assets (Breakdown, Out of Service, Waiting Parts)
2. At-risk spare parts (Low Stock, Unavailable, Discontinued)

### KPI Cards (6 total, two rows)

**Asset Risk row:**

| Card | Source | Tone |
|---|---|---|
| Critical Assets at Risk | status IN (Breakdown, Out of Service) | Red |
| Repeated Breakdowns | assets with 2+ breakdown-type work orders | Red |
| Assets Waiting Parts | status = Waiting for Parts | Amber |

**Parts & Supply Risk row:**

| Card | Source | Tone |
|---|---|---|
| Critical Low Stock | current_stock ≤ minimum_stock | Amber |
| Unavailable Parts | status IN (Unavailable, Discontinued) | Red |
| Purchase Delays | work_orders with status = Waiting for Purchase | Amber |

### Combined Risk Table

The table merges up to 20 at-risk assets and 15 at-risk parts, sorted by severity (red → amber → blue → gray).

| Column | Source |
|---|---|
| Type | "Asset" (blue badge) or "Part" (purple badge) |
| Item | code + name + category |
| Risk Reason | See risk reason logic below |
| Department / Location | departments.name or location (assets only) |
| Responsible Stage | asset status or "Purchase / Procurement" / "Store Keeper / Purchase" |
| Action | "View Details" → asset detail page or parts page |

### Risk Reason Logic

**Assets** — evaluated in priority order:
1. Breakdown
2. Out of service
3. Waiting for parts
4. Under maintenance
5. Service overdue (next_service_date < today)
6. Service due soon (next_service_date ≤ 30 days)
7. High-priority open work (open High/Urgent work orders)
8. Executive visibility (fallback)

**Parts** — simple:
- status IN (Unavailable, Discontinued) → "Unavailable" (red)
- current_stock ≤ minimum_stock → "Low Stock" (amber)

---

## Backend Protection

| Route | Required Permission | CEO Access |
|---|---|---|
| `/assets/new` | `assets.manage` | Denied (no permission) |
| `/assets/[id]/edit` | `assets.manage` | Denied |
| `/store/parts/new` | `parts.manage` | Denied |
| `/store/parts` | `parts.view` | Redirected to `/assets` |

The CEO's inability to create or edit assets/parts is enforced server-side via `requirePermission()`. The UI button being hidden is secondary protection only.

---

## Testing Checklist

### As CEO

1. Navigate to `/assets` — should see "Asset & Parts Risk" title
2. Two KPI rows: "Asset Risk" (3 cards) and "Parts & Supply Risk" (3 cards)
3. Combined risk table with "Type" column (Asset / Part)
4. No "+ New asset" button
5. Navigate to `/store/parts` — should redirect to `/assets`
6. Sidebar shows "Asset & Parts Risk" as a single item (no separate "Spare Parts")
7. Navigate to `/assets/new` — access denied error

### As Maintenance Manager

1. Sidebar shows "Assets & Inventory" group with: Asset Register, Spare Parts Stock, Parts Requests
2. Click "Asset Register" → full operational assets page
3. Click "Spare Parts Stock" → full inventory page with stock levels
4. Click "Parts Requests" → parts request management page

### As Store Keeper

1. Sidebar shows "Stock Management" group with: Spare Parts Stock, Parts Requests, Stock Movements, Low Stock Alert
2. "Low Stock Alert" navigates to `/store/parts?status=Low+Stock`
3. Full inventory features available (issue, update, view movements)

### As Super Admin

1. Sidebar shows "Spare Parts" (not "Spare Parts Stock")
2. Full operational page with "+ New part" button
3. No role-specific grouping applied
