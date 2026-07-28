-- Offline Inventory Control Daily Material Actions Cleanup Task 2/9.
--
-- Grants maintenance_data_entry the store.issue permission so the Daily
-- Actions on Offline Inventory Control (Add New Material, Receive Material,
-- Record Used Material) become available to Data Entry, matching the
-- business requirement that Data Entry and Manager both perform daily
-- material handling. Mirrors the same targeted grant pattern used by
-- 20260721100000_grant_maintenance_engineer_parts_view. Data Entry already
-- holds parts.view (read access); this adds the write gate checked by
-- canManageOfflineInventory() in lib/store/offline-inventory-data.ts.
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'maintenance_data_entry'
  AND p.key = 'store.issue'
ON CONFLICT DO NOTHING;
