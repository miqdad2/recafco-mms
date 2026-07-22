-- User Creation and Role-Based Dashboard/Access Alignment Unit.
--
-- Viewer / Auditor is documented (Task 4 of this unit) as having read-only
-- access to Job Cards, Materials Requests, assets, and reports, but the role
-- was never granted parts_requests.view — so a Viewer/Auditor account
-- currently cannot see Materials Requests at all. Additive-only: grants one
-- existing permission to one existing role. No new role, no new permission,
-- no schema (DDL) change, nothing else touched or revoked.

INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'viewer_auditor'
  AND p.key = 'parts_requests.view'
ON CONFLICT DO NOTHING;
