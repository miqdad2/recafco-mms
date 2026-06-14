# AGENTS.md

## Project Name

**RECAFCO Enterprise Maintenance Management System**

## Project Type

Enterprise internal web application for maintenance, assets, work orders, spare parts, approvals, purchase coordination, finance approval, reporting, dashboards, notifications, audit logs, and management monitoring.

This project is **not** a requirement collection portal. It is the actual **Maintenance Management System prototype / first working version** for RECAFCO management review.

The system must be secure, scalable, fast, mobile-friendly, PWA-ready, and suitable for a large construction/manufacturing company with multiple departments.

---

# 1. Business Context

RECAFCO is a large construction/manufacturing company with multiple departments such as:

- Maintenance
- Store
- Purchase
- Finance
- HR
- IT
- Operations
- CEO / Management

The maintenance department currently uses paper-based forms for:

1. **Work Orders**
2. **Parts Requests**
3. Other maintenance-related forms that may be added later

The goal is to digitize and control the full maintenance workflow so the company can track:

- who created the work order
- who approved or rejected it
- which asset/equipment/vehicle is involved
- assigned supervisor
- assigned technician
- spare parts requested
- parts issued
- unavailable parts
- purchase requests
- finance approval
- CEO approval if required
- work completion
- supervisor verification
- final closure
- maintenance history
- next service details
- asset expiry dates
- costs
- reports
- audit trail

---

# 2. Main Product Goal

Build a working enterprise-grade Maintenance Management System with:

1. Login for all users
2. Role-based access control
3. Super Admin full control
4. Department management
5. User/profile management
6. Asset / vehicle / equipment master
7. Work order creation
8. Work order approval / rejection
9. Technician assignment
10. Technician mobile dashboard
11. Parts request linked to work order
12. Store issue workflow
13. Basic spare parts inventory
14. Purchase request workflow when parts are unavailable
15. Finance approval workflow
16. CEO approval threshold workflow
17. Maintenance history per asset
18. Next service / preventive maintenance tracking
19. PDF / print forms
20. Excel exports
21. Role-based dashboards
22. Dedicated in-app notification system
23. Audit logs
24. Private file uploads
25. PWA-ready mobile experience
26. Realistic RECAFCO-style demo data

This must be a real working application, not fake UI screens.

---

# 3. Tech Stack

Use the following stack:

- Framework: **Next.js latest stable App Router**
- Language: **TypeScript**
- Package manager: **npm**
- Styling: **Tailwind CSS**
- UI Components: **shadcn/ui** or clean reusable enterprise components
- Database: **Supabase PostgreSQL**
- Auth: **Supabase Auth**
- Storage: **Supabase Storage**
- Validation: **Zod**
- Forms: **React Hook Form**
- Tables: **TanStack Table** if useful
- Charts: **Recharts**
- PDF Export: **pdfmake**, **react-pdf**, or another stable server-side PDF library
- Excel Export: **exceljs** or **xlsx**
- PWA: **next-pwa** or equivalent
- Deployment Target for now: **Vercel**
- Future Hosting: should be portable enough to move to a company server or approved cloud later

Use **TypeScript strict mode**.

---

# 4. Branding and UI/UX Direction

## Brand Source

Use the uploaded RECAFCO logo as the visual inspiration.

The logo uses:

- strong red
- charcoal / black
- light gray background
- bold industrial typography
- structural / construction-inspired symbol

## Suggested Brand Colors

Use a professional enterprise color palette inspired by the logo:

```txt
Primary Red:        #ED1C24
Dark Charcoal:      #2B2B2B
Near Black:         #111827
Light Gray BG:      #F5F6F8
Border Gray:        #E5E7EB
Text Gray:          #4B5563
Success Green:      #16A34A
Warning Amber:      #F59E0B
Error Red:          #DC2626
Info Blue:          #2563EB
White:              #FFFFFF
```

## Color Psychology

Use colors intentionally:

- **Red**: urgency, action, critical alerts, pending approvals, high priority, maintenance urgency, brand identity
- **Charcoal / black**: authority, reliability, heavy industry, construction strength
- **Light gray / white**: clarity, cleanliness, enterprise simplicity, low visual fatigue for daily users
- **Green**: approved, completed, active, available stock
- **Amber**: waiting, pending, warning, low stock, due soon
- **Blue**: information, neutral workflow actions, links
- **Muted grays**: secondary information, borders, backgrounds

