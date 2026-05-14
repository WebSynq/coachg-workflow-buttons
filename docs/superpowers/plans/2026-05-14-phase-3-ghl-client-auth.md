# Phase 3: GHL API Client + Route Auth HOFs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two server-side primitives every API route from Phase 4 onward will depend on:

1. `lib/ghl.ts` — a typed GHL API client created via `getGhlClient(locationId)`. It loads the OAuth token from `ghl_tokens`, transparently refreshes when it's within 60s of expiry OR when a downstream call returns 401, persists the new token, and exposes the two upstream calls we need today: `workflows.list()` and `contact.enroll(workflowId, contactId)`.
2. `lib/auth.ts` — `withSso(handler)` and `withAdminSso(handler)` higher-order route wrappers that pull the `X-GHL-SSO` header off a `NextRequest`, verify it via `verifySso`, and either invoke the inner handler with the decoded payload OR short-circuit with 401/403. Every route handler in Phase 4+ composes through these.

**Spec reference:** §3 architecture, §4 SSO flow, §5 roles, §7 routes table, §8 lib structure (the source of truth for both function shapes), §13 env vars.

**Architecture:**

```
lib/ghl-oauth.ts ─── exchangeCode (already exists)
                    └─ refreshAccessToken (added in this phase)

lib/ghl.ts ─── getGhlClient(locationId)
              ├─ loadToken(): reads ghl_tokens via getDb()
              ├─ persistToken(): UPDATE ghl_tokens with new access/refresh/expires
              ├─ ensureFresh(): if expires_at - now < 60s → refresh + persist
              ├─ request(method, path, body?): adds Authorization + Version: 2021-07-28
              │   └─ on 401: refresh + persist + retry once
              ├─ workflows.list(): GET /workflows/?locationId={loc}
              └─ contact.enroll(workflowId, contactId): POST /contacts/{contactId}/workflow/{workflowId} { eventStartTime }

lib/auth.ts ─── withSso(handler) / withAdminSso(handler)
                ├─ read req.headers.get('x-ghl-sso')
                ├─ verifySso(token) → SsoPayload | null
                ├─ null → 401
                ├─ admin variant: payload.role !== 'admin' → 403
                └─ otherwise: await handler(req, payload, ...extra)
```

**Tech Stack:** existing — `postgres` (via `lib/db.ts`), MSW for upstream mocks, PGlite for the DB in `lib/ghl.ts` tests, plain Vitest unit tests for `lib/auth.ts` (no DB, no MSW needed).

