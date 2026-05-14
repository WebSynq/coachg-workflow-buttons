# Phase 5: /api/workflows + /api/enroll + /api/log + rate-limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Wire the remaining server-side surface the UI consumes — workflow lookup, the enroll action with its rate limiter, and the activity-log read both modes (widget last-5 + SOA-last-sent, and admin paginated history).

Five files of production code, four files of tests, one new section in `lib/validation.ts`.

**Spec reference:** §1 (SOA paper trail), §6 (activity_log + rate_limits + indices), §7 (route table — workflows/enroll/log), §8 (lib/rate-limit, lib/validation), §12 (rate limit 10/min per (locationId, userId)).

**Out of scope for Phase 5:**
- Any UI / iframe code — Phases 6 + 7.
- Encryption at rest for tokens — deferred to v2 per spec §14.
- Drag-and-drop UX for the activity log — N/A (read-only).

---

## API contract

### `GET /api/workflows`
- Auth: `withSso` (any role — admin UI is the consumer)
- Behavior: `getGhlClient(sso.locationId).workflows.list()` and forward the result
- Response 200: `{ workflows: [{ id, name }, ...] }`
- Errors: 401 (no/invalid SSO), 502 (GHL upstream error — message in body)

### `POST /api/enroll`
- Auth: `withSso` + rate limit (10/min per (locationId, userId))
- Body: `{ buttonId, contactId, contactName? }` (zod-validated, strict; contactName is optional because the activity_log column is nullable)
- Order of operations:
  1. zod-validate body → 400 on failure
  2. `checkRateLimit(sso.locationId, sso.userId)` → 429 with `{ error: 'rate_limit' }` if not allowed (no activity row written — rate limit is pre-attempt)
  3. Load the button row, scoped to `(button.id, button.location_id = sso.locationId)`. 404 if it doesn't exist OR belongs to a different tenant.
  4. `getGhlClient(sso.locationId).contact.enroll(button.workflow_id, contactId)` inside try/catch.
  5. **Always** write an `activity_log` row:
     - `status='success'` + `soa_sent_at = now()` when GHL succeeded AND `button.sends_soa` is true
     - `status='success'` + `soa_sent_at = NULL` when GHL succeeded AND `button.sends_soa` is false
     - `status='error'` + `error_message=<err.message>` when GHL threw
  6. Return 200 with `{ ok: true, entry: <camelCase row> }` on success, 502 with `{ ok: false, entry: <camelCase row> }` on GHL failure (still includes the logged entry).
