# Phase 2: OAuth Callback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/api/oauth/callback` — the Next.js route handler GHL hits after a sub-account installs the marketplace app. It exchanges the auth code for an access + refresh token pair, persists them to `ghl_tokens`, and redirects the installer to `/admin?locationId={locationId}`. Phase ends with the route handler tested end-to-end against a real Postgres (PGlite in tests; the user's Supabase project in production once provisioned), with a `phase-2-complete` tag.

**Architecture:** Direct Postgres connection (the `postgres` package) rather than the Supabase JS client + PostgREST. This lets the same code run unchanged against PGlite in tests and against the user's Supabase project in production — both speak the Postgres wire protocol. A thin DB-client interface (`QueryClient` in `lib/db.ts`) is the only abstraction needed; production composes it from the `postgres` driver, tests compose it from a fresh PGlite instance with the Phase 1 migration applied.

**Tech Stack:** `postgres@^3` (Porsager's library — modern, ESM-native, no transitive deps). MSW (already installed) for mocking GHL's token endpoint. PGlite (already installed) for the test DB. Existing Vitest + Next.js 16 route handlers.

**Spec reference:** `docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md` sections 7 (API routes), 13 (env vars), 14 (resolved decisions item 2: enrollment endpoint host), and section 6 (`ghl_tokens` table).

**Spec deviation (intentional, documented here):** The spec section 8 mentions `lib/supabase.ts` and section 13 lists `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. We're using `lib/db.ts` + `DATABASE_URL` instead because:
- Direct Postgres is faster than going through PostgREST (one network hop instead of two).
- The "no DB mocking" testing stance (spec section 11) is much cleaner with a direct connection — PGlite is wire-protocol-compatible, PostgREST is not.
- We don't need any PostgREST features (RLS, realtime, storage); spec section 6 explicitly turns RLS off for v1.
- Switching back to `@supabase/supabase-js` later is a small, isolated change in `lib/db.ts` if a future need arises.

The spec doc will be updated as part of Task 1's commit to reflect this decision.

**Out of scope for Phase 2:**
- The full GHL API client (`lib/ghl.ts` with token refresh on 401) — that's Phase 3.
- The SSO verification helper (`lib/ghl-sso.ts`) — that's Phase 2.5.
- Any UI under `app/admin/` or `app/widget/` — Phases 6 and 7. The OAuth redirect target (`/admin?locationId=...`) is a 302 to a route that doesn't exist yet; the test asserts the redirect Location header without requiring the destination to render.
- Encryption-at-rest for tokens — deferred to v2 (spec section 14).

**Reference docs to skim before starting:**
- Next.js 16 Route Handlers: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
- Next.js 16 `NextResponse.redirect`: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-response.md`
- `postgres` (npm package) README: https://github.com/porsager/postgres
- GHL OAuth token endpoint reference: documented in the design spec section 14 item 2.

**Important repo conventions (carry-overs from Phases 0 + 1):**
- TypeScript strict; ESM throughout; Node 20.11+.
- Vitest with `globals: false` — explicit imports of `describe, expect, it`, etc.
- Default environment `node`. MSW is wired in `vitest.setup.ts` with `onUnhandledRequest: 'error'` — every external HTTP call in a test MUST have a `server.use(...)` handler or the test fails loudly.
- Test timeout is 20s (set in Phase 1 to tolerate PGlite cold-start). Don't lower it.
- Co-located tests: `lib/foo.ts` → `lib/foo.test.ts`. Route handler tests live under `test/api/` next to a route fixture.
- Migration applied to test PGlite via the existing `test/db/setup.ts::createTestDb()` helper from Phase 1.

---

## How testing route handlers works

Next.js 16 route handlers are plain async functions exported from `app/.../route.ts`:

```ts
export async function GET(request: NextRequest): Promise<Response> { ... }
```

Tests invoke them by constructing a `NextRequest` and calling the exported function directly — no HTTP server, no Vercel runtime, no Next.js boot. Production wires this same function to the file-system route.

The DB is injected, not imported as a singleton. `app/api/oauth/callback/route.ts` calls `getDb()` from `@/lib/db`; tests use `vi.doMock('@/lib/db', ...)` to swap in a PGlite-backed `QueryClient` for the duration of a test. This is the testing pattern Phase 3+ will copy.

---

## File map

**Created:**
- `lib/env.ts` — typed env-var access; throws clear errors on missing required vars
- `lib/db.ts` — `QueryClient` interface + production singleton factory backed by `postgres`
- `lib/ghl-oauth.ts` — single function `exchangeCode(code, redirectUri)`; calls GHL's token endpoint and returns the parsed token payload
- `app/api/oauth/callback/route.ts` — the route handler
- `test/api/route-helpers.ts` — small utility for building `NextRequest` instances in tests
- `test/api/db-fixture.ts` — helper that creates a fresh PGlite, applies the Phase 1 migration, and returns a `QueryClient` that can be plugged into `vi.doMock('@/lib/db', ...)`
- `test/api/oauth-callback.test.ts` — integration tests for the route handler
- `lib/ghl-oauth.test.ts` — unit tests for the token-exchange helper (MSW only, no DB)
- `lib/env.test.ts` — unit tests for env var helper

**Modified:**
- `package.json` — adds `postgres` runtime dep
- `docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md` — updates sections 8 and 13 to reflect the `lib/db.ts` + `DATABASE_URL` decision
- `.env.local` — gets a `DATABASE_URL` entry (the user fills the actual value)

Each file has one responsibility:
- `lib/env.ts` — env var validation and typed access. Nothing else.
- `lib/db.ts` — DB client construction and the shape tests can swap. No business logic.
- `lib/ghl-oauth.ts` — the GHL token-exchange call. No DB writes, no redirects.
- `app/api/oauth/callback/route.ts` — composition only: read query, call `exchangeCode`, upsert via `getDb()`, return redirect.

---

## Task 1: Env var helper

**Files:**
- Create: `lib/env.ts`
- Create: `lib/env.test.ts`
- Modify: `docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md` (section 13 — replace SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY with DATABASE_URL)

- [ ] **Step 1: Write the failing test**

Create `lib/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getEnv } from './env'

describe('getEnv', () => {
  it('returns the value when the env var is set', () => {
    process.env.COACHG_TEST_VAR = 'hello'
    expect(getEnv('COACHG_TEST_VAR')).toBe('hello')
    delete process.env.COACHG_TEST_VAR
  })

  it('throws a helpful error when the env var is missing', () => {
    delete process.env.COACHG_TEST_VAR
    expect(() => getEnv('COACHG_TEST_VAR')).toThrow(
      'Missing required env var: COACHG_TEST_VAR',
    )
  })

  it('throws when the env var is set to an empty string', () => {
    process.env.COACHG_TEST_VAR = ''
    expect(() => getEnv('COACHG_TEST_VAR')).toThrow(
      'Missing required env var: COACHG_TEST_VAR',
    )
    delete process.env.COACHG_TEST_VAR
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- lib/env.test.ts
```

Expected: 3 tests, all FAIL with `Cannot find module './env'`.

- [ ] **Step 3: Implement `lib/env.ts`**

Create `lib/env.ts`:

```ts
/**
 * Read a required server-side env var. Throws a clear error if missing or empty
 * so failures surface at boot, not deep inside a request handler.
 *
 * Never expose this to client-side code — there's nothing here that handles
 * NEXT_PUBLIC_* differently; the assumption is server-only.
 */
export function getEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npm test -- lib/env.test.ts
```

Expected: 3 passed, 0 failed.

- [ ] **Step 5: Update the design spec to reflect the env-var decision**

Open `docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md` and find section 13 ("Environment variables"). The block currently reads:

```
NEXT_PUBLIC_APP_URL=
GHL_CLIENT_ID=
GHL_CLIENT_SECRET=
GHL_SSO_KEY=            # shared secret for decrypting marketplace SSO tokens
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Replace those last two lines so the full block becomes:

```
NEXT_PUBLIC_APP_URL=
GHL_CLIENT_ID=
GHL_CLIENT_SECRET=
GHL_SSO_KEY=            # shared secret for verifying marketplace SSO JWTs (HS256)
DATABASE_URL=           # full Postgres connection string (Supabase or local)
```

Also find section 8 ("lib/ structure"), which currently lists `lib/supabase.ts`. Replace that single line with:

```
- **`lib/db.ts`** — singleton DB client built from `DATABASE_URL` via the `postgres` package. Exports `getDb(): QueryClient` and the `QueryClient` interface tests use to swap in PGlite. Direct Postgres rather than `@supabase/supabase-js`/PostgREST so the same code path works against PGlite in tests and Supabase in production.
```

- [ ] **Step 6: Commit**

```bash
git add lib/env.ts lib/env.test.ts docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md
git commit -m "feat(lib): add typed env var helper (lib/env.ts)

getEnv(name) returns the string or throws a clear error if missing
or empty. Updates the design spec sections 8 and 13 to reflect the
move from @supabase/supabase-js + PostgREST to direct Postgres via
the 'postgres' package — same code path in tests (PGlite) and
production (Supabase Postgres)."
```

---

## Task 2: DB client (lib/db.ts)

**Files:**
- Modify: `package.json` (install `postgres`)
- Create: `lib/db.ts`
- Create: `lib/db.test.ts`

- [ ] **Step 1: Install the `postgres` driver**

```bash
npm install postgres@^3
```

Expected: install succeeds. `postgres` lands in `dependencies` (NOT devDependencies — production code needs it).

- [ ] **Step 2: Write the failing test**

Create `lib/db.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetDbForTests } from './db'

