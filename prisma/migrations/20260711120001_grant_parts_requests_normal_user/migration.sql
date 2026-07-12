-- Grant parts_requests.view and parts_requests.create to maintenance_data_entry role
-- Normal maintenance users can view their own parts requests and create new ones.
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'maintenance_data_entry'
  AND p.key IN ('parts_requests.view', 'parts_requests.create')
ON CONFLICT DO NOTHING;
