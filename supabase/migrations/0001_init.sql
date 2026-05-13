-- CoachG Workflow Buttons — initial schema
-- See docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md §6

-- Cross-table trigger function: bump updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- OAuth tokens, one row per GHL sub-account (location).
CREATE TABLE ghl_tokens (
  location_id   text PRIMARY KEY,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ghl_tokens_set_updated_at
  BEFORE UPDATE ON ghl_tokens
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Operator-configured buttons, scoped to a GHL location.
CREATE TABLE buttons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   text NOT NULL,
  label         text NOT NULL,
  color         text NOT NULL,
  workflow_id   text NOT NULL,
  workflow_name text NOT NULL,
  sort_order    integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buttons_label_length CHECK (char_length(label) <= 50),
  CONSTRAINT buttons_color_format CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE INDEX buttons_location_sort_idx ON buttons (location_id, sort_order);

CREATE TRIGGER buttons_set_updated_at
  BEFORE UPDATE ON buttons
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Enrollment activity log. Append-only by convention (write only via /api/enroll;
-- not enforced at the schema level — see spec §14 deferred items).
CREATE TABLE activity_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id            text NOT NULL,
  contact_id             text NOT NULL,
  contact_name           text,
  button_label           text NOT NULL,
  workflow_id            text NOT NULL,
  workflow_name          text NOT NULL,
  triggered_by_user_id   text NOT NULL,
  triggered_by_user_name text NOT NULL,
  status                 text NOT NULL,
  error_message          text,
  triggered_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_log_status_valid CHECK (status IN ('success', 'error'))
);

CREATE INDEX activity_log_widget_idx
  ON activity_log (location_id, contact_id, triggered_at DESC);

CREATE INDEX activity_log_admin_idx
  ON activity_log (location_id, triggered_at DESC);

-- Per-user-per-location rate limit buckets, one row per minute.
CREATE TABLE rate_limits (
  location_id  text NOT NULL,
  user_id      text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 1,
  PRIMARY KEY (location_id, user_id, window_start)
);
