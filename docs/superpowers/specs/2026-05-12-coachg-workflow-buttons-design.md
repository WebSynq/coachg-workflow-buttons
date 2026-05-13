# CoachG Workflow Buttons — Design Spec

**Status:** Draft for review
**Date:** 2026-05-12
**Author:** Tim Arnold (tim@websynqdesign.com) + Claude

## 1. Overview

CoachG Workflow Buttons is a GoHighLevel Marketplace App that injects an iframe widget into a contact record. The widget displays color-coded buttons. Each button enrolls the current contact into a configured GHL workflow with one click (plus a confirmation step). An activity log records every enrollment attempt, who triggered it, and the outcome.

**Primary use case:** The main button action triggers a GHL workflow that generates and sends a Scope of Appointment (SOA) PDF to the contact. This is an insurance compliance requirement — the activity log is a legal paper trail. The widget surfaces "SOA last sent: [date]" under each button per contact so operators can see at a glance whether/when an SOA has already gone out.

The app has two iframe views:

- **`/widget`** — the contact-sidebar widget any GHL user can use to enroll the current contact.
- **`/admin`** — a sub-account configuration page where users with the GHL `admin` role manage button definitions and view the full activity log.

Both views are rendered as **GHL Custom Pages** inside the GHL UI. Neither is reachable as a normal public page in practice.

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16.2.6** (App Router) | NOT Next.js 14. `params`/`searchParams` are Promises; `cookies()`/`headers()` are async; `middleware.ts` is now `proxy.ts`. |
| UI | React 19 + Tailwind v4 | Tailwind v4 uses `@import "tailwindcss"` + `@theme inline`. |
| Language | TypeScript (strict) | Existing `tsconfig.json` already strict. |
| Database | Supabase Postgres | Four tables (tokens, buttons, activity_log, rate_limits), RLS off (all access through service-role from server). |
| Auth (end-user) | GHL Marketplace SSO via `postMessage` | No cookie-based session of our own. |
| Auth (machine) | GHL OAuth 2.0 (authorization_code) | Tokens stored in Supabase, auto-refresh on 401 or pre-expiry. |
| Hosting | Vercel | Serverless route handlers. |
| Tests | Vitest + @testing-library/react + MSW | Unit + integration; Playwright deferred. |

## 3. Architecture

```
[GHL UI]
   │  iframe Custom Page /widget?... or /admin?...
   ▼
[Next.js app on Vercel]
   ├── app/widget/page.tsx        (client component, postMessage handler)
   ├── app/admin/page.tsx         (client component, postMessage handler)
   ├── app/api/oauth/callback/    (one-time OAuth code exchange)
   ├── app/api/workflows/         (proxied GHL workflows fetch)
   ├── app/api/buttons/...        (CRUD)
   ├── app/api/enroll/            (workflow enrollment + activity log)
   ├── app/api/log/               (activity log read)
   ├── lib/ghl.ts                 (GHL API client + token refresh)
   ├── lib/ghl-sso.ts             (decode + verify GHL SSO key)
   ├── lib/db.ts                  (Postgres client via DATABASE_URL)
   ├── lib/rate-limit.ts          (Postgres-backed per-user limiter)
   ├── lib/auth.ts                (withSso / withAdminSso route HOFs)
   └── lib/validation.ts          (zod schemas for inputs)
   ▼
[Supabase Postgres]
   ├── ghl_tokens
   ├── buttons
   ├── activity_log
   └── rate_limits (+ rate_limit_check() function)
   ▼
[GHL API v2]
```

### Two key trust boundaries

1. **GHL → our iframe:** Untrusted query params; only the **SSO key delivered via postMessage** is authoritative. Every API call from the client includes the SSO token; every route handler decodes + verifies it before doing anything.
2. **Our server → GHL API:** Server-side only, using the OAuth access token for that `locationId`. Tokens never reach the browser.

## 4. The `postMessage` + SSO flow

GHL injects two pieces of data into Marketplace iframes:

- **Query params** — `locationId`, `contactId`, `userId`, etc. **Useful hint, never trusted.**
- **postMessage payload** with a `key` field — a **signed JWT** (HS256, signed by GHL with the app's SSO key from the Marketplace app settings). Payload contains at minimum `userId`, `companyId`, `locationId`, and `role`.

Flow on iframe load:

1. Iframe mounts. Client posts `{ message: 'REQUEST_USER_DATA' }` to `window.parent`.
2. GHL responds with `{ key: '<signed-jwt>' }`.
3. Client stores the JWT (in component state, not localStorage).
4. Every subsequent API call to our backend includes that JWT in an `X-GHL-SSO` header.
5. Server verifies the JWT signature with `GHL_SSO_KEY` using HS256. Returns 401 if signature invalid, token expired, or missing. Uses the verified `locationId`/`userId`/`role` from the payload as the **only authoritative identity**.

`lib/ghl-sso.ts` is the single verification point. All route handlers route through it. Implementation uses `jsonwebtoken` (HS256, `verify` with `GHL_SSO_KEY`).

## 5. Roles & authorization

The decoded SSO payload includes `role`. We treat:

- **Widget (`/widget` + read-only APIs + `/api/enroll`):** any role permitted.
- **Admin (`/admin` + button CRUD APIs):** `role === 'admin'` only. Enforced **server-side on every mutation**, not just by hiding UI. The Marketplace's "show only to admins" toggle is UX polish, not security.

Activity log entries record the decoded `userId` and a human-readable `userName` from the SSO payload.

## 6. Supabase schema

### `ghl_tokens`

| col | type | notes |
|---|---|---|
| location_id | text | PK |
| access_token | text | encrypted-at-rest via pgcrypto or stored as-is for v1 — see Open Questions |
| refresh_token | text | |
| expires_at | timestamptz | |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### `buttons`

| col | type | notes |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| location_id | text | FK-style link to `ghl_tokens.location_id`, indexed |
| label | text | not null, max 50 chars |
| color | text | hex `#RRGGBB`, validated by check constraint |
| workflow_id | text | GHL workflow id |
| workflow_name | text | snapshot at config time so it survives upstream renames |
| sort_order | integer | not null, not unique; admin UI keeps values contiguous on reorder |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Index: `(location_id, sort_order)`.

### `activity_log`

| col | type | notes |
|---|---|---|
| id | uuid | PK |
| location_id | text | indexed |
| contact_id | text | indexed |
| contact_name | text | snapshot |
| button_label | text | snapshot |
| workflow_id | text | snapshot |
| workflow_name | text | snapshot |
| triggered_by_user_id | text | from SSO |
| triggered_by_user_name | text | from SSO |
| status | text | `success` or `error`, check constraint |
| error_message | text | nullable |
| triggered_at | timestamptz | default now(), indexed |
| soa_sent_at | timestamptz | nullable; populated by `/api/enroll` on successful SOA-sending enrollment — see §1 Primary use case. Compliance paper-trail column added in migration `0002_add_soa_sent_at.sql`. |

Indexes:
- `(location_id, contact_id, triggered_at DESC)` — widget's last-5 query
- `(location_id, triggered_at DESC)` — admin's per-location history scan
- Partial index `(location_id, contact_id, soa_sent_at DESC) WHERE soa_sent_at IS NOT NULL` — widget's "SOA last sent: [date]" lookup per contact

### `rate_limits`

| col | type | notes |
|---|---|---|
| location_id | text | part of composite PK |
| user_id | text | part of composite PK |
| window_start | timestamptz | part of composite PK, truncated to the minute |
| count | integer | |

Plus a Postgres function `rate_limit_check(p_location_id, p_user_id, p_max_per_min) returns boolean` that atomically increments and returns whether the call is allowed.

### RLS

Off for v1. All access is via the Supabase **service-role** key, only ever used server-side. The browser never sees the Supabase URL or key.

## 7. API routes

All routes (except `/api/oauth/callback`) require an `X-GHL-SSO` request header containing the encrypted SSO token received via `postMessage`. Route handlers decode + verify it via `lib/ghl-sso.ts` before any other work. If decode fails or the token is missing: `401`. Admin-only routes additionally check `decoded.role === 'admin'` and return `403` otherwise.

| Route | Method | Auth | Behavior |
|---|---|---|---|
| `/api/oauth/callback` | GET | none (called by GHL during install) | Exchange `code` for tokens, upsert `ghl_tokens` row, redirect to `/admin?locationId={locationId}` so the installer lands directly on their config page. |
| `/api/workflows` | GET | SSO | Use OAuth token for `locationId` to fetch GHL workflows; return `[{id, name}]`. |
| `/api/buttons` | GET | SSO | Return `buttons` rows for verified `locationId`, ordered by `sort_order`. |
| `/api/buttons` | POST | SSO + admin | Create button. Validates with zod. |
| `/api/buttons/[id]` | PUT | SSO + admin | Update. Confirms button belongs to verified locationId. |
| `/api/buttons/[id]` | DELETE | SSO + admin | Delete. Same scoping. |
| `/api/buttons/reorder` | POST | SSO + admin | Bulk update sort_order. |
| `/api/enroll` | POST | SSO + rate limit | `{ buttonId, contactId, contactName }` → GHL enroll → write activity_log (success or error). |
| `/api/log` | GET | SSO | `?contactId=` (widget last 5) or no `contactId` (admin full history, paginated). |

Important: `locationId` is **never** taken from the request body or query string. It always comes from the decoded SSO payload. Query string `locationId` is only used as a UX hint by the client to know which tab it's in.

## 8. lib/ structure

- **`lib/db.ts`** — singleton DB client built from `DATABASE_URL` via the `postgres` package. Exports `getDb(): QueryClient` and the `QueryClient` interface tests use to swap in PGlite. Direct Postgres rather than `@supabase/supabase-js`/PostgREST so the same code path works against PGlite in tests and Supabase in production.
- **`lib/ghl-sso.ts`** — `verifySso(token: string): SsoPayload | null`. Verifies HS256 JWT signature with `GHL_SSO_KEY` via `jsonwebtoken`. Returns null on any failure (invalid signature, expired, malformed). Fails closed — never throws.
- **`lib/ghl.ts`** — `getGhlClient(locationId): { workflows.list(), contact.enroll(workflowId, contactId), ... }`. Internally: loads token from Supabase, refreshes on expiry-soon (60s buffer) OR on 401 retry, persists new token, returns typed methods. All calls target `https://services.leadconnectorhq.com` with header `Version: 2021-07-28`. Enrollment is `POST /contacts/{contactId}/workflow/{workflowId}` with body `{ eventStartTime: <ISO timestamp> }`.
- **`lib/rate-limit.ts`** — `await checkRateLimit(locationId, userId)`. Calls `rate_limit_check()` Postgres function. Returns boolean. Use in `/api/enroll`.
- **`lib/validation.ts`** — zod schemas for button create/update, enroll payload, etc.
- **`lib/auth.ts`** — small wrapper: `withSso(handler)` and `withAdminSso(handler)` higher-order functions for route handlers.

## 9. UI

### `/widget`

Server component shell that renders a client component (`<Widget />`). Client component:

1. On mount: post `REQUEST_USER_DATA` to parent, receive encrypted SSO key.
2. Fetch `/api/buttons` and `/api/log?contactId=...` in parallel with the SSO token.
3. Render: a grid of colored buttons + a "Last 5 activity" panel below.
4. Click a button → custom Tailwind modal: "Enroll {contactName} in {workflowName}?" Confirm → POST `/api/enroll`.
5. On success: toast + optimistic prepend to the activity panel. On error: red toast + log entry shows the error.

### `/admin`

Same SSO bootstrap. On mount, also fetch `/api/workflows`. Two tabs:

- **Buttons** — table with label, color swatch, workflow, up/down arrows, edit, delete. "Add Button" opens a modal with label input, color picker (10 presets + hex fallback), workflow dropdown.
- **Activity Log** — paginated list of all entries for the location with success/error icons.

If the decoded role is not `admin`, the page renders an "Insufficient permissions" message instead of the UI.

## 10. Phase plan (9 phases)

The user wants RED → GREEN → REFACTOR per phase, with explicit verification before moving on. Each phase ends with: green tests, manual smoke (where applicable), and a commit on `master`.

| # | Phase | Deliverables | Tests |
|---|---|---|---|
| 0 | **Test infra** | Vitest config, MSW setup, test scripts in package.json, sample passing test. | One sample unit test passes. |
| 1 | **Supabase schema** | SQL migration file `supabase/migrations/0001_init.sql` with all 4 tables + `rate_limit_check()` function. Optional: helper script to apply locally. | SQL parses; if a local Supabase is available, migration applies cleanly. Structural assertions on the SQL file. |
| 2 | **OAuth callback** | `app/api/oauth/callback/route.ts`. Exchanges code, upserts `ghl_tokens`. | Integration test with MSW mocking GHL token endpoint: happy path, GHL error, code missing, DB write failure. |
| 2.5 | **SSO verification helper** | `lib/ghl-sso.ts` + tests. Pure function, no Next.js dependencies. | Unit tests: valid token decodes; tampered/expired/missing returns null. |
| 3 | **GHL API client** | `lib/ghl.ts` with token refresh + 401 retry, building on `lib/db.ts`. | MSW-mocked tests: workflows.list, enroll, expired token triggers refresh, 401 triggers refresh-and-retry, refresh failure surfaces. |
| 4 | **Buttons CRUD** | `/api/buttons` GET/POST, `/api/buttons/[id]` PUT/DELETE, `/api/buttons/reorder`. With `withAdminSso` HOC and zod validation. | Integration tests: read scoped to locationId; mutations require admin role; cross-tenant write is rejected; reorder is atomic. |
| 5 | **Enroll + log** | `/api/enroll` POST, `/api/log` GET, `lib/rate-limit.ts`. | Integration tests: successful enroll writes success row; GHL failure writes error row; rate limit blocks 11th call within the minute; locationId scoping. |
| 6 | **Widget UI** | `app/widget/page.tsx` + client component, custom confirm modal, activity panel. | Component tests: postMessage handler mounts and stores token; button click triggers confirm; confirm posts to `/api/enroll`; activity list renders both success and error rows. |
| 7 | **Admin UI** | `app/admin/page.tsx` + button table + add/edit modal + reorder arrows + activity tab. | Component tests: non-admin sees the gate; admin sees CRUD; color picker round-trips; reorder calls the right endpoint. |

Each phase is its own plan via the `superpowers:writing-plans` skill. We do not start phase N+1 until phase N is verified.

## 11. Testing strategy

- **Unit tests:** pure functions (`lib/ghl-sso.ts`, `lib/validation.ts`, helpers). No I/O.
- **Integration tests for route handlers:** invoke the exported HTTP method functions directly with a constructed `Request`. Mock the GHL API with MSW. Use a real Supabase instance — either local supabase-cli or a dedicated test project. Each test resets the tables it touches.
- **Component tests:** `@testing-library/react` + `vitest`. Mock `fetch` via MSW. Simulate `postMessage` via dispatching `MessageEvent`s on `window`.
- **No mocks for the database.** The user's mental model for "is this really working" requires hitting Postgres for real.
- **E2E:** out of scope for v1. Manual smoke in the GHL Marketplace sandbox after each phase that affects user-visible behavior (phase 6 and 7).

## 12. Security model summary

- Tokens (OAuth access + refresh) live only in Supabase, accessed via service-role key only on the server.
- Browser never sees Supabase URL, service-role key, GHL client secret, or `GHL_SSO_KEY`.
- Every API request from the iframe carries the encrypted SSO token. Every route handler decodes it server-side and treats the decoded payload as the **sole identity authority**. Query params are UX hints only.
- Admin-only routes additionally check `decoded.role === 'admin'`. Returning 403 if not.
- Cross-tenant access is prevented by always deriving `locationId` from the decoded SSO payload — never from request bodies/params.
- Rate limit: 10/min per `(locationId, userId)` on `/api/enroll`. Atomic via Postgres function.
- HMAC webhook verification: spec mentions "where applicable" — no GHL webhooks in v1 scope, so this is deferred to a future phase if/when we add them.

## 13. Environment variables

```
NEXT_PUBLIC_APP_URL=
GHL_CLIENT_ID=
GHL_CLIENT_SECRET=
GHL_SSO_KEY=            # shared secret for verifying marketplace SSO JWTs (HS256)
DATABASE_URL=           # full Postgres connection string (Supabase or local)
```

Note: there is **no** `NEXT_PUBLIC_SUPABASE_*` — the client never talks to Supabase directly.

## 14. Resolved decisions and deferred items

Resolved during brainstorming:

1. **GHL SSO format.** HS256-signed JWT. Verified with `jsonwebtoken.verify(token, GHL_SSO_KEY, { algorithms: ['HS256'] })`. Payload contains `userId`, `companyId`, `locationId`, `role`.
2. **GHL workflow enrollment endpoint.** `POST https://services.leadconnectorhq.com/contacts/{contactId}/workflow/{workflowId}`. Headers: `Authorization: Bearer {accessToken}`, `Version: 2021-07-28`. Body: `{ "eventStartTime": "<ISO timestamp>" }`.
3. **OAuth callback redirect target.** Redirect to `/admin?locationId={locationId}` so the installer lands directly on their config page.
4. **OAuth redirect URI** registered in the GHL Marketplace app settings: `http://localhost:3000/api/oauth/callback` for local dev; the Vercel production URL gets added when the deployment is live.

Deferred to v2 (flagged here so they don't get forgotten):

- **Encryption-at-rest for OAuth tokens.** Not in v1 scope; protected by service-role key isolation only. Revisit if the app is published more broadly.
- **GHL webhook handling.** No webhooks in v1. HMAC signature verification deferred to whenever we add the first webhook.

## 15. Non-goals for v1

- E2E browser tests in CI.
- Bulk enroll (multiple contacts at once).
- Custom workflows triggered by GHL webhooks back to us.
- Drag-and-drop reorder.
- Encryption-at-rest for OAuth tokens.
- An i18n layer.
- A landing page or marketing site.
- Multi-language / dark mode tuning beyond what Tailwind defaults provide.
