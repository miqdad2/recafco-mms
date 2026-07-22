-- Maintenance Engineer Sidebar Access Alignment Task 2.
--
-- Grants maintenance_engineer the parts.view permission so the read-only
-- Offline Inventory Control balance and movement-history pages become
-- visible. This does NOT grant any write capability: opening stock, imports,
-- receiving, and issuing all remain gated behind store.issue
-- (lib/store/offline-inventory-data.ts's requireOfflineInventoryManage),
-- which maintenance_engineer still does not hold.
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'maintenance_engineer'
  AND p.key = 'parts.view'
ON CONFLICT DO NOTHING;