**Out of scope for Phase 3:**
- Any API route that *uses* `withSso` / `withAdminSso` or `getGhlClient` — those land in Phase 4 (buttons CRUD) and Phase 5 (enroll + log).
- `lib/validation.ts` (zod schemas) — Phase 4.
- `lib/rate-limit.ts` — Phase 5.
- A standalone `/api/workflows` route — Phase 4 (it's a thin wrapper around `getGhlClient(loc).workflows.list()`).
- Encryption-at-rest for stored tokens — deferred to v2 per spec §14.
- Webhook HMAC verification — deferred per spec §12.

**Reference docs to skim before starting:**
- Spec §8 (`lib/` structure) for the two function signatures
- Spec §7 for the routes that will eventually consume `withSso` / `withAdminSso`
- `lib/ghl-oauth.ts` and `lib/ghl-oauth.test.ts` — the existing `exchangeCode` is the pattern to mirror for `refreshAccessToken`
- `app/api/oauth/callback/route.ts` — the existing token persistence pattern (INSERT … ON CONFLICT) is what `lib/ghl.ts` will reuse on refresh
- `lib/ghl-sso.ts` — the `verifySso` primitive `lib/auth.ts` wraps

**Important repo conventions (carry-overs):**
- Strict TypeScript; ESM throughout; Node 20.11+.
- Vitest with `globals: false` — explicit imports of `describe, expect, it, beforeEach, afterEach, vi` from `'vitest'`.
- MSW is wired in `vitest.setup.ts` with `onUnhandledRequest: 'error'`. Tests register handlers per-case with `server.use(...)`.
- DB tests use `createTestQueryClient()` from `test/api/db-fixture.ts` and `vi.doMock('@/lib/db', …)` to swap PGlite in.
- Env vars are read at point-of-use via `getEnv()`; tests stub with `vi.stubEnv` + `vi.unstubAllEnvs` in `afterEach`.
- Co-located tests: `lib/ghl.ts` → `lib/ghl.test.ts`, `lib/auth.ts` → `lib/auth.test.ts`.

---

## File map

**Created:**
- `lib/ghl.ts` — `getGhlClient(locationId)` + types
- `lib/ghl.test.ts` — workflows.list, enroll, pre-expiry refresh, 401 retry, refresh failure
- `lib/auth.ts` — `withSso`, `withAdminSso` HOFs
- `lib/auth.test.ts` — missing header / invalid token / valid non-admin / valid admin / cross-method invocation

**Modified:**
- `lib/ghl-oauth.ts` — add `refreshAccessToken({ refreshToken, clientId, clientSecret })` that calls the same token endpoint with `grant_type=refresh_token`
- `lib/ghl-oauth.test.ts` — three new tests for `refreshAccessToken` (happy path, non-2xx, malformed)

No public API or schema changes; both files are pure additions.

---

## GHL API contract (this phase's view)

Base: `https://services.leadconnectorhq.com`
Required headers on every request:
- `Authorization: Bearer {accessToken}`
- `Version: 2021-07-28`
- `Accept: application/json`
- `Content-Type: application/json` (on requests with a JSON body)

Endpoints used:
- `GET /workflows/?locationId={loc}` → `{ workflows: [{ id, name, …other fields ignored }] }`
- `POST /contacts/{contactId}/workflow/{workflowId}` with body `{ "eventStartTime": "<ISO>" }` → 200/201 on success
- `POST /oauth/token` with `grant_type=refresh_token` (form-encoded) → same response shape as `exchangeCode`

Refresh trigger: `expires_at` is within 60s OR an authenticated call returns 401. Refresh persists the new access/refresh/expires_at to `ghl_tokens` then retries the original call exactly once. A second 401 surfaces as a thrown `Error('GHL request failed: 401 ...')` — we do NOT loop.

---

## Task 1: Add `refreshAccessToken` to `lib/ghl-oauth.ts`

**Files:**
- Modify: `lib/ghl-oauth.ts`
- Modify: `lib/ghl-oauth.test.ts`

- [ ] **Step 1: Write failing tests**

Append three tests to `lib/ghl-oauth.test.ts` mirroring the `exchangeCode` shape:

```ts
describe('refreshAccessToken', () => {
  it('exchanges a refresh token for a new access/refresh pair', async () => {
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        const body = await request.text()
        expect(body).toContain('grant_type=refresh_token')
        expect(body).toContain('refresh_token=rt_old')
        expect(body).toContain('client_id=cid')
        expect(body).toContain('client_secret=csecret')
        return HttpResponse.json({
          access_token: 'at_new',
          refresh_token: 'rt_new',
          expires_in: 3600,
          locationId: 'loc_abc',
        })
      }),
    )

    const result = await refreshAccessToken({
      refreshToken: 'rt_old',
      clientId: 'cid',
      clientSecret: 'csecret',
    })

    expect(result).toEqual({
      accessToken: 'at_new',
      refreshToken: 'rt_new',
      expiresIn: 3600,
      locationId: 'loc_abc',
    })
  })

  it('throws when GHL returns a non-2xx', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
      ),
    )

    await expect(
      refreshAccessToken({
        refreshToken: 'bad',
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    ).rejects.toThrow(/GHL token refresh failed: 400/)
  })

  it('throws when the refresh response is missing required fields', async () => {
    server.use(
      http.post(TOKEN_URL, () => HttpResponse.json({ access_token: 'only_this' })),
    )

    await expect(
      refreshAccessToken({
        refreshToken: 'rt_old',
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    ).rejects.toThrow(/GHL token response missing required field/)
  })
})
```

Update the import at the top: `import { exchangeCode, refreshAccessToken } from './ghl-oauth'`.

- [ ] **Step 2: Run, confirm RED**

```bash
npm test -- lib/ghl-oauth.test.ts
```

Expected: 3 failures (`refreshAccessToken is not exported`).

- [ ] **Step 3: Implement `refreshAccessToken`**

Append to `lib/ghl-oauth.ts`:

```ts
export interface RefreshInput {
  refreshToken: string
  clientId: string
  clientSecret: string
}

/**
 * Exchange a refresh token for a fresh access/refresh pair.
 * Same response shape as exchangeCode — caller persists the new tuple
 * and the new `expires_at` to ghl_tokens.
 */
export async function refreshAccessToken(input: RefreshInput): Promise<ExchangeCodeResult> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      detail
        ? `GHL token refresh failed: ${res.status} ${detail}`
        : `GHL token refresh failed: ${res.status}`,
    )
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

- [ ] **Step 4: Run, confirm GREEN**

```bash
npm test -- lib/ghl-oauth.test.ts
```

Expected: 6 passed (3 prior + 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/ghl-oauth.ts lib/ghl-oauth.test.ts
git commit -m "feat(lib): add refreshAccessToken() — refresh-grant token swap

Mirrors exchangeCode but with grant_type=refresh_token. lib/ghl.ts in
the next task uses this to swap a near-expiry token for a fresh pair
and persist the result to ghl_tokens."
```

---

## Task 2: Implement `lib/ghl.ts` — token loading + pre-expiry refresh

**Files:**
- Create: `lib/ghl.ts`
- Create: `lib/ghl.test.ts`

This task wires the DB load + freshness check + request helper. We add the two upstream methods (`workflows.list`, `contact.enroll`) in Task 3 so each step has its own RED/GREEN cycle.

- [ ] **Step 1: Write the failing tests for token freshness**

Create `lib/ghl.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw-server'
import { createTestQueryClient } from '../test/api/db-fixture'

const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token'

describe('getGhlClient', () => {
  let db: Awaited<ReturnType<typeof createTestQueryClient>> | null = null

  beforeEach(() => {
    vi.stubEnv('GHL_CLIENT_ID', 'cid')
    vi.stubEnv('GHL_CLIENT_SECRET', 'csecret')
  })

  afterEach(async () => {
    if (db) {
      await db.end()
      db = null
    }
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function seedToken(opts: {
    locationId: string
    accessToken: string
    refreshToken: string
    expiresAt: string
  }) {
    db = await createTestQueryClient()
    await db.query(
      `INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [opts.locationId, opts.accessToken, opts.refreshToken, opts.expiresAt],
    )
    vi.doMock('@/lib/db', () => ({
      getDb: () => db,
      resetDbForTests: () => {},
    }))
  }

  it('refreshes the token when it is within 60s of expiry, persists the new pair, and uses the new access token on subsequent calls', async () => {
    await seedToken({
      locationId: 'loc1',
      accessToken: 'at_old',
      refreshToken: 'rt_old',
      // 30s in the future — inside the 60s buffer
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    })

    let workflowsAuth: string | null = null
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: 'at_new',
          refresh_token: 'rt_new',
          expires_in: 3600,
          locationId: 'loc1',
        }),
      ),
      http.get('https://services.leadconnectorhq.com/workflows/', ({ request }) => {
        workflowsAuth = request.headers.get('Authorization')
        const url = new URL(request.url)
        expect(url.searchParams.get('locationId')).toBe('loc1')
        return HttpResponse.json({ workflows: [{ id: 'wf1', name: 'Welcome' }] })
      }),
    )

    const { getGhlClient } = await import('@/lib/ghl')
    const client = await getGhlClient('loc1')
    const workflows = await client.workflows.list()

    expect(workflows).toEqual([{ id: 'wf1', name: 'Welcome' }])
    expect(workflowsAuth).toBe('Bearer at_new')

    const { rows } = await db!.query<{
      access_token: string
      refresh_token: string
    }>(`SELECT access_token, refresh_token FROM ghl_tokens WHERE location_id = 'loc1'`)
    expect(rows[0]).toEqual({ access_token: 'at_new', refresh_token: 'rt_new' })
  })

  it('uses the existing access token when the token is more than 60s from expiry', async () => {
    await seedToken({
      locationId: 'loc2',
      accessToken: 'at_fresh',
      refreshToken: 'rt_fresh',
      expiresAt: new Date(Date.now() + 600_000).toISOString(), // 10 min
    })

    let workflowsAuth: string | null = null
    let refreshHits = 0
    server.use(
      http.post(TOKEN_URL, () => {
        refreshHits++
        return HttpResponse.json({}, { status: 500 })
      }),
      http.get('https://services.leadconnectorhq.com/workflows/', ({ request }) => {
        workflowsAuth = request.headers.get('Authorization')
        return HttpResponse.json({ workflows: [] })
      }),
    )

    const { getGhlClient } = await import('@/lib/ghl')
    const client = await getGhlClient('loc2')
    await client.workflows.list()

    expect(workflowsAuth).toBe('Bearer at_fresh')
    expect(refreshHits).toBe(0)
  })

  it('throws a clear error if no ghl_tokens row exists for the locationId', async () => {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({
      getDb: () => db,
      resetDbForTests: () => {},
    }))

    const { getGhlClient } = await import('@/lib/ghl')

    await expect(getGhlClient('missing_loc')).rejects.toThrow(
      /no ghl_tokens row for locationId=missing_loc/,
    )
  })
})
```

- [ ] **Step 2: Run, confirm RED**

```bash
npm test -- lib/ghl.test.ts
```

Expected: failures (`Cannot find module '@/lib/ghl'`).

- [ ] **Step 3: Implement `lib/ghl.ts` (minus the methods)**

Create `lib/ghl.ts`:

```ts
import { getDb } from './db'
import { getEnv } from './env'
import { refreshAccessToken } from './ghl-oauth'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_API_VERSION = '2021-07-28'
const REFRESH_BUFFER_MS = 60_000

