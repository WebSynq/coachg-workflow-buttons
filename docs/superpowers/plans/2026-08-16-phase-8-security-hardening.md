# Phase 8: Security hardening before fleet-wide install

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Execute task-by-task, RED before GREEN, commit at the end of every task. Do not batch tasks.

**Goal:** Close the P0 gaps that block installing this app across every CoachG CRM sub-account, and stop `soa_sent_at` from claiming evidence it does not have.

Six tasks. Five new migrations, one new lib module, one refactor of `lib/db.ts`, changes to all seven API routes, plus `next.config.ts`.

**Path reconciliation (read first):** this plan was drafted against an earlier commit. Before executing any task, run `git ls-files app lib` and reconcile every path named below against what exists. `app/admin/decodeJwt.ts` is now `lib/client-sso.ts`, and the admin layer is split into `AdminGate`, `Tabs`, `ButtonTable`, `ButtonFormModal`, and `ActivityTab`. If a path in this plan does not exist, find what replaced it and report the mapping before editing. Never create a file just because this plan names it.

**Spec reference:** design doc §6 (schema), §7 (route table), §12 (tenant isolation), §14 (deferred items — this phase closes two of them).

**Why now:** v1 shipped to a single pilot location where application-layer tenant scoping and plaintext tokens were a defensible tradeoff. At fleet scale the blast radius of one missing `AND location_id = $n` becomes every client in the agency, and one `SELECT * FROM ghl_tokens` becomes full GHL API access to every client sub-account.

**Out of scope for Phase 8:**
- The SOA signing surface (public token-authed route, PDF generation, object storage, signature capture). That is Phase 9 and needs its own spec.
- GHL inbound webhook receiver and HMAC verification. Phase 9, first consumer is the SOA signature callback. Task 3 below establishes the uninstall path only.
- Any UI redesign. Widget and admin keep their current shape.
- Migrating off the `buttons` table. It stays as the manual-trigger fallback.

---

## Non-negotiable invariants for this phase

1. `sso.locationId` remains the only authoritative tenant identifier. RLS is a **second** layer, not a replacement for the existing `AND location_id = $n` clauses. Do not remove a single one.
2. Every task ends GREEN with the full suite passing. `yarn test` must stay at or above the current 238 passing cases.
3. No plaintext secret is ever written to a log line, an error message, or a redirect URL.
4. Migrations are forward-only and idempotent enough to run through `loadAllMigrations()` in the PGlite harness.

---

## Task 1: Tenant-scoped DB role and RLS on all four tables

**Problem:** `supabase/migrations/0001_init.sql` creates `ghl_tokens`, `buttons`, `activity_log`, `rate_limits` with no row level security. Isolation is entirely application-layer.

**Design:** a dedicated `app_runtime` login role that does not own the tables and does not have `BYPASSRLS`, plus policies keyed on the `app.location_id` session GUC. `lib/db.ts` gains `getTenantDb(locationId)`, which wraps each query in a transaction that issues `SET LOCAL app.location_id` first. Route handlers change one line each.

- [ ] **Step 1 (RED)**: Add `test/db/rls.test.ts`. Using the PGlite harness, seed two locations' rows into `buttons` and `activity_log`, then `SET ROLE app_runtime` and assert:
  - with `app.location_id` set to location A, a bare `SELECT * FROM buttons` returns only A's rows
  - with the GUC unset, the same select returns zero rows (fail closed, never fail open)
  - an `UPDATE` targeting location B's row while the GUC is A affects zero rows
  - same three assertions for `activity_log`, `ghl_tokens`, `rate_limits`
  Note: PGlite runs as superuser and superusers bypass RLS, so `SET ROLE app_runtime` in the test session is what makes the policies observable. A test that forgets `SET ROLE` will pass for the wrong reason — assert the negative case (GUC unset returns zero rows) to catch that.

