-- Row level security as a second layer of tenant isolation, behind the
-- application-layer `AND location_id = $n` clauses that stay in place.
-- See docs/superpowers/plans/2026-08-16-phase-8-security-hardening.md Task 1.

DO $$ BEGIN
  CREATE ROLE app_runtime LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ghl_tokens, buttons, activity_log, rate_limits TO app_runtime;
GRANT EXECUTE ON FUNCTION rate_limit_check(text, text, integer) TO app_runtime;

ALTER TABLE ghl_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY ghl_tokens_tenant_isolation ON ghl_tokens
  FOR ALL
  USING (location_id = current_setting('app.location_id', true))
  WITH CHECK (location_id = current_setting('app.location_id', true));

ALTER TABLE buttons ENABLE ROW LEVEL SECURITY;
ALTER TABLE buttons FORCE ROW LEVEL SECURITY;
CREATE POLICY buttons_tenant_isolation ON buttons
  FOR ALL
  USING (location_id = current_setting('app.location_id', true))
  WITH CHECK (location_id = current_setting('app.location_id', true));

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log FORCE ROW LEVEL SECURITY;
CREATE POLICY activity_log_tenant_isolation ON activity_log
  FOR ALL
  USING (location_id = current_setting('app.location_id', true))
  WITH CHECK (location_id = current_setting('app.location_id', true));

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY rate_limits_tenant_isolation ON rate_limits
  FOR ALL
  USING (location_id = current_setting('app.location_id', true))
  WITH CHECK (location_id = current_setting('app.location_id', true));