export interface Workflow {
  id: string
  name: string
}

export interface GhlClient {
  workflows: {
    list(): Promise<Workflow[]>
  }
  contact: {
    enroll(workflowId: string, contactId: string): Promise<void>
  }
}

interface TokenRow {
  access_token: string
  refresh_token: string
  expires_at: string
}

async function loadToken(locationId: string): Promise<TokenRow> {
  const { rows } = await getDb().query<TokenRow>(
    `SELECT access_token, refresh_token, expires_at
     FROM ghl_tokens
     WHERE location_id = $1`,
    [locationId],
  )
  if (rows.length === 0) {
    throw new Error(`no ghl_tokens row for locationId=${locationId}`)
  }
  return rows[0]
}

async function persistToken(
  locationId: string,
  accessToken: string,
  refreshToken: string,
  expiresInSeconds: number,
): Promise<TokenRow> {
  // Same 60s safety margin as the OAuth callback uses on first install.
  const expiresAt = new Date(
    Date.now() + (expiresInSeconds - 60) * 1000,
  ).toISOString()
  await getDb().query(
    `UPDATE ghl_tokens
     SET access_token = $2, refresh_token = $3, expires_at = $4
     WHERE location_id = $1`,
    [locationId, accessToken, refreshToken, expiresAt],
  )
  return { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt }
}