- [ ] **Step 2 (GREEN)**: Create `supabase/migrations/0004_rls_tenant_isolation.sql`:
  - `DO $$ BEGIN CREATE ROLE app_runtime LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
  - `GRANT SELECT, INSERT, UPDATE, DELETE` on the four tables to `app_runtime`, `GRANT EXECUTE ON FUNCTION rate_limit_check` to `app_runtime`, `GRANT USAGE ON SCHEMA public`
  - `ALTER TABLE <each> ENABLE ROW LEVEL SECURITY;` and `FORCE ROW LEVEL SECURITY;`
  - one `FOR ALL` policy per table: `USING (location_id = current_setting('app.location_id', true)) WITH CHECK (location_id = current_setting('app.location_id', true))`
  - `current_setting(..., true)` returns NULL when unset, and `location_id = NULL` is never true, so unset context yields zero rows by construction

- [ ] **Step 3 (GREEN)**: Refactor `lib/db.ts`. Keep the `QueryClient` interface and `getDb()` untouched for the OAuth callback's pre-tenant work. Add:
  ```ts
  export function getTenantDb(locationId: string): QueryClient
  ```
  Each `query()` on the returned client runs inside `sql.begin()`, issuing `SET LOCAL app.location_id = $1` before the caller's statement. `SET LOCAL` is transaction-scoped, so a pooled connection cannot leak tenant context to the next request. Add a matching `resetDbForTests()` path.

- [ ] **Step 4 (GREEN)**: Swap `getDb()` for `getTenantDb(sso.locationId)` in `app/api/buttons/route.ts`, `app/api/buttons/[id]/route.ts`, `app/api/buttons/reorder/route.ts`, `app/api/enroll/route.ts`, `app/api/log/route.ts`, and `lib/rate-limit.ts` (which needs the locationId threaded through — it already receives it). Leave every existing `AND location_id = $n` clause exactly as-is.

- [ ] **Step 5**: Update `DEPLOYMENT.md`. `DATABASE_URL` must now point at `app_runtime`, not `postgres`. Document that the migration runs as the owner role and the app connects as `app_runtime`, and that pointing the app at a `BYPASSRLS` role silently disables this entire task.

- [ ] **Step 6**: Full suite GREEN, then commit: `feat(db): enforce tenant isolation with RLS and a non-bypassing app role`.

---

## Task 2: Encrypt OAuth tokens at rest

**Problem:** `ghl_tokens.access_token` and `refresh_token` are plaintext. Design doc §14 defers this explicitly. At fleet scale, one read of that table is full GHL API access to every client.

**Design:** application-layer AES-256-GCM, key in `TOKEN_ENC_KEY` (32 random bytes, base64). Not pgcrypto: passing a key as a SQL literal puts it in query logs and in the DB's memory, which defeats the point when the threat model is DB read access. Expand/contract migration so no token is ever lost mid-deploy.

- [ ] **Step 1 (RED)**: `lib/crypto.test.ts` — round-trip encrypt/decrypt; ciphertext differs across calls for identical plaintext (random IV); decrypt throws on a tampered auth tag; decrypt throws on a version prefix it does not recognise; `encrypt` throws a clear error when `TOKEN_ENC_KEY` is missing or not 32 bytes decoded.

- [ ] **Step 2 (GREEN)**: `lib/crypto.ts` exporting `encryptSecret(plain: string): string` and `decryptSecret(payload: string): string`. Wire format `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`. Read the key through `getEnv('TOKEN_ENC_KEY')` so a missing key fails at first use with a clear message rather than writing plaintext.

- [ ] **Step 3 (GREEN)**: `supabase/migrations/0005_encrypt_tokens_expand.sql` adds nullable `access_token_enc text` and `refresh_token_enc text`.

- [ ] **Step 4 (GREEN)**: Update the writer (`app/api/oauth/callback/route.ts`) and `lib/ghl.ts` (`persistToken`, `loadToken`) to write the `_enc` columns and read through `decryptSecret`. `loadToken` falls back to the plaintext column when `_enc` is NULL, so a deploy mid-backfill keeps working.

- [ ] **Step 5**: Write `scripts/backfill-token-encryption.ts` — reads rows where `access_token_enc IS NULL`, encrypts, writes. Idempotent, safe to re-run. Run it against production before Step 6 ships.

- [ ] **Step 6 (GREEN)**: `supabase/migrations/0006_encrypt_tokens_contract.sql` drops the plaintext columns and sets the `_enc` columns `NOT NULL`. **Do not run this migration until the backfill has been verified against production with a row count check.**

- [ ] **Step 7**: Update `test/db/ghl-tokens.test.ts` for the new columns. Add an assertion that no test writes a value matching the raw token fixture into any column — a regression guard against a future writer bypassing `encryptSecret`.

- [ ] **Step 8**: Full suite GREEN, then commit: `feat(security): encrypt GHL OAuth tokens at rest with AES-256-GCM`.

---

## Task 3: Harden the OAuth callback and add the uninstall handler

**Problem:** `app/api/oauth/callback/route.ts` accepts any `code` with no CSRF `state`, logs the locationId to console, and redirects to `/admin?locationId=...` even though `app/admin/Admin.tsx` derives the location from the SSO JWT and ignores that param entirely. Separately, there is no uninstall path, so `ghl_tokens` rows for departed clients live forever.

- [ ] **Step 1 (RED)**: Extend `test/api/oauth-callback.test.ts`:
  - a request whose `state` param does not match the `ghl_oauth_state` cookie returns 403 and writes no `ghl_tokens` row
  - a request with a valid state pair still succeeds
  - the success redirect Location header contains no `locationId` query param
  Add `test/api/oauth-install.test.ts`: `GET /api/oauth/install` returns a 302 to GHL's authorize URL and sets an httpOnly, SameSite=Lax, 10-minute `ghl_oauth_state` cookie.

- [ ] **Step 2 (GREEN)**: Add `app/api/oauth/install/route.ts` — generates 32 bytes of `crypto.randomBytes`, sets the cookie, redirects to GHL's authorize endpoint with `state`. This becomes the documented install entry point for agency-initiated installs.

- [ ] **Step 3 (GREEN)**: In the callback, require `state` to match the cookie via `crypto.timingSafeEqual`, clear the cookie on use, return 403 on mismatch. Delete the `console.log`. Redirect to bare `/admin`.
  **Known limitation to document, not to paper over:** a marketplace-initiated install starts on GHL's side and cannot carry our state cookie. Gate the strict check behind `OAUTH_REQUIRE_STATE` (default `true`) and document in `DEPLOYMENT.md` that it must stay true while the install link is the agency-initiated one. Do not silently allow a missing cookie.

- [ ] **Step 4 (RED)**: `test/api/uninstall.test.ts` — a POST with a valid HMAC-SHA256 signature over the raw body deletes the `ghl_tokens` row for that location; an invalid signature returns 401 and deletes nothing; a replayed request is a no-op.

- [ ] **Step 5 (GREEN)**: Add `lib/webhook-hmac.ts` (`verifySignature(rawBody: string, header: string, secret: string): boolean`, `timingSafeEqual`, constant-time, returns false rather than throwing) and `app/api/webhooks/ghl/route.ts` handling the `UNINSTALL` event. Read the raw body before parsing — verifying a signature against a re-serialised object is a classic bypass.
  This module is the foundation Phase 9's signature callback consumes. Build it once, here.

- [ ] **Step 6**: Full suite GREEN, then commit: `feat(security): add OAuth state, uninstall webhook, and HMAC verification`.

---

## Task 4: Security headers and frame-ancestors

**Problem:** `next.config.ts` is empty. This app is designed to render in an iframe, which means any site on the internet can currently iframe `/admin` and clickjack a tenant admin into creating or deleting buttons.

- [ ] **Step 1 (RED)**: `test/headers.test.ts` asserting the `headers()` config returns `Content-Security-Policy` with a `frame-ancestors` directive listing only the allowed parents, plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Permissions-Policy` denying camera, microphone, and geolocation.