Do not overuse red. Use red as a strong accent for important actions and status, not as a full-page background.

## UI/UX Rules

1. The interface must look like a professional enterprise internal system.
2. Keep screens clean, modern, simple, and management-ready.
3. Make forms easy for non-technical staff.
4. Use clear labels and helper text.
5. Use status badges everywhere.
6. Use progress/timeline views for work order lifecycle.
7. Use dashboard cards for KPIs.
8. Use tables with filters, search, sorting, and pagination.
9. Use mobile-first layouts for technicians and managers.
10. Avoid unnecessary animations.
11. Use enough whitespace.
12. Use clear hierarchy: page title, status, key details, actions, history.
13. Do not make the UI look like a generic SaaS template.
14. Add a subtle industrial/corporate feel using strong typography, clean grids, and RECAFCO colors.
15. All important actions must have confirmation dialogs.
16. Destructive actions must be clearly separated and confirmed.
17. Forms must support draft saving where useful.
18. Error messages must be clear and human-readable.
19. The system should work well on desktop, tablet, and mobile.
20. Mobile technician pages must have large tap targets and quick actions.

## Layout Rules

Admin/Desktop layout:

- Left sidebar
- Top bar with user info and logout
- Breadcrumbs
- Page header
- Primary action button
- Dashboard cards
- Data tables
- Filters

Mobile layout:

- Bottom navigation or simplified menu
- Large tap targets
- Single-column forms
- Sticky primary action where useful
- Technician dashboard optimized for quick job actions

---

# 5. User Roles

Create and enforce these roles:

1. Super Admin
2. IT Admin
3. CEO / Management
4. Maintenance Manager
5. Maintenance Supervisor
6. Maintenance Data Entry
7. Technician / Mechanic
8. Store Keeper
9. Purchase Officer
10. Finance Manager
11. Department Requester
12. Viewer / Auditor

All users must login.

No public secure respondent links are required for this project.

---

# 6. Role Permissions

## Super Admin

Has full access to the entire system.

Can:

- Manage all users
- Manage all roles and permissions
- Manage departments
- Manage assets
- Manage work orders
- Manage spare parts
- Manage inventory
- Manage parts requests
- Manage purchase requests
- Manage finance approvals
- View all dashboards
- View all reports
- View all costs
- View audit logs
- Change system settings
- Monitor the full system

Super Admin is the highest authority in the system.

## IT Admin

Can:

- Manage users
- Manage departments
- Manage roles if permitted
- Manage system settings
- View audit logs
- View system-wide dashboard
- Support password/account issues

Cannot approve maintenance or finance transactions unless explicitly granted.

## CEO / Management

Can:

- View all dashboards
- View all departments
- View all work orders
- View cost reports
- View asset downtime
- View pending high-level approvals
- Approve high-value purchase/maintenance requests if enabled

## Maintenance Manager

Can:

- View all maintenance work orders
- Approve/reject work orders
- Approve/reject parts requests
- View costs if permission allows
- Close work orders
- View maintenance reports
- View asset history

## Maintenance Supervisor

Can:

- View approved work orders
- Assign technicians
- Verify completed jobs
- Request parts
- Update work order status
- View technician workload

## Maintenance Data Entry

Can:

- Create work orders
- Enter paper-form data
- Attach documents/photos
- View work orders created by maintenance
- Save drafts
- Submit work orders

Cannot approve unless specific permission is granted.

## Technician / Mechanic

Can:

- View assigned jobs only
- Start assigned job
- Add job notes
- Add labor hours
- Upload before/after photos
- Request parts
- Mark job completed

Cannot view unrelated jobs or sensitive costs unless permitted.

## Store Keeper

Can:

- View approved parts requests
- Check stock
- Issue parts
- Partially issue parts
- Mark parts unavailable
- Update stock issue records
- View inventory movements

## Purchase Officer

Can:

- View purchase requests
- Update purchase workflow
- Add supplier details
- Attach quotations
- Attach invoices
- Attach delivery notes
- Update purchase status

## Finance Manager

Can:

- View cost-related requests
- Approve/reject finance approvals
- Add finance comments
- View cost reports
- Export finance reports

## Department Requester

Can:

- View own department work orders
- Submit maintenance request if enabled later
- Track request status
- Confirm job completion if required

## Viewer / Auditor

