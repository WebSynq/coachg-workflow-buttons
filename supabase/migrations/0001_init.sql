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