- [ ] **Step 2 (GREEN)**: Implement `headers()` in `next.config.ts`. Read the allowed frame parents from `ALLOWED_FRAME_ANCESTORS` (comma-separated) so the white-label domains are config, not code. Include `https://app.gohighlevel.com`, `https://app.coachscrm.com`, and any other white-label domain in production. **Do not use `frame-ancestors *`** — that is the same as having no protection.

- [ ] **Step 3 (GREEN)**: In `app/widget/useSso.ts` (the shared postMessage hook, consumed by both the widget and `app/admin/AdminGate.tsx`), validate `ev.origin` against the same allowlist before accepting a token. Server-side JWT verification stays the primary control; this closes the case where a hostile parent frame drives the widget with a token it obtained elsewhere.

- [ ] **Step 4**: Full suite GREEN, then commit: `feat(security): add CSP frame-ancestors and postMessage origin allowlist`.

---

## Task 5: Make the activity log an actual ledger

**Problem:** `0001_init.sql` says `activity_log` is append-only "by convention, not enforced at the schema level." And `soa_sent_at` is stamped when the GHL enroll call returns 200, which proves a contact entered a workflow and nothing more. Under a CMS audit that column is a claim the system cannot support.

- [ ] **Step 1 (RED)**: `test/db/activity-log-immutable.test.ts` — as `app_runtime`, an `UPDATE` on an existing `activity_log` row raises an exception; a `DELETE` raises an exception; an `INSERT` still succeeds.

