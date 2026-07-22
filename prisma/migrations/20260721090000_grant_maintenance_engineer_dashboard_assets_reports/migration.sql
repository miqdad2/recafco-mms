-- Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 2.
--
-- The maintenance_engineer role (created in the Unit 3 workflow-redesign
-- migration) was never granted dashboard.view, assets.view, or reports.view.
-- The sidebar nav config (components/layout/app-layout.tsx) already lists
-- Dashboard, Assets & Equipment, and Reports for this role — they were just
-- silently filtered out by the permission check (canSee), not missing from
-- the nav groups. This grants the three permissions Engineer was missing;
-- nothing existing is removed or changed.
INSERT INTO role_permissions (role_id, permission_id, created_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'maintenance_engineer'
  AND p.key IN ('dashboard.view', 'assets.view', 'reports.view')
ON CONFLICT DO NOTHING;
