@AGENTS.md

# CoachG Workflow Buttons

A GoHighLevel Marketplace app. Insurance agents open a contact record in GHL, see a grid of configurable buttons in an embedded iframe, and click one to enroll that contact into a GHL workflow. The primary workflow sends a Scope of Appointment (SOA), a CMS compliance requirement for Medicare Advantage sales.

Installed per sub-account (GHL calls these "locations"). Headed for fleet-wide install across every client in the CoachG CRM agency.

## Stack

Next.js 16 App Router, React 19, TypeScript strict, Tailwind 4, Zod 4, `postgres` driver against Supabase Postgres, `jsonwebtoken` for GHL SSO. Vitest with PGlite for DB tests and MSW for HTTP mocking. Deployed on Vercel.

## Commands

```
yarn dev            # local dev server
yarn test           # full suite, must be green before any commit
yarn test:watch     # TDD loop
yarn test:related   # tests related to changed files
yarn lint
yarn build
```

## Architecture

```
GHL contact record
  └─ iframe → /widget → useSso() postMessage handshake → SSO JWT
       └─ apiFetch injects X-GHL-SSO on every request
            └─ withSso / withAdminSso verifies HS256 with GHL_SSO_KEY
                 └─ route handler, scoped to sso.locationId
                      └─ getTenantDb(locationId) → Postgres
                      └─ getGhlClient(locationId) → GHL API v2
```

- `lib/auth.ts` — `withSso` and `withAdminSso` route wrappers
- `lib/ghl-sso.ts` — SSO JWT verification, fails closed, never throws
- `lib/ghl-oauth.ts` — authorization code exchange and refresh
- `lib/ghl.ts` — per-location API client, refreshes 60s before expiry, retries a 401 exactly once
- `lib/db.ts` — narrow `QueryClient` interface so PGlite can stand in for `postgres` in tests
- `lib/client-sso.ts` — decode-without-verify for the UX role gate, never a security control
- `lib/validation.ts` — all Zod schemas, every one `.strict()`
- `lib/rate-limit.ts` — atomic increment-and-check via a Postgres function

## Security invariants

These are not style preferences. Breaking one is a blocking review failure.

1. **`sso.locationId` is the only authoritative tenant identifier.** Query params, request bodies, and URL segments are UX hints. Never derive tenancy from them.
2. **Every query stays scoped in application code** with `AND location_id = $n`, even after RLS lands. RLS is the second layer, not a replacement.
3. **Every mutation route uses `withAdminSso`.** Reads may use `withSso`.
4. **Every input goes through a `.strict()` Zod schema** before it reaches the database or the GHL API. Unknown keys are rejected, not ignored.
5. **Client-side JWT decoding is UX only.** `lib/client-sso.ts` (`decodeSsoForDisplay`) does not verify a signature. `app/admin/AdminGate.tsx` uses it to choose what to render; the 403 from `withAdminSso` is the real control. Never gate anything client-side that the server does not re-check.
6. **No secret in client code, logs, error messages, or redirect URLs.** Browser code is published code.
7. **Fail closed.** A missing token, an unset tenant context, or an unverifiable signature produces zero rows or a 401, never a permissive default.
8. **Every webhook receiver verifies HMAC over the raw body** before parsing. Never verify against a re-serialised object.
9. **`activity_log` is a compliance ledger.** Append-only. Do not add an update or delete path.

## Testing conventions

- TDD is mandatory: failing test first, confirm it fails for the right reason, then the minimum code to pass. Code written before its test gets deleted and rewritten.
- DB tests use PGlite via `test/db/setup.ts`, which runs the real migration files. A test that does not exercise the real schema is not a DB test.
- RLS tests must `SET ROLE app_runtime`. PGlite runs as superuser and superusers bypass RLS, so a test that forgets this passes for the wrong reason. Always assert the negative case too.
- HTTP calls to GHL are mocked with MSW (`test/msw-server.ts`). Never hit the live API from a test.
- Tests that mutate `process.env` must call `resetDbForTests()` in `afterEach`.

## Git conventions

- One logical change per commit. Conventional commit prefixes: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- Work on a branch named for the phase, e.g. `phase-8-security-hardening`. Never commit directly to `master` (this repo's default branch is `master`, not `main`).
- Never commit `.env*`. Never commit a real token, key, or location ID.
- Open a PR with the plan's definition-of-done checklist in the description.

## Planning convention

Specs live in `docs/superpowers/specs/`, phase plans in `docs/superpowers/plans/`, named `YYYY-MM-DD-phase-N-slug.md`. Plans are the contract. Once approved, changing scope means a new plan, not a silent edit.

## Current state

Phases 0 through 7 are complete: test infrastructure, schema, OAuth callback, SSO verification, GHL client, buttons CRUD, enroll/log/rate-limit, the widget UI, and the admin UI (`AdminGate`, `Tabs`, `ButtonTable`, `ButtonFormModal`, `ActivityTab`). 238 test cases across 39 files.

Phase 8 (security hardening) is the active plan. Phase 9 (the SOA signing surface) is specced separately and depends on Phase 8's HMAC module.

## Known limitations, stated plainly

- `activity_log.soa_requested_at` records a **workflow enrollment**, not delivery, not viewing, not a signature. It is not sufficient evidence for a CMS audit on its own. Phase 9 adds the document, the scope the beneficiary selected, the signature timestamp, and the content hash.
- Every auth path in this codebase assumes a GHL user inside a GHL iframe. The beneficiary who signs an SOA has no GHL session and never will. That surface needs single-use token auth, and it does not exist yet.
