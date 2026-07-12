-- Grant parts.view permission to maintenance_data_entry role
-- Allows normal maintenance users to browse spare parts inventory (read-only).
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'maintenance_data_entry'
  AND p.key = 'parts.view'
ON CONFLICT DO NOTHING;