- Other errors: 401, 400, 404, 429.
- The activity row records `triggered_by_user_id` + `triggered_by_user_name` from the SSO payload. **GHL's SSO payload doesn't promise a human-readable name** in the four-field shape `verifySso` returns. For v1 we store `triggered_by_user_name = sso.userId` (we don't have anything richer). When GHL adds a documented `name` field to the SSO JWT, we extend `SsoPayload` and revisit this column.

### `GET /api/log`
- Auth: `withSso`
- Two modes determined by query params (zod-validated):
  - **Widget mode** — `?contactId=...` present.
    - Returns the most-recent 5 `activity_log` rows for `(location_id, contact_id)` AND the most-recent `soa_sent_at` for the same `(location_id, contact_id)` across ALL rows (not just the 5 in the entries window). The widget needs the SOA date even if the most recent SOA-bearing enrollment is outside the last-5 page.
    - Response 200: `{ entries: [...5 rows in camelCase], lastSoaSentAt: string | null }`
  - **Admin mode** — no `contactId`.
    - Returns a page of rows for the full location ordered by `triggered_at DESC` plus the total row count for pagination.
    - Pagination: `?limit=` (default 20, 1–100) + `?offset=` (default 0, ≥0).
    - Response 200: `{ entries: [...], total: N, limit, offset }`
- Errors: 401, 400 (invalid query)

---

## File map

**Created:**
- `lib/rate-limit.ts`
- `lib/rate-limit.test.ts`
- `app/api/workflows/route.ts`
- `test/api/workflows.test.ts`
- `app/api/enroll/route.ts`
- `test/api/enroll.test.ts`
- `app/api/log/route.ts`
- `test/api/log.test.ts`

**Modified:**
- `lib/validation.ts` — add `enrollSchema` + `logQuerySchema`
- `lib/validation.test.ts` — coverage for both new schemas

---

## Task 1: Extend `lib/validation.ts`

- [ ] **Step 1**: Append to `lib/validation.ts`:

```ts
export const enrollSchema = z
  .object({
    buttonId: z.uuid(),
    contactId: idStringSchema,
    contactName: z.string().optional(),
  })
  .strict()
export type EnrollInput = z.infer<typeof enrollSchema>

export const logQuerySchema = z
  .object({
    contactId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()
export type LogQuery = z.infer<typeof logQuerySchema>
```

- [ ] **Step 2**: Append tests covering each schema:
- enrollSchema: happy path; rejects empty contactId; rejects non-uuid buttonId; accepts no contactName; rejects unknown keys.
- logQuerySchema: parses query objects with string limit/offset (`z.coerce`); defaults when omitted; rejects negative offset / limit > 100 / limit < 1.

- [ ] **Step 3**: Confirm GREEN + commit.

---

## Task 2: `lib/rate-limit.ts`

- [ ] **Step 1**: Tests (`lib/rate-limit.test.ts`) — use PGlite via `createTestQueryClient`:
- 1st through 10th call return true
- 11th call within the same minute returns false
- Different `(locationId, userId)` tuples have independent buckets
- (Defer time-window expiry to a manual test — PGlite + clock-mocking inside the function gets fiddly and the function itself is read-only Postgres logic that's already covered by `test/db/rate-limit-check.test.ts`)

- [ ] **Step 2**: Implement:

```ts
import { getDb } from './db'

const MAX_PER_MIN = 10

/**
 * Atomically increment + check the (locationId, userId) bucket for the
 * current minute. Returns true if the call is allowed (count <= MAX),
 * false if the rate limit was hit. Single round trip to the
 * rate_limit_check() Postgres function — no race window between the
 * increment and the check.
 */
export async function checkRateLimit(locationId: string, userId: string): Promise<boolean> {
  const { rows } = await getDb().query<{ rate_limit_check: boolean }>(
    `SELECT rate_limit_check($1, $2, $3) AS rate_limit_check`,
    [locationId, userId, MAX_PER_MIN],
  )
  return rows[0].rate_limit_check
}
```

- [ ] **Step 3**: Confirm GREEN + commit.

---

## Task 3: `GET /api/workflows`

- [ ] **Step 1**: Tests (`test/api/workflows.test.ts`):
- 401 missing/invalid SSO
- 200 + `{ workflows: [{id, name}] }` on happy path (MSW-mocked GHL response, seed a token row)
- 502 when GHL responds non-2xx

- [ ] **Step 2**: Implement:

```ts
import { withSso } from '@/lib/auth'
import { getGhlClient } from '@/lib/ghl'

export const GET = withSso(async (_req, sso) => {
  try {
    const client = await getGhlClient(sso.locationId)
    const workflows = await client.workflows.list()
    return Response.json({ workflows })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'GHL error'
    return Response.json({ error: message }, { status: 502 })
  }
})
```

- [ ] **Step 3**: Confirm GREEN + commit.

---

## Task 4: `POST /api/enroll`

This is the meatiest endpoint. Test cases:
- 401 missing/invalid SSO
- 400 zod-invalid body
- 429 when rate limit hits (seed `rate_limits` rows OR set MAX low — tests use the production `MAX_PER_MIN = 10`, so call enroll 10 times then assert the 11th is 429)
- 404 when buttonId doesn't exist
- 404 when buttonId belongs to a different locationId
- 200 + activity row with `status='success'` + `soa_sent_at` populated when button.sends_soa = true and GHL succeeds
- 200 + activity row with `soa_sent_at = null` when button.sends_soa = false
- 502 + activity row with `status='error'` + error_message when GHL throws
- locationId in the body is not honored (strict zod → 400)

Implementation sketch:

```ts
import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { withSso } from '@/lib/auth'
import { enrollSchema } from '@/lib/validation'
import { checkRateLimit } from '@/lib/rate-limit'
import { getGhlClient } from '@/lib/ghl'

interface ButtonRow { workflow_id: string; workflow_name: string; label: string; sends_soa: boolean }
interface ActivityRow {
  id: string; location_id: string; contact_id: string; contact_name: string | null;
  button_label: string; workflow_id: string; workflow_name: string;
  triggered_by_user_id: string; triggered_by_user_name: string;
  status: string; error_message: string | null;
  triggered_at: string; soa_sent_at: string | null;
}
function entryToJson(r: ActivityRow) {
  return {
    id: r.id,
    contactId: r.contact_id,
    contactName: r.contact_name,
    buttonLabel: r.button_label,
    workflowId: r.workflow_id,
    workflowName: r.workflow_name,
    triggeredByUserId: r.triggered_by_user_id,
    triggeredByUserName: r.triggered_by_user_name,
    status: r.status,
    errorMessage: r.error_message,
    triggeredAt: r.triggered_at,
    soaSentAt: r.soa_sent_at,
  }
}

export const POST = withSso(async (req: NextRequest, sso) => {
  let body: unknown
  try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
  const parsed = enrollSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'validation', details: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data

  const allowed = await checkRateLimit(sso.locationId, sso.userId)
  if (!allowed) return Response.json({ error: 'rate_limit' }, { status: 429 })

  const db = getDb()
  const { rows: btnRows } = await db.query<ButtonRow>(
    `SELECT workflow_id, workflow_name, label, sends_soa
     FROM buttons WHERE id = $1 AND location_id = $2`,
    [input.buttonId, sso.locationId],
  )
  if (btnRows.length === 0) return Response.json({ error: 'button not found' }, { status: 404 })
  const btn = btnRows[0]

  let status: 'success' | 'error' = 'success'
  let errorMessage: string | null = null
  try {
    const client = await getGhlClient(sso.locationId)
    await client.contact.enroll(btn.workflow_id, input.contactId)
  } catch (e) {
    status = 'error'
    errorMessage = e instanceof Error ? e.message : 'GHL error'
  }

  const soaSentAt = status === 'success' && btn.sends_soa ? new Date().toISOString() : null

  const { rows: logRows } = await db.query<ActivityRow>(
    `INSERT INTO activity_log
       (location_id, contact_id, contact_name, button_label, workflow_id, workflow_name,
        triggered_by_user_id, triggered_by_user_name, status, error_message, soa_sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      sso.locationId,
      input.contactId,
      input.contactName ?? null,
      btn.label,
      btn.workflow_id,
      btn.workflow_name,
      sso.userId,
      sso.userId, // user_name placeholder until GHL SSO promises a name field
      status,
      errorMessage,
      soaSentAt,
    ],
  )

  return Response.json(
    { ok: status === 'success', entry: entryToJson(logRows[0]) },
    { status: status === 'success' ? 200 : 502 },
  )
})
```

- [ ] Tests + GREEN + commit.

---

## Task 5: `GET /api/log`

Test cases (`test/api/log.test.ts`):
- 401 missing/invalid SSO
- 400 invalid query (negative offset, limit > 100)
- Widget mode with contactId: returns up to 5 entries ordered DESC by triggered_at + lastSoaSentAt = max(soa_sent_at) for that contact across all history
- Widget mode: lastSoaSentAt is null if no SOA-bearing row exists for the contact
- Widget mode: only returns rows for the verified locationId AND contactId
- Admin mode (no contactId): returns paginated entries + total count
- Admin mode: respects custom limit/offset
- Admin mode: only returns rows for the verified locationId

Implementation:

```ts
import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { withSso } from '@/lib/auth'
import { logQuerySchema } from '@/lib/validation'
// re-export entryToJson or inline it here — same shape as /api/enroll's