describe('lib/db.ts', () => {
  afterEach(() => {
    resetDbForTests()
    vi.unstubAllEnvs()
  })

  it('exports a QueryClient interface with query() and end()', async () => {
    // The interface is structural; we assert by importing and inspecting.
    const mod = await import('./db')
    expect(typeof mod.getDb).toBe('function')
    expect(typeof mod.resetDbForTests).toBe('function')
  })

  it('getDb() throws when DATABASE_URL is missing', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const { getDb } = await import('./db')
    expect(() => getDb()).toThrow('Missing required env var: DATABASE_URL')
  })
})
```

Note: We deliberately do NOT test "getDb() returns a working client connected to real Postgres" here. That requires either a real DB or PGlite, which is the job of the route-handler tests (Task 4+). This file's tests are pure unit tests for the factory and the failure mode.

- [ ] **Step 3: Run the test and verify it fails**

```bash
npm test -- lib/db.test.ts
```

Expected: tests FAIL with `Cannot find module './db'`.

- [ ] **Step 4: Implement `lib/db.ts`**

Create `lib/db.ts`:

```ts
import postgres from 'postgres'
import { getEnv } from './env'

/**
 * Minimal DB shape this app needs. Both `postgres` and PGlite can implement
 * it trivially, so tests swap PGlite in for `postgres` without changing
 * application code. Keep this interface narrow — only add methods we use.
 */
