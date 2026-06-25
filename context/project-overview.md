# RECAFCO Maintenance Management System

## Overview

The RECAFCO Maintenance Management System is an internal, single-tenant enterprise application for RECAFCO in Kuwait. It digitizes maintenance work orders, asset records, spare-parts inventory, store operations, purchase requests, finance and CEO approvals, notifications, audit history, and management reporting.

The system replaces paper-heavy and manually coordinated processes with controlled workflows, role-based access, traceable approvals, status history, cost visibility controls, and operational dashboards.

## Goals

1. Provide a controlled end-to-end work-order lifecycle.
2. Make every significant action attributable to a user.
3. Enforce role-based approval and access rules.
4. Improve maintenance completion speed and visibility.
5. Maintain accurate asset, parts, purchase, and cost records.
6. Prevent unauthorized cost exposure.
7. Provide executive reporting without operational editing tools.
8. Support audit and compliance requirements.
9. Preserve business rules in a form portable to a future NestJS backend.
10. Prepare for future shared object storage and realtime infrastructure.

## Primary Users

Operational users:

- Maintenance Data Entry
- Maintenance Manager
- Maintenance Supervisor
- Technician
- Store Keeper
- Purchase Officer
- Finance Manager
- CEO / Management

Administrative and oversight users:

- Super Admin
- IT Admin
- Cost Controller
- Accounting Reviewer
- Department Requester
- Viewer / Auditor

Workflow-only seeded roles without complete pages/actions:

- Production Manager
- Factory Manager
- Purchase Manager

## Core User Flow

### Maintenance Work Order

1. Data Entry creates a draft.
2. The work order is submitted.
3. Maintenance Manager reviews it.
4. Manager approves, rejects, or requests clarification.
5. Required parts may be recorded.
6. Store Keeper may perform inventory checking when enabled.
7. Technician is assigned.
8. Technician starts work.
9. Technician records work and completes the job.
10. Supervisor verifies completion.
11. Requester confirmation may be required.
12. Maintenance Manager closes the work order.

### Store and Parts

1. Parts requirement is identified.
2. Store checks availability.
3. Available stock is issued.
4. Inventory movement is recorded.
5. Unavailable items enter shortage handling.
6. Purchase request can be created manually.

### Purchase and Approval

1. Purchase Officer manages a purchase request.
2. Finance Manager reviews it.
3. CEO approval is required when the threshold is reached.
4. Purchased items are received into inventory.
5. Stock and inventory movements are updated.
6. The maintenance process continues.

Formal purchase-order creation remains incomplete.

## Features

### Work Orders

- Drafts
- Submission
- Approval and rejection
- Clarification
- Assignment
- Technician execution
- Completion
- Supervisor verification
- Manager closure
- Status history
- Audit logging
- Notifications
- Print and export

### Assets

- Asset master
- Maintenance history
- Service dates
- Registration, insurance, and warranty expiry tracking
- Attachments
- Reports

### Spare Parts and Inventory

- Parts master
- Current stock
- Minimum stock
- Unit price
- Compatible asset categories
- Low-stock visibility
- Inventory movements
- Store issue
- Purchase receipt
- Required work-order parts
- Feature-flagged inventory checking

### Parts Requests

- Request creation
- Approval
- Store issue
- Partial issue
- Unavailable item handling
- Purchase linkage

### Purchase and Finance

- Purchase requests
- Finance approval
- CEO approval
- Cost visibility controls
- Purchase receipt
- Inventory update
- Purchase-order schema

### Notifications

- In-app notification center
- Preferences
- Event templates
- Delivery logs
- SSE updates

### Reporting

- Work orders
- Assets
- Costs
- Preventive maintenance
- CEO executive reports
- Excel exports

### Administration

- Users
- Roles
- Permissions
- Departments
- Permission overrides
- App settings
- Audit logs
- System health
- System map
- Architecture view
- Backup logs

## Current Verified State

Implemented in code:

- Core work-order lifecycle
- Asset and parts management
- Store issue
- Purchase request flow
- Finance approval
- CEO approval
- Purchase receipt
- In-app notifications
- SSE delivery
- Private local file uploads
- Reports and exports
- Role dashboards
- System health and audit tools
- Workflow engine foundation
- Inventory-check UI and backend gate

Current DB content:

- 17 roles
- 55 permissions
- 7 departments
- 15 assets
- 25 parts
- 20 work orders
- 2 users
- 0 assignments
- 0 parts requests
- 0 purchase requests
- 0 purchase orders
- 0 inventory movements
- 0 workflow instances

Feature-flagged:

- Inventory check, currently disabled

Partial:

- Requester confirmation
- General reopen
- Cancellation
- Automatic shortage-to-purchase progression

Schema or definition only:

- Purchase-order lifecycle
- Production Manager approval
- Factory Manager approval
- Purchase Manager approval
- Construction Project Request flow

Not active:

- External email, SMS, WhatsApp, and push
- Socket.IO/WebSockets
- MinIO/S3
- Automated tests
- NestJS backend

## Scope

### In Scope

- Internal authenticated application
- Maintenance work orders
- Assets
- Spare parts
- Store operations
- Parts requests
- Purchase requests
- Finance and CEO approvals
- Notifications
- Attachments
- Reports
- Auditability
- Administration
- Local PostgreSQL and internal-server deployment

### Out of Scope for Current Phase

- Public customer access
- Multi-tenant SaaS
- Vendor portal
- Customer billing
- E-commerce
- Native mobile apps
- Fully automated procurement
- External notification delivery
- Distributed realtime infrastructure
- Production object storage
- NestJS migration before readiness gates

## Success Criteria

1. Roles see only permitted pages and records.
2. Work orders cannot bypass backend transition rules.
3. Cost information is not exposed to unauthorized users.
4. Technician assignment and updates are correctly restricted.
5. Store issue updates inventory atomically.
6. Finance and CEO approvals follow settings.
7. Notification failures do not block workflows.
8. File downloads enforce entity authorization.
9. Audit logs capture significant actions.
10. Database, lint, typecheck, and build pass.
11. A controlled multi-role lifecycle works end to end.
12. Backup and restore procedures are documented and tested.

## Current Product Phase

The application has an advanced working codebase but is currently in recovery and controlled multi-role verification after the local database was rebuilt. The immediate goal is to restore a trustworthy demonstration baseline and verify the complete lifecycle before broad feature expansion.