export const GET = withSso(async (req: NextRequest, sso) => {
  const url = new URL(req.url)
  const raw = Object.fromEntries(url.searchParams.entries())
  const parsed = logQuerySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'validation', details: parsed.error.flatten() }, { status: 400 })
  }
  const q = parsed.data
  const db = getDb()

  if (q.contactId) {
    const { rows } = await db.query<ActivityRow>(
      `SELECT * FROM activity_log
       WHERE location_id = $1 AND contact_id = $2
       ORDER BY triggered_at DESC LIMIT 5`,
      [sso.locationId, q.contactId],
    )
    const { rows: soaRows } = await db.query<{ last_soa_sent_at: string | null }>(
      `SELECT max(soa_sent_at) AS last_soa_sent_at FROM activity_log
       WHERE location_id = $1 AND contact_id = $2 AND soa_sent_at IS NOT NULL`,
      [sso.locationId, q.contactId],
    )
    return Response.json({
      entries: rows.map(entryToJson),
      lastSoaSentAt: soaRows[0].last_soa_sent_at,
    })
  }

  const { rows } = await db.query<ActivityRow>(
    `SELECT * FROM activity_log
     WHERE location_id = $1
     ORDER BY triggered_at DESC LIMIT $2 OFFSET $3`,
    [sso.locationId, q.limit, q.offset],
  )
  const { rows: countRows } = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM activity_log WHERE location_id = $1`,
    [sso.locationId],
  )
  return Response.json({
    entries: rows.map(entryToJson),
    total: parseInt(countRows[0].total, 10),
    limit: q.limit,
    offset: q.offset,
  })
})
```

- [ ] Tests + GREEN + commit.

---

## Task 6: Verify + tag

- [ ] `npm test` — full suite
- [ ] `npm run lint`
- [ ] `npm run build` — new routes appear: `/api/workflows`, `/api/enroll`, `/api/log`
- [ ] `git tag phase-5-complete`
- [ ] `git status` clean

---

## What's NOT in Phase 5 (deferred)

- **A retry mechanism** for the activity-log write itself. If the GHL call succeeds but the INSERT fails (e.g., DB hiccup), the operator sees a 500 and tries again — which would double-enroll. v2 should make the activity write idempotent (e.g., a (location_id, contact_id, button_id, triggered_at_minute) unique key), or wrap the GHL call and INSERT in a saga.
- **A separate read of soa_sent_at per button**. Per spec §1, the widget shows ONE SOA-last-sent line per contact, not per button.
- **Pagination by cursor.** Offset-based pagination is fine for v1; revisit if activity_log grows past 100K rows per tenant.
- **A 403 on the admin-mode of /api/log.** Spec §7 lists `withSso` only; the admin UI hides the activity tab from non-admins as UX polish.
- **`triggered_by_user_name` being a real human name.** Awaiting GHL SSO documentation.