function isExpiringSoon(expiresAt: string): boolean {
  return Date.parse(expiresAt) - Date.now() < REFRESH_BUFFER_MS
}

async function refreshAndPersist(locationId: string, refreshTokenStr: string): Promise<TokenRow> {
  const refreshed = await refreshAccessToken({
    refreshToken: refreshTokenStr,
    clientId: getEnv('GHL_CLIENT_ID'),
    clientSecret: getEnv('GHL_CLIENT_SECRET'),
  })
  return persistToken(
    locationId,
    refreshed.accessToken,
    refreshed.refreshToken,
    refreshed.expiresIn,
  )
}

/**
 * Build a per-locationId GHL API client. Loads the OAuth token from
 * ghl_tokens, refreshes it if it's within 60s of expiry, and exposes
 * the upstream calls this app uses. Every request is sent with
 * `Authorization: Bearer …` + `Version: 2021-07-28`. On a 401 from any
 * authenticated call, the client transparently refreshes the token,
 * persists the new pair, and retries the call exactly once. A second
 * 401 surfaces as an error — we do not loop.
 *
 * The client is intentionally NOT cached; each route handler gets a
 * fresh load. This avoids stale-token reuse across concurrent invocations
 * on the same Vercel instance, which would otherwise need a separate
 * lock to refresh once instead of N times.
 */