export interface QueryClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>
  end(): Promise<void>
}

let cached: QueryClient | null = null

/**
 * Production DB client backed by the `postgres` driver. Cached as a singleton
 * for the process lifetime. Reads DATABASE_URL on first call so test code
 * can override the env first.
 */
export function getDb(): QueryClient {
  if (cached) return cached
  const url = getEnv('DATABASE_URL')
  const sql = postgres(url, { prepare: false })
  cached = {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      const rows = (await sql.unsafe<T[]>(text, params as never)) as T[]
      return { rows }
    },
    async end() {
      await sql.end()
    },
  }
  return cached
}

/**
 * Test-only escape hatch: clears the singleton so the next getDb() call
 * re-reads DATABASE_URL. Used by tests that mutate process.env between cases.
 */
export function resetDbForTests(): void {
  cached = null
}
```

Notes for the implementer:
- `{ prepare: false }` is intentional. Supabase's connection pooler ("Transaction" mode) doesn't support prepared statements; `postgres` defaults to using them. Disabling keeps us compatible with both pooled (`6543`) and direct (`5432`) Supabase connections.
- `sql.unsafe()` is the right escape hatch for hand-written SQL with `$1, $2` placeholders. It's "unsafe" only in the sense that it doesn't get the tagged-template injection protection — our app passes parameters separately, so this is fine.

- [ ] **Step 5: Run the test and verify it passes**

```bash
npm test -- lib/db.test.ts
```

Expected: 2 passed.

Also run the full suite once to confirm nothing else regressed:

```bash
npm test
```

Expected: 46 passed (41 from Phases 0 + 1, plus 3 env tests, plus 2 db tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/db.ts lib/db.test.ts
git commit -m "feat(lib): add lib/db.ts — direct Postgres client singleton

Backed by the 'postgres' driver. Exports a narrow QueryClient
interface so tests can swap in a PGlite-backed implementation
without touching application code. Disables prepared statements
to stay compatible with Supabase's transaction-mode pooler."
```

