-- Maintenance Workflow Redesign Unit 6 — workflow notification events.
--
-- Adds the 14 new Job Card / Materials Request event keys (additive only —
-- notifyByEvent() already works with unseeded keys via its code-level
-- fallback, but seeding them lets the admin notification-settings page
-- manage them and gives notification_preferences a valid FK target).
--
-- Also disables (is_enabled = false, is_critical = false) the old event keys
-- whose content is explicitly forbidden in the simplified workflow (Rejected/
-- Cancelled/Completed by Technician/Verified by Supervisor/Waiting for
-- Purchase wording). No application code calls these anymore as of this
-- unit — this is defense-in-depth so they can never re-fire even if some
-- future code path calls them directly. Existing historical `notifications`
-- rows referencing these keys are left untouched.

INSERT INTO notification_events (event_key, category, priority, description, is_critical, is_enabled)
SELECT v.event_key, v.category, v.priority, v.description, v.is_critical, true
FROM (VALUES
  ('job_card.created', 'Work Orders', 'normal', 'A new Job Card was created and needs Maintenance Engineer review.', false),
  ('job_card.submitted_for_review', 'Approvals', 'normal', 'A Job Card was submitted for Maintenance Engineer review.', true),
  ('job_card.reviewed', 'Approvals', 'normal', 'A Job Card was reviewed by the Maintenance Engineer and is ready for Manager approval.', true),
  ('job_card.correction_requested', 'Approvals', 'high', 'A correction was requested on a Job Card.', true),
  ('job_card.approved', 'Approvals', 'high', 'A Job Card was approved by the Maintenance Manager.', true),
  ('job_card.waiting_materials', 'Work Orders', 'high', 'A Job Card is waiting for materials.', true),
  ('job_card.assigned', 'Work Orders', 'high', 'A Job Card was assigned.', true),
  ('job_card.in_progress', 'Work Orders', 'low', 'Work started on a Job Card.', false),
  ('job_card.closed', 'Work Orders', 'normal', 'A Job Card was closed.', false),
  -- Category is "Parts Requests" (the DB-valid value for this constraint),
  -- not "Materials Requests" — see the note in lib/notifications/events.ts.
  ('material_request.created', 'Parts Requests', 'normal', 'A Materials Request was created for a Job Card.', false),
  ('material_request.approved', 'Parts Requests', 'high', 'A Materials Request was approved for Store issue.', true),
  ('material_request.waiting_stock', 'Store / Inventory', 'high', 'A Materials Request is waiting for stock.', true),
  ('material_request.partially_issued', 'Store / Inventory', 'high', 'A Materials Request was partially issued.', true),
  ('material_request.issued', 'Store / Inventory', 'high', 'A Materials Request was fully issued.', true)
) AS v(event_key, category, priority, description, is_critical)
WHERE NOT EXISTS (SELECT 1 FROM notification_events e WHERE e.event_key = v.event_key);

UPDATE notification_events
SET is_enabled = false, is_critical = false
WHERE event_key IN (
  'work_order.rejected',
  'work_order.cancelled',
  'work_order.completed',
  'work_order.verified',
  'parts_request.rejected',
  'parts_request.unavailable'
);