Can:

- Read-only access to permitted reports
- View audit trails if permitted

---

# 7. Security Rules

1. Enforce permissions server-side, not only through frontend UI hiding.
2. Use Supabase Row Level Security where possible.
3. Do not expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
4. Use private Supabase Storage buckets.
5. Use signed URLs for private attachments.
6. Validate all input using Zod.
7. All admin and business routes must be protected.
8. All users must have active/inactive status.
9. Inactive users cannot login or access protected features.
10. Sensitive cost fields must be permission-protected.
11. Technicians should only see assigned jobs.
12. Department requesters should only see their department data.
13. Audit important actions.
14. Prefer soft delete/deactivation over hard delete.
15. Do not hardcode secrets or real credentials.
16. Password reset should be supported if possible through Supabase Auth.
17. The application must be safe for internal company use.
18. Notification metadata must not expose sensitive cost data to users without cost visibility.
19. Notification failures must not block the main business workflow.

---

# 8. Recommended Workflow

Use this default workflow for the prototype:

1. Maintenance Data Entry creates a work order.
2. Work order goes to Maintenance Manager for approval.
3. Maintenance Manager approves or rejects.
4. If approved, Maintenance Supervisor assigns technician.
5. Technician sees assigned job in mobile dashboard.
6. Technician starts the job.
7. Technician can request parts if needed.
8. Parts request goes to Maintenance Manager for approval.
9. Store Keeper checks availability.
10. If parts are available, Store Keeper issues parts and stock reduces.
11. If parts are not available, system creates/allows purchase request.
12. Purchase Officer updates purchase status.
13. Finance Manager approves purchase/cost if required.
14. CEO approval is required only if amount exceeds configured threshold.
15. Technician completes work with notes, labor hours, material usage, and photos.
16. Supervisor verifies completion.
17. Requester/operator confirmation can be recorded if applicable.
18. Maintenance Manager closes the work order.
19. Asset maintenance history is updated.
20. Next service date/km/running hours can be recorded.

Emergency work type should exist, but for this prototype keep it inside the same approval workflow unless configured otherwise.

---

# 9. Work Order Requirements

The digital work order must include all important fields from the current paper form.

Fields:

- Work order number
- Company/reference format
- Ordered by
- Requested by department
- Machine / asset
- Asset category
- Serial number
- Plate number if vehicle
- Date of order
- Job location
- Starting date/time
- Ending date/time
- Maintenance type
- Worker type
- Running hours
- Kilometers
- Operator complaint
- Description of work
- Priority
- Status
- Assigned supervisor
- Assigned technician(s)
- Labor entries
- Material used entries
- Total labor cost
- Total material cost
- Total work order cost
- Operator/requester confirmation
- Supervisor verification
- Maintenance manager closure
- Next service date
- Next service kilometer
- Next service running hours
- Attachments/photos
- Notes

## Maintenance Types

- Routine
- Service
- Breakdown
- Preventive
- Inspection
- Emergency
- Other

## Worker Types

- Auto
- Mechanical
- Electrical
- Civil
- AC
- Plumbing
- Welding/Fabrication
- Other

## Priority

- Low
- Normal
- High
- Urgent

## Labor Entry Fields

- employee/technician
- labor name
- employee number
- hours
- rate
- amount

## Material Used Fields

- material/part
- part number
- SS rec code
- quantity
- unit price
- amount

## Auto Numbering

Work order numbers must be generated automatically.

Support configurable company-style numbering such as:

```txt
AUTO-MAINTENANCE-2495
REC/MD/ELEC/JOB/0001
REC/MD/MECH/JOB/0001
REC/MD/AUTO/JOB/0001
REC/MD/CIVIL/JOB/0001
```

The code should allow future adjustment of numbering patterns.

---

# 10. Work Order Statuses

Use these statuses:

- Draft
- Submitted
- Pending Approval
- Approved
- Rejected
- Assigned
- In Progress
- Waiting for Parts
- Waiting for Purchase
- Parts Issued
- Completed by Technician
- Verified by Supervisor
- Confirmed by Requester
- Closed
- Cancelled
- Reopened

Status changes must be tracked in history.

---

# 11. Parts Request Requirements

Parts request must be linked to a work order.

Fields:

- Parts request number
- Department
- Work order number
- Related asset/equipment
- Remarks / equipment name
- Date
- Time
- Serial number
- Requested by
- Prepared by
- Approved by
- Status
- Item rows
- Total price summary
- Approval comments
- Store issue comments
- Attachments

Item row fields:

- Description
- Part number
- SS rec code
- Quantity
- Unit price
- Total price
- Remarks
- Stock availability
- Issued quantity

Allow:

- multiple items
- partial issue
- unavailable item marking
- purchase request creation from unavailable items

---

# 12. Parts Request Statuses

Use:

- Draft
- Submitted
- Pending Approval
- Approved
- Rejected
- Waiting for Store
- Partially Issued
- Issued
- Waiting for Purchase
- Closed
- Cancelled

---

# 13. Asset Master Requirements

Create full asset/equipment/vehicle master.

Asset categories:

- Vehicle
- Bus
- Car
- Truck
- Crane
- Forklift
- Generator
- Factory Machine
- Electrical Equipment
- Building/Facility
- Other

Asset fields:

- Asset code
- Asset name
- Category
- Department
- Location
- Brand
- Model
- Serial number
- Plate number
- Chassis number
- Engine number
- Purchase date
- Warranty expiry date
- Registration expiry date
- Insurance expiry date
- Current kilometer reading
- Current running hours
- Assigned operator/driver
- Status
- Next service date
- Next service kilometer
- Next service running hours
- Notes
- Attachments/photos

Asset statuses:

- Active
- In Use
- Under Maintenance
- Breakdown
- Waiting for Parts
- Out of Service
- Retired

Each asset detail page must show:

- maintenance history
- related work orders
- parts used
- cost history
- next service information
- expiry alerts

---

# 14. Spare Parts Inventory

Include basic inventory.

Part fields:

- Part code
- Part name
- Description
- Category
- Part number
- SS rec code
- Unit of measure
- Current stock
- Minimum stock
- Unit price
- Supplier
- Store location/bin
- Compatible asset categories
- Status
- Notes

Inventory features:

- Add/edit parts
- View stock
- Low stock alert
- Issue stock to parts request
- Partial issue
- Stock reduction after issue
- Stock movement history
- Return unused parts to stock
- Mark unavailable items

---

# 15. Purchase Request Workflow

If a requested part is unavailable, allow creating a purchase request.

Purchase request fields:

- Purchase request number
- Related work order
- Related parts request
- Requested part/items
- Quantity
- Estimated unit price
- Estimated total
- Supplier
- Status
- Purchase officer notes
- Finance approval
- CEO approval if over threshold
- Quotation attachment
- Invoice attachment
- Delivery note attachment

Purchase request statuses:

- Draft
- Submitted
- Pending Purchase
- Pending Finance Approval
- Pending CEO Approval
- Approved
- Ordered
- Received
- Rejected
- Cancelled

Default CEO approval threshold:

```txt
1000 KWD
```

Threshold must be configurable in settings.

---

# 16. Finance Approval

Finance Manager can:

- View purchase/cost approval requests
- Approve or reject cost approval
- Add finance comments
- View cost reports
- Export Excel reports

Normal users must not see sensitive pricing unless their role allows cost visibility.

Cost visibility must be permission-based.

---

# 17. Dashboards

Create role-based dashboards.

## Super Admin / IT Admin

Show:

- Total users
- Total departments
- Total assets
- Total work orders
- Open work orders
- Pending approvals
- System activity
- Audit log summary

## CEO / Management

Show:

- Total work orders
- Open work orders
- Completed this month
- Pending approvals
- Overdue work orders
- Waiting for parts
- Total maintenance cost
- Work orders by department
- Work orders by type
- Top breakdown assets
- Cost by department
- Preventive maintenance due
- Asset downtime summary

## Maintenance Manager

Show:

- New pending work orders
- Approved work orders
- In progress jobs
- Waiting for parts
- Completed awaiting closure
- Overdue jobs
- Technician workload
- Maintenance cost summary

## Supervisor

Show:

- Jobs to assign
- Assigned work orders
- Jobs in progress
- Jobs waiting for verification
- Technician workload

## Technician

Show:

- My assigned jobs
- Jobs in progress
- Waiting for parts
- Completed jobs
- Quick mobile actions

## Store Keeper

Show:

- Pending parts requests
- Low stock parts
- Issued parts today
- Unavailable parts

## Purchase Officer

Show:

- Pending purchase requests
- Approved purchase requests
- Ordered items
- Received items