---

## Task 3: GHL OAuth token-exchange helper

**Files:**
- Create: `lib/ghl-oauth.ts`
- Create: `lib/ghl-oauth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ghl-oauth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw-server'
import { exchangeCode } from './ghl-oauth'

const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token'

describe('exchangeCode', () => {
  it('exchanges an auth code for tokens and returns the parsed payload', async () => {
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        const body = await request.text()
        expect(body).toContain('grant_type=authorization_code')
        expect(body).toContain('code=abc123')
        expect(body).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fapi%2Foauth%2Fcallback')
        expect(body).toContain('client_id=cid')
        expect(body).toContain('client_secret=csecret')
        return HttpResponse.json({
          access_token: 'at_xyz',
          refresh_token: 'rt_xyz',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'workflows.readonly contacts.write',
          userType: 'Location',
          locationId: 'loc_abc',
          companyId: 'co_abc',
          userId: 'usr_abc',
        })
      }),
    )

    const result = await exchangeCode({
      code: 'abc123',
      redirectUri: 'https://app.example.com/api/oauth/callback',
      clientId: 'cid',
      clientSecret: 'csecret',
    })

    expect(result).toEqual({
      accessToken: 'at_xyz',
      refreshToken: 'rt_xyz',
      expiresIn: 3600,
      locationId: 'loc_abc',
    })
  })

  it('throws when GHL returns a non-2xx response', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
      ),
    )

    await expect(
      exchangeCode({
        code: 'bad',
        redirectUri: 'https://app.example.com/api/oauth/callback',
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    ).rejects.toThrow(/GHL token exchange failed: 400/)
  })

  it('throws when the token response is missing required fields', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: 'at_only',
          // refresh_token, expires_in, locationId all missing
        }),
      ),
    )

    await expect(
      exchangeCode({
        code: 'abc',
        redirectUri: 'https://app.example.com/api/oauth/callback',
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    ).rejects.toThrow(/GHL token response missing required field/)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- lib/ghl-oauth.test.ts
```

Expected: 3 FAIL with `Cannot find module './ghl-oauth'`.

- [ ] **Step 3: Implement `lib/ghl-oauth.ts`**

Create `lib/ghl-oauth.ts`:

```ts
const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token'

export interface ExchangeCodeInput {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}

export interface ExchangeCodeResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  locationId: string
}

/**
 * Exchange an OAuth authorization code for an access/refresh token pair.
 * Calls GHL's token endpoint with form-encoded body (which is what the GHL
 * Marketplace spec requires; JSON is rejected).
 *
 * Throws on non-2xx or on a payload that's missing any required field.
 * Returns only the fields downstream code uses — extras like userId/scope
 * are intentionally dropped to keep callers honest about what's persisted.
 */
export async function exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    throw new Error(`GHL token exchange failed: ${res.status}`)
  }

  const payload = (await res.json()) as Record<string, unknown>

  const accessToken = payload.access_token
  const refreshToken = payload.refresh_token
  const expiresIn = payload.expires_in
  const locationId = payload.locationId

  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresIn !== 'number' ||
    typeof locationId !== 'string'
  ) {
    throw new Error('GHL token response missing required field')
  }

  return { accessToken, refreshToken, expiresIn, locationId }
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npm test -- lib/ghl-oauth.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/ghl-oauth.ts lib/ghl-oauth.test.ts
git commit -m "feat(lib): add GHL OAuth code-exchange helper

POST application/x-www-form-urlencoded to GHL's token endpoint
and return a narrow result type containing only the fields we
persist to ghl_tokens. Validates the response shape — throws on
non-2xx or any missing required field."
```

---

## Task 4: Route-handler test harness + DB fixture

**Files:**
- Create: `test/api/route-helpers.ts`
- Create: `test/api/db-fixture.ts`
- Create: `test/api/harness.test.ts` (temporary; deleted in Task 7)

- [ ] **Step 1: Create `test/api/route-helpers.ts`**

```ts
import { NextRequest } from 'next/server'

/**
 * Build a NextRequest for unit-testing route handlers. The URL must be
 * absolute (NextRequest requires a fully-formed URL). Origin is irrelevant
 * to the tests but must parse; we use a literal example.com.
 */
export function makeGet(path: string, searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL(`https://test.example.com${path}`)
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v)
  }
  return new NextRequest(url)
}
```

- [ ] **Step 2: Create `test/api/db-fixture.ts`**

```ts
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { QueryClient } from '@/lib/db'

const MIGRATION_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '0001_init.sql',
)

/**
 * Boots a fresh PGlite, applies the Phase 1 migration, and wraps it in the
 * QueryClient shape from lib/db.ts. Tests use this with `vi.doMock('@/lib/db', ...)`
 * to swap the production singleton for a test instance.
 *
 * Always `await client.end()` in afterEach to release the WASM instance.
 */
export async function createTestQueryClient(): Promise<QueryClient & { _pglite: PGlite }> {
  const pg = new PGlite()
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  await pg.exec(sql)

  return {
    _pglite: pg,
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      const result = await pg.query<T>(text, params)
      return { rows: result.rows as T[] }
    },
    async end() {
      await pg.close()
    },
  }
}
```

- [ ] **Step 3: Write a verification test for the harness**

Create `test/api/harness.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { makeGet } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