- [ ] **Step 2 (GREEN)**: `supabase/migrations/0007_activity_log_immutable.sql`:
  - `REVOKE UPDATE, DELETE ON activity_log FROM app_runtime;`
  - plus a `BEFORE UPDATE OR DELETE` trigger that raises, so a future privilege change cannot silently re-open the hole. Two layers, because a control that exists in one place is a control that disappears in one commit.

- [ ] **Step 3 (GREEN)**: `supabase/migrations/0008_rename_soa_sent_at.sql` renames `soa_sent_at` to `soa_requested_at` and renames the two dependent indexes to match.

- [ ] **Step 4 (GREEN)**: Rename through the stack: `entryToJson` in `app/api/enroll/route.ts` and `app/api/log/route.ts` emit `soaRequestedAt`; `lastSoaSentAt` becomes `lastSoaRequestedAt`; `app/widget/types.ts` follows (there is no `app/admin/types.ts`; the admin components define local types). Grep `soaSentAt` and `lastSoaSentAt` across `app/` and rename every hit, including `app/admin/ActivityTab.tsx` and `app/widget/ActivityPanel.tsx`. The widget label changes from "SOA last sent" to "SOA requested". Update the code comment to state plainly that this timestamp records a workflow enrollment, and that delivery, view, and signature evidence arrive in Phase 9.

- [ ] **Step 5**: Full suite GREEN, then commit: `refactor(compliance): enforce activity_log immutability and rename soa_sent_at to soa_requested_at`.

---

## Task 6: Bound enroll abuse and cost

**Problem:** `checkRateLimit` allows 10 enrollments per minute per user with no per-location ceiling, no dedupe, and no cleanup of the `rate_limits` table. Every enrollment fires a GHL workflow that sends email and SMS. A double-click sends a beneficiary two SOAs, which is both a Twilio charge and an audit smell.

- [ ] **Step 1 (RED)**: Extend `test/api/enroll.test.ts` — the same `(locationId, buttonId, contactId)` posted twice inside the dedupe window returns 200 with the original log entry and calls GHL exactly once (assert via the MSW handler call count); outside the window it enrolls again; exceeding the per-location daily cap returns 429 with `{ error: 'daily_cap' }`.

- [ ] **Step 2 (GREEN)**: `supabase/migrations/0009_enroll_idempotency.sql` — a unique partial index on `(location_id, button_id, contact_id, date_trunc('minute', triggered_at))` is too coarse; instead add an `idempotency_key text` column plus a unique index, and have the route compute the key as a SHA-256 of `location_id|button_id|contact_id|<5-minute bucket>`. On unique violation, return the existing row rather than calling GHL.

- [ ] **Step 3 (GREEN)**: Add a per-location daily counter. Extend `rate_limit_check` or add `daily_cap_check(location_id, max_per_day)`. Default 200/day, overridable per location later. Return 429 before any GHL call.

- [ ] **Step 4 (GREEN)**: Add a cleanup path for `rate_limits` — a `DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'` in a `pg_cron` job, or a 1-in-100 probabilistic sweep inside `checkRateLimit`. Prefer `pg_cron` on Supabase; document the alternative if the extension is unavailable.

- [ ] **Step 5**: Full suite GREEN, then commit: `feat(enroll): add idempotency, per-location daily cap, and rate-limit cleanup`.

---

## Definition of done for Phase 8

- [ ] `yarn test` green, case count at or above 238 plus the new cases
- [ ] `yarn lint` clean
- [ ] `yarn build` succeeds
- [ ] Manual verification against a staging sub-account: install flow completes, a button fires an enrollment, the activity log shows the entry, a second identical click does not double-fire
- [ ] `DEPLOYMENT.md` updated with `TOKEN_ENC_KEY`, `ALLOWED_FRAME_ANCESTORS`, `OAUTH_REQUIRE_STATE`, `GHL_WEBHOOK_SECRET`, and the `app_runtime` connection string change
- [ ] Design doc §14 updated: two deferred items are now closed, webhook HMAC is now partially delivered
- [ ] PR opened against `main` with the checklist above in the description

**Not done until:** the token encryption backfill has been run against production and verified with a row count, because migration 0006 drops the plaintext columns.

---

## Deferred out of this phase, deliberately

- `triggered_by_user_name` still stores the userId because the SSO payload does not carry a name. A compliance record needs the agent's real name and NPN. That is a GHL users lookup, and it belongs with the Phase 9 ledger work where the NPN is actually needed.
- Encryption key rotation. `v1:` prefix in the wire format is the seam for it. Not needed until there is a reason to rotate.
- E2E browser tests. Still a v1 non-goal.