## Finance Manager

Show:

- Pending finance approvals
- Approved costs
- Rejected costs
- Cost reports

## Department Requester

Show:

- My department requests
- Status tracking
- Completed jobs awaiting confirmation

Use charts:

- Work orders by status
- Work orders by type
- Maintenance cost by department
- Monthly completed work orders
- Top assets by breakdown count

---

# 18. Database Requirements

Create Supabase SQL migrations.

Use UUID primary keys.

Core tables:

- profiles
- roles
- permissions
- role_permissions
- departments
- assets
- asset_documents
- work_orders
- work_order_labor
- work_order_materials
- work_order_assignments
- work_order_status_history
- work_order_attachments
- parts
- parts_requests
- parts_request_items
- inventory_movements
- purchase_requests
- purchase_request_items
- approvals
- notifications
- notification_events
- notification_templates
- notification_preferences
- notification_delivery_logs
- audit_logs
- app_settings

Add:

- created_at
- updated_at
- created_by
- updated_by where useful
- is_active where useful
- soft delete where useful

Add updated_at triggers.

Add useful indexes for:

- work_order_number
- work_order status
- asset_id
- department_id
- assigned technician
- parts request status
- purchase request status
- created_at
- approval status
- notification recipient, read state, created date, event key, category, priority, entity type, and entity id

---

# 19. File Uploads

Create private Supabase Storage buckets:

- work-order-files
- asset-files
- purchase-files

Allowed file types:

- PDF
- JPG
- PNG
- XLS
- XLSX
- DOC
- DOCX

Use signed URLs for viewing.

Allow uploads for:

- complaint photo
- before repair photo
- after repair photo
- damaged part photo
- meter/kilometer photo
- asset documents
- registration document
- insurance document
- warranty document
- quotations
- invoices
- delivery notes

---

# 20. PDF and Print

Create PDF/print layouts for:

1. Work Order
2. Parts Request
3. Purchase Request
4. Asset Maintenance History

PDF design:

- professional
- clean
- close to current paper form but nicer
- RECAFCO logo/header placeholder
- structured tables
- approval history
- generated by
- generated date/time
- QR code if easy, otherwise leave structure ready

Work Order PDF should include:

- RECAFCO header/logo placeholder
- work order number
- asset/machine details
- complaint
- work description
- labor table
- material table
- approval history
- signatures/approval names
- next service
- generated by
- generated date/time

Parts Request PDF should include:

- department
- work order number
- asset/equipment
- item table
- quantity
- part number
- SS rec code
- total price
- requested by
- prepared by
- approved by
- store issue status

---

# 21. Excel Export

Add Excel exports for:

- Work orders
- Assets
- Parts inventory
- Parts requests
- Purchase requests
- Maintenance cost report
- Asset maintenance history
- Pending approvals

---

# 22. PWA and Mobile

The app must be responsive and PWA-ready.

Add:

- manifest
- app icon placeholder
- installable app structure
- mobile-friendly navigation
- mobile technician dashboard
- mobile manager approval screens

Technician mobile features:

- view assigned jobs
- open job details
- start job
- add notes
- request parts
- upload photos
- complete job

Manager mobile features:

- approve/reject work order
- approve/reject parts request
- view dashboard

---

# 23. Notification System

Use the dedicated notification architecture for in-app notifications.

Do not insert notification rows directly from workflow actions unless there is no safe alternative. Prefer the centralized service in:

```txt
lib/notifications/
  events.ts
  templates.ts
  service.ts
  recipients.ts
  preferences.ts
  delivery.ts
  types.ts
```

Required behavior:

- Header notification bell
- unread count
- Notification Center at `/notifications`
- mark single notification as read
- mark all notifications as read
- archive notification
- categories
- priority
- templates
- user preference foundation
- admin notification settings
- delivery logs
- polling hook foundation for future realtime
- future-ready email, WhatsApp, SMS, and push channels, disabled until approved

Notification tables:

- `notification_events`
- `notification_templates`
- extended `notifications`
- `notification_preferences`
- `notification_delivery_logs`

Keep backward compatibility with legacy notification fields:

- `recipient_id`
- `notification_type`
- `is_read`

New notification fields should include:

