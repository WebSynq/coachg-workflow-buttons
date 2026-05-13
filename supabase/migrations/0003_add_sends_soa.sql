-- CoachG Workflow Buttons — flag which buttons send an SOA
-- See docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md §6
--
-- Phase 5's /api/enroll uses this flag to decide whether to populate
-- activity_log.soa_sent_at on a successful enrollment. Default true is
-- safe: existing buttons get marked as SOA-sending, which matches the
-- primary use case. Admins flip to false for non-SOA buttons going forward.

ALTER TABLE buttons
  ADD COLUMN sends_soa boolean NOT NULL DEFAULT true;
