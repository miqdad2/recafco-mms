-- Maintenance Workflow Redesign Unit 3 — additive role and permission foundation.
--
-- Adds the maintenance_engineer role (new position between Data Entry and
-- Manager in the simplified Job Card review chain) and 8 new permissions the
-- new workflow needs, then grants permissions to the 5 workflow roles.
-- Nothing existing is removed, renamed, or revoked. maintenance_supervisor is
-- untouched (locked decision: not repurposed).

-- 1. New role.
INSERT INTO roles (name, slug, description, is_system)
SELECT 'Maintenance Engineer', 'maintenance_engineer',
       'Reviews job cards before Maintenance Manager approval, requests corrections, and can assign/update/close work.',
       true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE slug = 'maintenance_engineer');

-- 2. New permissions. Existing permissions with matching intent are reused
-- (see Unit 3 report mapping table) rather than duplicated here.
INSERT INTO permissions (key, description)
SELECT v.key, v.description
FROM (VALUES
  ('work_orders.review', 'Review job cards before Maintenance Manager approval'),
  ('work_orders.request_correction', 'Send a job card back for correction while it remains Under Review'),
  ('parts_requests.edit', 'Edit materials request items and quantities before issue'),
  ('parts_requests.issue', 'Issue materials against an approved materials request'),
  ('parts_requests.mark_waiting_stock', 'Mark a materials request as waiting for stock when none is available'),
  ('offline_inventory.view', 'View the Offline Inventory Control balance dashboard'),
  ('offline_inventory.issue', 'Issue materials from the Offline Inventory Control ledger'),
  ('offline_inventory.ledger', 'View Offline Inventory Control movement history')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = v.key);

-- 3. Grants — maintenance_data_entry (add what's missing; existing grants untouched).
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'maintenance_data_entry'
  AND p.key IN ('parts_requests.edit', 'work_orders.assign', 'work_orders.update', 'work_orders.close')
ON CONFLICT DO NOTHING;

-- 4. Grants — maintenance_engineer (new role, full grant set for its scope).
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'maintenance_engineer'
  AND p.key IN (
    'work_orders.view', 'work_orders.manage', 'work_orders.review', 'work_orders.request_correction',
    'work_orders.assign', 'work_orders.update', 'work_orders.close',
    'parts_requests.create', 'parts_requests.view', 'parts_requests.edit',
    'notifications.view'
  )
ON CONFLICT DO NOTHING;

-- 5. Grants — maintenance_manager (add what's missing).
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'maintenance_manager'
  AND p.key IN ('work_orders.request_correction', 'parts_requests.edit')
ON CONFLICT DO NOTHING;

-- 6. Grants — store_keeper (add what's missing).
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'store_keeper'
  AND p.key IN (
    'parts_requests.issue', 'parts_requests.mark_waiting_stock',
    'offline_inventory.view', 'offline_inventory.issue', 'offline_inventory.ledger'
  )
ON CONFLICT DO NOTHING;

-- 7. Grants — technician (add what's missing).
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'technician'
  AND p.key = 'work_orders.close'
ON CONFLICT DO NOTHING;

-- 8. Grants — super_admin gets every new permission explicitly, matching the
-- existing pattern of super_admin holding all permissions in the catalog
-- (functionally redundant with the code-level bypass, kept for consistency).
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'super_admin'
  AND p.key IN (
    'work_orders.review', 'work_orders.request_correction',
    'parts_requests.edit', 'parts_requests.issue', 'parts_requests.mark_waiting_stock',
    'offline_inventory.view', 'offline_inventory.issue', 'offline_inventory.ledger'
  )
ON CONFLICT DO NOTHING;