- `recipient_user_id`
- `recipient_role`
- `recipient_department_id`
- `event_key`
- `category`
- `priority`
- `title`
- `message`
- `entity_type`
- `entity_id`
- `action_url`
- `action_label`
- `metadata`
- `read_at`
- `archived_at`
- `created_at`
- `created_by`

Priority values:

- low
- normal
- high
- urgent

Categories:

- Work Orders
- Approvals
- Technician Jobs
- Parts Requests
- Store / Inventory
- Purchase
- Finance
- CEO / Management
- Assets
- Reports
- System

Central service functions should include:

- `notifyByEvent()`
- `sendNotification()`
- `sendBulkNotifications()`
- `resolveRecipientsForEvent()`
- `renderNotificationTemplate()`
- `getUserNotifications()`
- `getUnreadNotificationCount()`
- `markNotificationRead()`
- `markAllNotificationsRead()`
- `archiveNotification()`
- `getNotificationPreferences()`
- `updateNotificationPreferences()`

Recipient logic belongs in `lib/notifications/recipients.ts`.

Notify users when:

- Work order submitted
- Work order pending approval
- Work order approved
- Work order rejected
- Technician assigned
- Parts requested
- Parts approved
- Parts rejected
- Parts issued
- Purchase request created
- Finance approval needed
- CEO approval needed
- Job completed
- Work order closed

External email, WhatsApp, SMS, and push delivery are not required in the first working version. Keep the schema and service design ready for these channels, but do not send external messages until provider, consent, retention, and security rules are approved.

Notification security:

- Users can read only their own notifications.
- Users can update read/archive status only for their own notifications.
- Super Admin and IT Admin can manage notification settings through `admin.notification_settings.manage`.
- Critical workflow notifications can be forced by `app_settings.force_critical_notifications`.
- Notification metadata must avoid unauthorized cost details.
- Notification creation errors must be logged safely and must not crash workflow actions.

---

# 24. Audit Logs

Audit these actions:

- login
- create/update users
- create/update departments
- create/update assets
- create/update work orders
- approval/rejection
- technician assignment
- parts request
- stock issue
- purchase request
- finance approval
- file upload
- PDF export
- Excel export
- settings change

Audit logs should be visible to Super Admin and IT Admin.

---

# 25. Settings

Create settings for:

- Work order number format
- Parts request number format
- Purchase request number format
- CEO approval threshold
- Default currency: KWD
- Company name
- Company logo placeholder
- Enable/disable requester confirmation
- Enable/disable finance approval
- Enable/disable CEO approval
- Notification retention days
- Notification poll interval seconds
- Force critical notifications

---

# 26. App Routes

Create these routes.

## Auth

- `/login`
- `/forgot-password`
- `/reset-password`

## Dashboard

- `/dashboard`

## Admin

- `/admin/users`
- `/admin/roles`
- `/admin/departments`
- `/admin/settings`
- `/admin/audit-logs`
- `/admin/notification-settings`
- `/admin/architecture`

## Maintenance

- `/maintenance/work-orders`
- `/maintenance/work-orders/new`
- `/maintenance/work-orders/[id]`
- `/maintenance/work-orders/[id]/edit`
- `/maintenance/work-orders/[id]/print`
- `/maintenance/approvals`
- `/maintenance/assignments`
- `/maintenance/reports`

## Assets

- `/assets`
- `/assets/new`
- `/assets/[id]`
- `/assets/[id]/edit`
- `/assets/[id]/history`

## Store

- `/store/parts`
- `/store/parts/new`
- `/store/parts-requests`
- `/store/parts-requests/[id]`
- `/store/inventory-movements`
- `/store/low-stock`

## Purchase

- `/purchase/requests`
- `/purchase/requests/[id]`

## Finance

- `/finance/approvals`
- `/finance/reports`

## Technician

- `/technician/jobs`
- `/technician/jobs/[id]`

## Reports

- `/reports/work-orders`
- `/reports/assets`
- `/reports/costs`
- `/reports/preventive-maintenance`

## Profile

- `/profile`
- `/profile/notifications`

## Notifications

- `/notifications`

---

# 27. Demo Data

Seed realistic RECAFCO-style demo data.

## Demo Departments

- Maintenance Department
- Store Department
- Purchase Department
- Finance Department
- IT Department
- Operations Department
- CEO Office

## Demo Users

Create seed structure for:

- Super Admin
- IT Admin
- CEO / Management
- Maintenance Manager
- Maintenance Supervisor
- Maintenance Data Entry
- Technician / Mechanic
- Store Keeper
- Purchase Officer
- Finance Manager
- Department Requester

Do not hardcode real passwords in committed code. Provide safe seed instructions.

## Demo Assets

Create at least 15 assets:

- Crane Sany STC3423
- Toyota Coaster Bus
- Mitsubishi Truck
- Forklift Toyota 8FD30
- Generator Caterpillar 500KVA
- Batching Plant Mixer Line 1
- Factory Machine Hollowcore Line 2
- Electrical Panel EP-04
- Air Compressor Atlas Copco
- Company Car Toyota Camry
- Workshop Welding Machine
- GRC Spray Machine
- Concrete Pump Putzmeister
- Tower Light Generator
- Site Pickup Nissan

## Demo Spare Parts

Create at least 25 parts:

- Engine Oil Filter
- Hydraulic Hose
- Brake Pad Set
- Alternator Belt
- Air Filter
- Diesel Filter
- Bearing
- Electrical Contactor
- Relay
- Fuse
- Hydraulic Oil
- Gear Oil
- Tire
- Battery
- Spark Plug
- Compressor Belt
- Welding Rod
- Sensor
- Switch
- Light Bulb
- Grease
- Coolant
- Pump Seal
- Valve
- Cable

## Demo Work Orders

Create at least 20 work orders with different statuses:

- Pending Approval
- Approved
- Assigned
- In Progress
- Waiting for Parts
- Waiting for Purchase
- Completed by Technician
- Verified by Supervisor
- Closed
- Rejected

Use realistic examples:

- Crane hydraulic leak
- Bus service due
- Forklift brake issue
- Generator overheating
- Batching plant mixer noise
- Electrical panel breaker trip
- Truck tire replacement
- Factory machine preventive maintenance

Create demo parts requests, purchase requests, approvals, and inventory movements.

---

# 28. Environment Variables

Create `.env.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=
```

Rules:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` may be used in client code.
- `SUPABASE_SERVICE_ROLE_KEY` must only be used server-side.
- Never commit real `.env` values.

---

# 29. Folder Structure Preference

Use a clean structure similar to:

```txt
app/
  (auth)/
  (dashboard)/
  admin/
  maintenance/
  assets/
  store/
  purchase/
  finance/
  technician/
  reports/
components/
  ui/
  layout/
  dashboard/
  work-orders/
  assets/
  store/
  purchase/
  finance/
  reports/
lib/
  supabase/
  auth/
  permissions/
  validations/
  numbering/
  exports/
  audit/
  notifications/
hooks/
types/
supabase/
  migrations/
  seed/
docs/
```

---

# 30. Reusable Components

Create reusable components such as:

- AppLayout
- AdminSidebar
- MobileNav
- PageHeader
- StatCard
- DataTable
- StatusBadge
- ApprovalTimeline
- FileUploader
- FormSection
- WorkOrderForm
- PartsRequestForm
- AssetCard
- EmptyState
- ConfirmDialog
- PermissionGate
- CostVisibilityGuard
- MobileJobCard
- NotificationBell
- NotificationCenter
- NotificationPreferences
- ArchitecturePresentation

---

# 31. README Requirements

Create `README.md` with:

- Project overview
- Features
- Tech stack
- Setup instructions
- Supabase setup
- Environment variables
- Migration instructions
- Seed instructions
- How to create first Super Admin
- How to run locally
- How to deploy to Vercel
- Security notes
- Demo workflow testing steps

---

# 32. Development Commands

Use npm.

Expected commands:

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
```

If `typecheck` does not exist, add it.

---

# 33. Development Order

Build in this order.

## Phase 1

- Project setup
- Tailwind / shadcn
- Supabase config
- Auth
- Protected routes
- RBAC helpers
- Layouts
- Database migrations
- Departments
- Users / profiles
- Settings
- Basic dashboard
- Demo seed base

## Phase 2

- Asset master
- Spare parts inventory
- Work order CRUD
- Auto-numbering
- Work order details page
- PDF print foundation

## Phase 3

- Approval workflow
- Technician assignment
- Technician mobile dashboard
- Status history
- Basic notifications

## Phase 4

- Parts request workflow
- Store issue
- Inventory movements
- Purchase request workflow
- Finance approval
- CEO threshold approval

## Phase 5

- Dashboards
- Reports
- Excel exports