export async function getGhlClient(locationId: string): Promise<GhlClient> {
  let token = await loadToken(locationId)
  if (isExpiringSoon(token.expires_at)) {
    token = await refreshAndPersist(locationId, token.refresh_token)
  }

  async function authedRequest(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Version: GHL_API_VERSION,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }
    const res = await fetch(`${GHL_BASE}${path}`, init)
    if (res.status !== 401) return res

    // Single retry after a forced refresh.
    token = await refreshAndPersist(locationId, token.refresh_token)
    const retryInit: RequestInit = {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        Authorization: `Bearer ${token.access_token}`,
      },
    }
    return fetch(`${GHL_BASE}${path}`, retryInit)
  }

  return {
    workflows: {
      async list() {
        const res = await authedRequest('GET', `/workflows/?locationId=${encodeURIComponent(locationId)}`)
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`GHL request failed: ${res.status} ${detail}`.trim())
        }
        const payload = (await res.json()) as { workflows?: Array<{ id: string; name: string }> }
        const list = payload.workflows ?? []
        return list.map(({ id, name }) => ({ id, name }))
      },
    },
    contact: {
      async enroll(workflowId, contactId) {
        const res = await authedRequest(
          'POST',
          `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`,
          { eventStartTime: new Date().toISOString() },
        )
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`GHL request failed: ${res.status} ${detail}`.trim())
        }
      },
    },
  }
}
```

- [ ] **Step 4: Run, confirm GREEN for the three freshness tests**

```bash
npm test -- lib/ghl.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/ghl.ts lib/ghl.test.ts
git commit -m "feat(lib): add getGhlClient() — typed GHL API client with pre-expiry refresh

Loads the OAuth token from ghl_tokens for a given locationId; if the
stored expires_at is within 60s of now, refreshes via the OAuth refresh
grant and persists the new access/refresh/expires_at before returning
the client. Includes workflows.list() and contact.enroll().