describe('Phase 2 test harness', () => {
  it('makeGet builds a NextRequest with the expected URL', () => {
    const req = makeGet('/api/oauth/callback', { code: 'abc' })
    expect(req.method).toBe('GET')
    expect(req.nextUrl.pathname).toBe('/api/oauth/callback')
    expect(req.nextUrl.searchParams.get('code')).toBe('abc')
  })

  describe('createTestQueryClient', () => {
    let db: Awaited<ReturnType<typeof createTestQueryClient>> | null = null

    afterEach(async () => {
      if (db) {
        await db.end()
        db = null
      }
    })

    it('applies the migration and the four tables exist', async () => {
      db = await createTestQueryClient()
      const { rows } = await db.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `)
      expect(rows.map((r) => r.table_name)).toEqual([
        'activity_log',
        'buttons',
        'ghl_tokens',
        'rate_limits',
      ])
    })
  })
})
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npm test -- test/api/harness.test.ts
```

Expected: 2 passed (`makeGet` + `createTestQueryClient`).

Also run the full suite:

```bash
npm test
```

Expected: 48+ passed (Phase 0 + 1 = 41, env 3, db 2, ghl-oauth 3, harness 2). Exact count: 51.

- [ ] **Step 5: Commit**

```bash
git add test/api/route-helpers.ts test/api/db-fixture.ts test/api/harness.test.ts
git commit -m "test: add Phase 2 route-handler test harness

makeGet() constructs a NextRequest from a path + search params.
createTestQueryClient() spins up a fresh PGlite, applies the
Phase 1 migration, and returns a QueryClient that tests inject
via vi.doMock('@/lib/db', ...). The harness.test.ts file is
temporary verification — removed at end of phase."
```

---

## Task 5: OAuth callback happy path

**Files:**
- Create: `app/api/oauth/callback/route.ts`
- Create: `test/api/oauth-callback.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/api/oauth-callback.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../msw-server'
import { makeGet } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

describe('GET /api/oauth/callback', () => {
  let db: Awaited<ReturnType<typeof createTestQueryClient>> | null = null

  beforeEach(() => {
    vi.stubEnv('GHL_CLIENT_ID', 'cid')
    vi.stubEnv('GHL_CLIENT_SECRET', 'csecret')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
  })

  afterEach(async () => {
    if (db) {
      await db.end()
      db = null
    }
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('exchanges the code, upserts the token row, and redirects to /admin', async () => {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({
      getDb: () => db,
      resetDbForTests: () => {},
    }))

    server.use(
      http.post('https://services.leadconnectorhq.com/oauth/token', () =>
        HttpResponse.json({
          access_token: 'at_xyz',
          refresh_token: 'rt_xyz',
          expires_in: 3600,
          locationId: 'loc_abc',
        }),
      ),
    )

    const { GET } = await import('@/app/api/oauth/callback/route')
    const res = await GET(makeGet('/api/oauth/callback', { code: 'authcode' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('Location')).toBe(
      'https://app.example.com/admin?locationId=loc_abc',
    )

    const { rows } = await db.query<{
      location_id: string
      access_token: string
      refresh_token: string
    }>(`SELECT location_id, access_token, refresh_token FROM ghl_tokens`)
    expect(rows).toEqual([
      { location_id: 'loc_abc', access_token: 'at_xyz', refresh_token: 'rt_xyz' },
    ])
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- test/api/oauth-callback.test.ts
```

Expected: FAIL with `Cannot find module '@/app/api/oauth/callback/route'`.

- [ ] **Step 3: Implement the route handler**

Create `app/api/oauth/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { getDb } from '@/lib/db'
import { exchangeCode } from '@/lib/ghl-oauth'

export async function GET(request: NextRequest): Promise<Response> {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) {
    return new Response('Missing code parameter', { status: 400 })
  }

  const appUrl = getEnv('NEXT_PUBLIC_APP_URL')
  const clientId = getEnv('GHL_CLIENT_ID')
  const clientSecret = getEnv('GHL_CLIENT_SECRET')
  const redirectUri = `${appUrl}/api/oauth/callback`

  const tokens = await exchangeCode({
    code,
    redirectUri,
    clientId,
    clientSecret,
  })

  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString()

  await getDb().query(
    `INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (location_id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at`,
    [tokens.locationId, tokens.accessToken, tokens.refreshToken, expiresAt],
  )

  return NextResponse.redirect(
    `${appUrl}/admin?locationId=${encodeURIComponent(tokens.locationId)}`,
  )
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npm test -- test/api/oauth-callback.test.ts
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add app/api/oauth/callback/route.ts test/api/oauth-callback.test.ts
git commit -m "feat(api): add /api/oauth/callback happy path

Exchanges GHL's auth code for tokens, upserts the row into
ghl_tokens keyed by location_id, and 307-redirects the installer
to /admin?locationId=... Test exercises the full pipe through
PGlite, MSW-mocked GHL token endpoint, and the real route handler."
```

---

## Task 6: OAuth callback error paths

**Files:**
- Modify: `test/api/oauth-callback.test.ts` (add 3 new test cases)
- The route handler from Task 5 already handles the missing-code case; the other paths need no changes.

- [ ] **Step 1: Add the failing tests**

Open `test/api/oauth-callback.test.ts` and append these three `it` blocks INSIDE the existing `describe('GET /api/oauth/callback', ...)` block, after the existing "exchanges the code..." test:

```ts
  it('returns 400 when the code query param is missing', async () => {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({
      getDb: () => db,
      resetDbForTests: () => {},
    }))

    const { GET } = await import('@/app/api/oauth/callback/route')
    const res = await GET(makeGet('/api/oauth/callback'))

    expect(res.status).toBe(400)
    expect(await res.text()).toBe('Missing code parameter')

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ghl_tokens`,
    )
    expect(rows[0].count).toBe('0')
  })

  it('returns 502 when GHL returns a non-2xx token response', async () => {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({
      getDb: () => db,
      resetDbForTests: () => {},
    }))

    server.use(
      http.post('https://services.leadconnectorhq.com/oauth/token', () =>
        HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
      ),
    )

    const { GET } = await import('@/app/api/oauth/callback/route')
    const res = await GET(makeGet('/api/oauth/callback', { code: 'bad' }))

    expect(res.status).toBe(502)
    expect(await res.text()).toMatch(/GHL token exchange failed/)

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ghl_tokens`,
    )
    expect(rows[0].count).toBe('0')
  })

  it('returns 502 when GHL returns a malformed token response', async () => {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({
      getDb: () => db,
      resetDbForTests: () => {},
    }))

    server.use(
      http.post('https://services.leadconnectorhq.com/oauth/token', () =>
        HttpResponse.json({ access_token: 'only_this' }),
      ),
    )

    const { GET } = await import('@/app/api/oauth/callback/route')
    const res = await GET(makeGet('/api/oauth/callback', { code: 'abc' }))

    expect(res.status).toBe(502)
    expect(await res.text()).toMatch(/missing required field/)

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ghl_tokens`,
    )
    expect(rows[0].count).toBe('0')
  })
```

- [ ] **Step 2: Run the tests and verify the new ones fail**

```bash
npm test -- test/api/oauth-callback.test.ts
```

Expected: 4 tests total. The "missing code" test PASSES (already implemented in Task 5). The two 502 tests FAIL with status `500` (the unhandled error becomes a generic 500 from Next.js, not the 502 we want).

- [ ] **Step 3: Update the route handler to convert GHL errors into 502**

Replace the body of `app/api/oauth/callback/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { getDb } from '@/lib/db'
import { exchangeCode } from '@/lib/ghl-oauth'

export async function GET(request: NextRequest): Promise<Response> {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) {
    return new Response('Missing code parameter', { status: 400 })
  }

  const appUrl = getEnv('NEXT_PUBLIC_APP_URL')
  const clientId = getEnv('GHL_CLIENT_ID')
  const clientSecret = getEnv('GHL_CLIENT_SECRET')
  const redirectUri = `${appUrl}/api/oauth/callback`

  let tokens
  try {
    tokens = await exchangeCode({
      code,
      redirectUri,
      clientId,
      clientSecret,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GHL error'
    return new Response(message, { status: 502 })
  }

  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString()

  await getDb().query(
    `INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (location_id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at`,
    [tokens.locationId, tokens.accessToken, tokens.refreshToken, expiresAt],
  )

  return NextResponse.redirect(
    `${appUrl}/admin?locationId=${encodeURIComponent(tokens.locationId)}`,
  )
}
```

The only change is the `try/catch` around `exchangeCode` that returns a `502` with the original error message. The DB upsert stays outside the try/catch — if Postgres fails after a successful token exchange, that's a 500 and the user needs to investigate (rare; we don't have a retry strategy in v1).

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npm test -- test/api/oauth-callback.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add app/api/oauth/callback/route.ts test/api/oauth-callback.test.ts
git commit -m "feat(api): map GHL token-exchange failures to 502

Wraps the exchangeCode call in a try/catch so HTTP errors from
GHL surface as 502 Bad Gateway with the underlying error message.
Adds three error-path tests: missing code (400), GHL non-2xx (502),
GHL malformed response (502). All three assert ghl_tokens stayed
empty so a partial failure can't leave a half-written row."
```

---

## Task 7: Final verification + phase-2-complete tag

**Files:**
- Delete: `test/api/harness.test.ts` (verification test from Task 4; harness is now exercised by `test/api/oauth-callback.test.ts`)

- [ ] **Step 1: Remove the temporary harness verification**

```bash
git rm test/api/harness.test.ts
```

- [ ] **Step 2: Full test run**

```bash
npm test
```

Expected:
- Test Files: 11 passed (11)
- Tests: 54 passed (54)

Breakdown:
- Phase 0: 3 files × 3 tests = 9
- Phase 1: 5 files × {5, 8, 8, 4, 7} = 32
- Phase 2: 3 unit-test files (env: 3, db: 2, ghl-oauth: 3) = 8; 1 integration test file (oauth-callback: 4) = 4; harness was removed in Step 1.
- Total: 9 + 32 + 8 + 4 = 53. Plus Phase 0's harness verification was removed at end of Phase 0, so 53 is the right total. If the run shows 53 or 54, that's expected (depends on whether Phase 1 harness left an artifact — should be 53).

If the count is off, STOP and investigate before tagging.

- [ ] **Step 3: Lint check**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 4: Build check**

```bash
npm run build
```

Expected: build succeeds and the new route `/api/oauth/callback` appears in Next.js's route summary.

- [ ] **Step 5: Tag**

```bash
git tag phase-2-complete
```

- [ ] **Step 6: Commit cleanup if needed**

```bash
git status
```

If clean: nothing to do.
If anything is uncommitted: investigate before committing — `phase-2-complete` already points at the verified HEAD, and a follow-up commit would shift it.

---

## Verification checklist for the executor

- [ ] `npm test` exits 0 with 53 (or 54) passing tests
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `lib/env.ts`, `lib/db.ts`, `lib/ghl-oauth.ts` exist and export the documented APIs
- [ ] `app/api/oauth/callback/route.ts` exists and exports `GET`
- [ ] `test/api/route-helpers.ts` and `test/api/db-fixture.ts` exist
- [ ] `test/api/harness.test.ts` has been removed
- [ ] `package.json` has `postgres` in `dependencies` (NOT devDependencies)
- [ ] Design spec sections 8 and 13 updated to reflect `lib/db.ts` + `DATABASE_URL`
- [ ] Tag `phase-2-complete` exists pointing at HEAD
- [ ] `git status` clean

---

## What's NOT in Phase 2 (deferred)

- **`lib/ghl.ts`** — the full GHL API client with refresh-on-401 and the workflows/enroll methods. Phase 3.
- **`lib/ghl-sso.ts`** — SSO JWT verification. Phase 2.5.
- **Applying the migration to a real Supabase project.** Phase 1 produced the file; once a Supabase project is provisioned, the operational apply step runs separately. Phase 2's tests all run against PGlite.
- **The `/admin` UI** that the OAuth flow redirects to. Phase 7. The Phase 2 test asserts the redirect's `Location` header without requiring the destination to render.
- **CSRF protection on the OAuth callback.** Not in v1 scope — GHL's OAuth flow doesn't use a state parameter the way some providers do; the marketplace install model implicitly bounds who can hit this endpoint. Worth revisiting if/when we add user-initiated OAuth.
- **Token encryption-at-rest.** Deferred to v2.
- **Retry logic on GHL token-endpoint transient failures.** A single attempt is the v1 contract; the user re-runs the install if it fails. Worth instrumenting if we ever see this fail in practice.
