# Technical Architecture

This document supports `/admin/architecture`, the protected Super Admin / IT Admin presentation page for explaining the RECAFCO Enterprise Maintenance Management System to IT Manager and technical management.

## System Layers

- Presentation Layer: Next.js App Router pages, role-based layouts, dashboards, forms, tables, mobile technician UI, System Map, and Architecture page.
- Business Logic Layer: server actions, workflow actions, approvals, assignments, parts/store/purchase/finance actions, notification service, report service, export service, QR service, and file actions.
- Security Layer: local email/password auth, HTTP-only cookie sessions, active profile checks, server-side RBAC, permission gates, and cost visibility guards.
- Data Layer: PostgreSQL migrations, Prisma ORM, UUID tables, indexes, audit logs, status history, numbering sequences, and notification records.
- Storage Layer: local private buckets, file metadata, upload validation, and authenticated file route handlers.
- Integration / Future Layer: email, WhatsApp, SMS, push, ERP, HR sync, offline mode, Arabic/RTL, and advanced analytics.

## Security Model

Access flow:

1. Login through local email/password authentication.
2. Load active profile.
3. Resolve role.
4. Build permission set.
5. Guard server route/action.
6. Apply ownership and permission checks in the server query/action layer.
7. Write audit log for important actions.

Rules:

- UI hiding is not enough.
- Permissions must be enforced server-side.
- Server-side RBAC protects data access.
- Technicians only see assigned jobs.
- Cost visibility is permission-based.
- Private files use authenticated route-handler access.
- Database credentials stay server-side only.

## Database Model

Core:

- `profiles`
- `roles`
- `permissions`
- `role_permissions`
- `departments`
- `app_settings`
- `audit_logs`

Maintenance:

- `assets`
- `asset_documents`
- `work_orders`
- `work_order_labor`
- `work_order_materials`
- `work_order_assignments`
- `work_order_status_history`
- `work_order_attachments`

Store / Parts:

- `parts`
- `parts_requests`
- `parts_request_items`
- `inventory_movements`

Purchase / Finance:

- `purchase_requests`
- `purchase_request_items`
- `approvals`

Notifications:

- `notification_events`
- `notification_templates`
- `notifications`
- `notification_preferences`
- `notification_delivery_logs`

## Notification Architecture

Notification flow:

1. Workflow event occurs.
2. Action calls `notifyByEvent()`.
3. Recipient resolver finds users by role/user id.
4. Template renderer builds message/action.
5. Preferences check allows noncritical opt-outs.
6. Notification row is created.
7. Delivery log records sent, failed, or disabled.
8. Header bell and Notification Center show the alert.

Implemented channel:

- In-app notifications

Future channels:

- Email
- WhatsApp
- SMS
- Push

External channels remain disabled until provider, consent, retention, and data-leak rules are approved.

## File Storage Architecture

Flow:

1. User uploads file.
2. Server action validates entity, permission, file type, and size.
3. File writes to a private local bucket under `UPLOADS_DIR`.
4. Metadata is saved to the business record.
5. Authorized viewers receive authenticated `/api/files/...` links only.

Buckets:

- `work-order-files`
- `asset-files`
- `purchase-files`

## Workflow Engine

The workflow engine is server-action driven:

1. Work Order Created
2. Approval
3. Assignment
4. Technician Execution
5. Parts Request
6. Store Issue
7. Purchase if unavailable
8. Finance Approval
9. CEO Threshold
10. Receive Stock
11. Complete Work
12. Supervisor Verify
13. Manager Close
14. Asset History
15. Reports

Supporting systems:

- status history
- audit logs
- notifications
- role permissions
- cost visibility
- inventory movements

## Editable Workflow Planning Layer

The Super Admin route `/admin/system-map/edit` provides a workshop board for department meetings. It starts from the latest official full workflow diagram, then allows dragging steps, changing handoffs, adding notes, exporting JSON, and saving draft or published versions in `workflow_map_versions`.

This layer is intentionally separate from the live workflow engine. Published diagrams document reviewed process proposals, but they do not automatically change approvals, permissions, notifications, inventory behavior, or finance/CEO thresholds.

## Reporting and Export Architecture

Flow:

1. Data sources
2. Report query layer
3. Permission and cost visibility check
4. Report pages
5. Native `.xlsx` export
6. Browser print/PDF
7. QR codes

Cost exports must remove sensitive columns for users without cost visibility.

## Deployment Options

Current demo:

- Next.js app on local/company server or Vercel demo
- PostgreSQL database
- Prisma ORM
- Local auth tables and cookie sessions
- Local private file storage

Future production options:

- Company server + PostgreSQL
- Company server + managed PostgreSQL
- Company server + self-hosted Supabase if approved
- Kuwait/private cloud if required

Environment variables:

- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL`
- `UPLOADS_DIR`
- `POSTGRES_SERVICE_NAME`

Database credentials must never be exposed to browser code.

## Scalability Roadmap

Performance:

- pagination
- query indexes
- report optimization
- caching strategy

Security:

- 2FA
- SSO / Microsoft login
- IP/VPN restriction
- backup and restore policy

Mobile:

- offline mode
- QR camera scanning
- PWA push notifications

Localization:

- Arabic support
- RTL layout

Integration:

- ERP integration
- HR employee sync
- purchase/accounting integration
- external notification providers

AI / Predictive Maintenance:

- preventive maintenance scheduler
- failure prediction
- asset downtime analytics
- anomaly detection
- parts demand forecasting