401-retry and richer error surface come in the next task."
```

---

## Task 3: Lock in 401-retry + refresh-failure behavior

**Files:**
- Modify: `lib/ghl.test.ts`

The implementation already supports 401 retry; this task makes the contract explicit so a future refactor that breaks it fails loudly.

- [ ] **Step 1: Append the four behavior tests**

Append inside the `describe('getGhlClient', ...)` block:

```ts
  it('on a 401 from workflows.list, refreshes the token, persists it, and retries once with the new bearer', async () => {
    await seedToken({
      locationId: 'loc3',
      accessToken: 'at_stale',
      refreshToken: 'rt_stale',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    let workflowsHits = 0
    let refreshHits = 0
    const seenAuths: string[] = []
    server.use(
      http.post(TOKEN_URL, () => {
        refreshHits++
        return HttpResponse.json({
          access_token: 'at_post_retry',
          refresh_token: 'rt_post_retry',
          expires_in: 3600,
          locationId: 'loc3',
        })
      }),
      http.get('https://services.leadconnectorhq.com/workflows/', ({ request }) => {
        workflowsHits++
        seenAuths.push(request.headers.get('Authorization') ?? '')
        if (workflowsHits === 1) {
          return HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
        }
        return HttpResponse.json({ workflows: [{ id: 'wf1', name: 'X' }] })
      }),
    )

    const { getGhlClient } = await import('@/lib/ghl')
    const client = await getGhlClient('loc3')
    const workflows = await client.workflows.list()

    expect(workflows).toEqual([{ id: 'wf1', name: 'X' }])
    expect(workflowsHits).toBe(2)
    expect(refreshHits).toBe(1)
    expect(seenAuths).toEqual(['Bearer at_stale', 'Bearer at_post_retry'])

    const { rows } = await db!.query<{ access_token: string }>(
      `SELECT access_token FROM ghl_tokens WHERE location_id = 'loc3'`,
    )
    expect(rows[0].access_token).toBe('at_post_retry')
  })

  it('does not loop: a second 401 after the retry is surfaced as an error', async () => {
    await seedToken({
      locationId: 'loc4',
      accessToken: 'at_stale',
      refreshToken: 'rt_stale',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    let workflowsHits = 0
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: 'at_new',
          refresh_token: 'rt_new',
          expires_in: 3600,
          locationId: 'loc4',
        }),
      ),
      http.get('https://services.leadconnectorhq.com/workflows/', () => {
        workflowsHits++
        return HttpResponse.json({ error: 'still unauthorized' }, { status: 401 })
      }),
    )

    const { getGhlClient } = await import('@/lib/ghl')
    const client = await getGhlClient('loc4')

    await expect(client.workflows.list()).rejects.toThrow(/GHL request failed: 401/)
    expect(workflowsHits).toBe(2)
  })

  it('contact.enroll posts the documented body shape to the documented path and retries once on 401', async () => {
    await seedToken({
      locationId: 'loc5',
      accessToken: 'at_stale',
      refreshToken: 'rt_stale',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    let enrollHits = 0
    let lastBody: unknown = null
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: 'at_fresh',
          refresh_token: 'rt_fresh',
          expires_in: 3600,
          locationId: 'loc5',
        }),
      ),
      http.post(
        'https://services.leadconnectorhq.com/contacts/:contactId/workflow/:workflowId',
        async ({ request, params }) => {
          enrollHits++
          if (enrollHits === 1) {
            return HttpResponse.json({}, { status: 401 })
          }
          expect(params.contactId).toBe('contact-xyz')
          expect(params.workflowId).toBe('wf-abc')
          lastBody = await request.json()
          return HttpResponse.json({}, { status: 200 })
        },
      ),
    )

    const { getGhlClient } = await import('@/lib/ghl')
    const client = await getGhlClient('loc5')
    await client.contact.enroll('wf-abc', 'contact-xyz')

    expect(enrollHits).toBe(2)
    expect(lastBody).toEqual({
      eventStartTime: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
      ),
    })
  })

  it('surfaces a refresh failure (refresh endpoint returns 400) as a clean error', async () => {
    await seedToken({
      locationId: 'loc6',
      accessToken: 'at_old',
      refreshToken: 'rt_revoked',
      // Expiring soon — forces refresh on first call.
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
    })

    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
      ),
    )

    const { getGhlClient } = await import('@/lib/ghl')

    await expect(getGhlClient('loc6')).rejects.toThrow(/GHL token refresh failed: 400/)
  })
```

- [ ] **Step 2: Run, confirm GREEN**

```bash
npm test -- lib/ghl.test.ts
```

Expected: 7 passed (3 from Task 2 + 4 new).

Also run full suite:

```bash
npm test
```

Expected: 67 prior + 3 oauth + 7 ghl = 77 passing tests. (`lib/ghl.test.ts` is one new file, `lib/ghl-oauth.test.ts` grew by 3 tests.)

- [ ] **Step 3: Commit**

```bash
git add lib/ghl.test.ts
git commit -m "test(lib): lock in getGhlClient 401-retry + refresh-failure behavior

Four new tests cover the contract not yet asserted:
- on 401 from a downstream call, refresh + persist + retry once with
  the new bearer
- a second 401 after retry surfaces as a thrown error (no loop)
- contact.enroll posts the eventStartTime body shape to the documented
  path and is subject to the same 401-retry rule
- a refresh failure during pre-expiry refresh propagates a clean error
  instead of silently using a stale token"
```

---

## Task 4: Implement `lib/auth.ts` — withSso + withAdminSso HOFs

**Files:**
- Create: `lib/auth.ts`
- Create: `lib/auth.test.ts`

Pure-function HOFs over `verifySso`. No DB, no MSW.

- [ ] **Step 1: Write the failing tests**

Create `lib/auth.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { withSso, withAdminSso } from './auth'
import type { SsoPayload } from './ghl-sso'

