-- CoachG Workflow Buttons — add soa_sent_at to activity_log
-- See docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md §6
--
-- Insurance compliance requirement: the primary button action enrolls a
-- contact into a GHL workflow that generates and sends a Scope of Appointment
-- (SOA) PDF. This column captures when the SOA was sent so the widget can
-- surface "SOA last sent: [date]" under the button as a legal paper trail.
--
-- Populated by /api/enroll on successful enrollment (Phase 5). Nullable so
-- failed enrollments and any future non-SOA enrollments leave it empty.

ALTER TABLE activity_log
  ADD COLUMN soa_sent_at timestamptz;

-- Index supports the widget's per-contact lookup of the most recent SOA.
CREATE INDEX activity_log_soa_widget_idx
  ON activity_log (location_id, contact_id, soa_sent_at DESC)
  WHERE soa_sent_at IS NOT NULL;