const TEST_SECRET = 'test-sso-key-for-auth-tests'

function makeToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, TEST_SECRET, { algorithm: 'HS256', expiresIn: '1h' })
}

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://test.example.com/api/anything', { headers })
}

describe('withSso', () => {
  beforeEach(() => {
    vi.stubEnv('GHL_SSO_KEY', TEST_SECRET)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 when the X-GHL-SSO header is missing', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = withSso(handler)
    const res = await wrapped(makeReq())
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 401 when the token is invalid', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = withSso(handler)
    const res = await wrapped(makeReq({ 'x-ghl-sso': 'not.a.real.jwt' }))
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes the decoded payload to the handler on success', async () => {
    const token = makeToken({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'user',
    })
    const handler = vi.fn(async (_req: NextRequest, sso: SsoPayload) => {
      return Response.json({ sawLocation: sso.locationId, sawRole: sso.role })
    })
    const wrapped = withSso(handler)
    const res = await wrapped(makeReq({ 'x-ghl-sso': token }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sawLocation: 'l1', sawRole: 'user' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('forwards extra context arguments (e.g. Next.js route params) through to the handler', async () => {
    const token = makeToken({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'admin',
    })
    const handler = vi.fn(
      async (
        _req: NextRequest,
        _sso: SsoPayload,
        ctx: { params: Promise<{ id: string }> },
      ) => {
        const { id } = await ctx.params
        return Response.json({ id })
      },
    )
    const wrapped = withSso(handler)
    const res = await wrapped(
      makeReq({ 'x-ghl-sso': token }),
      { params: Promise.resolve({ id: 'btn-1' }) },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'btn-1' })
  })
})

describe('withAdminSso', () => {
  beforeEach(() => {
    vi.stubEnv('GHL_SSO_KEY', TEST_SECRET)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 when the X-GHL-SSO header is missing', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = withAdminSso(handler)
    const res = await wrapped(makeReq())
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 401 when the token is invalid', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = withAdminSso(handler)
    const res = await wrapped(makeReq({ 'x-ghl-sso': 'broken' }))
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 403 when the token is valid but the role is not admin', async () => {
    const token = makeToken({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'user',
    })
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = withAdminSso(handler)
    const res = await wrapped(makeReq({ 'x-ghl-sso': token }))
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('invokes the handler with the decoded payload when the role is admin', async () => {
    const token = makeToken({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'admin',
    })
    const handler = vi.fn(async (_req: NextRequest, sso: SsoPayload) =>
      Response.json({ role: sso.role }),
    )
    const wrapped = withAdminSso(handler)
    const res = await wrapped(makeReq({ 'x-ghl-sso': token }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ role: 'admin' })
  })
})
```

- [ ] **Step 2: Run, confirm RED**

```bash
npm test -- lib/auth.test.ts
```

Expected: failures (`Cannot find module './auth'`).

- [ ] **Step 3: Implement `lib/auth.ts`**

Create `lib/auth.ts`:

```ts
import { NextRequest } from 'next/server'
import { verifySso, type SsoPayload } from './ghl-sso'

const SSO_HEADER = 'x-ghl-sso'

/**
 * Higher-order route handler that pulls the GHL Marketplace SSO token
 * off the `X-GHL-SSO` request header, verifies it via `verifySso`, and
 * either invokes the inner handler with the decoded payload OR
 * short-circuits with 401.
 *
 * Extra positional arguments are forwarded through — this matches the
 * Next.js App Router contract where the second argument to a dynamic
 * route handler is `{ params: Promise<{...}> }`.
 *
 * The inner handler MUST treat `sso.locationId` as the only authoritative
 * tenant identifier. Query params and request bodies remain UX hints
 * only (spec §4, §12).
 */
export function withSso<Args extends unknown[]>(
  handler: (req: NextRequest, sso: SsoPayload, ...rest: Args) => Promise<Response>,
) {
  return async (req: NextRequest, ...rest: Args): Promise<Response> => {
    const token = req.headers.get(SSO_HEADER)
    if (!token) return new Response('Missing SSO token', { status: 401 })
    const sso = verifySso(token)
    if (!sso) return new Response('Invalid SSO token', { status: 401 })
    return handler(req, sso, ...rest)
  }
}

/**
 * Like `withSso`, but additionally enforces `sso.role === 'admin'`. Use
 * for every mutation endpoint surfaced through the admin UI (spec §5).
 * Returns 403 — never 401 — when the token is valid but the role
 * doesn't qualify; the distinction lets the client tell "you need to
 * re-auth" from "you need a different account."
 */
export function withAdminSso<Args extends unknown[]>(
  handler: (req: NextRequest, sso: SsoPayload, ...rest: Args) => Promise<Response>,
) {
  return withSso<Args>(async (req, sso, ...rest) => {
    if (sso.role !== 'admin') return new Response('Admin role required', { status: 403 })
    return handler(req, sso, ...rest)
  })
}
```

- [ ] **Step 4: Run, confirm GREEN**

```bash
npm test -- lib/auth.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/auth.test.ts
git commit -m "feat(lib): add withSso/withAdminSso route HOFs

Two thin wrappers over verifySso that every Phase 4+ route handler
composes through:
- withSso reads X-GHL-SSO, verifies it, and forwards the decoded
  payload to the inner handler. 401 on missing/invalid.
- withAdminSso additionally enforces role === 'admin', returning 403
  on a valid non-admin token so the client can distinguish 're-auth'
  from 'wrong account'.

Generic over extra positional args so Next.js dynamic-route handlers
that take { params } as the second arg compose without losing types."
```

---

## Task 5: Final verification + phase-3-complete tag

**Files:**
- None (verification only)

- [ ] **Step 1: Full test run**

```bash
npm test
```

Expected:
- Test Files: 15 passed (15)
- Tests: 82 passed (82)

Breakdown:
- Prior (phase-2.5-complete): 67 tests
- +3 in `lib/ghl-oauth.test.ts` (refreshAccessToken)
- +7 in new `lib/ghl.test.ts`
- +8 in new `lib/auth.test.ts`
- Total: 67 + 3 + 7 + 8 = 85

(Adjust this expected total in the verification step once the tests are written and the actual count is observed; the rule is `prior + delta`, not a hard-coded number.)

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: build succeeds. `lib/ghl.ts` and `lib/auth.ts` are referenced by no route yet (Phase 4 introduces the first consumers), so they won't show up in the route summary but will be type-checked.

- [ ] **Step 4: Tag**

```bash
git tag phase-3-complete
```

- [ ] **Step 5: Confirm git status clean**

```bash
git status
```

Expected: clean.

---

## Verification checklist for the executor

Before marking Phase 3 complete:

- [ ] `npm test` exits 0 with the new total documented in Task 5 Step 1
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `lib/ghl.ts` exports `getGhlClient` returning a typed `GhlClient`
- [ ] `lib/ghl-oauth.ts` exports `refreshAccessToken`
- [ ] `lib/auth.ts` exports `withSso` and `withAdminSso`
- [ ] All four test files have explicit `import` from `'vitest'` (globals: false)
- [ ] Tag `phase-3-complete` exists pointing at HEAD
- [ ] `git status` clean

---

## What's NOT in Phase 3 (deferred)

- **Any consumer route** — `/api/workflows`, `/api/buttons`, `/api/buttons/[id]`, `/api/buttons/reorder`, `/api/enroll`, `/api/log` all land in Phase 4 + 5.
- **`lib/validation.ts`** — Phase 4.
- **`lib/rate-limit.ts`** — Phase 5.
- **A token-cache layer** — `getGhlClient` re-reads the row on every call. A future phase can add a per-request memo if Vercel cold-start adds noticeable latency.
- **Concurrency-safe refresh** — if two parallel requests on the same instance both find the token expiring, both will issue a refresh; whichever finishes second wins. GHL accepts a stale refresh once during its rotation window, so the second persist is harmless. If this ever stops being true, add an in-process lock keyed by locationId.
- **`iss`/`aud`/`jti` claim checks** on the SSO token — deferred per Phase 2.5 notes.
