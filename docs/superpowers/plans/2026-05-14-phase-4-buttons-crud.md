# Phase 4: Buttons CRUD + Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development if available) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first end-user-facing API surface — the buttons CRUD endpoints — using the auth + DB primitives delivered in Phases 2.5 + 3. Three route files cover five endpoints:

1. `GET /api/buttons` — list, scoped to `sso.locationId`, ordered by `sort_order`.
2. `POST /api/buttons` — admin-only create. Body validated by zod. `location_id` from SSO, never the body. `sort_order` auto-assigned to `max(sort_order) + 1` for that tenant.
3. `PUT /api/buttons/[id]` — admin-only full-field update of label/color/workflowId/workflowName/sendsSoa. `location_id` and `id` validated; cross-tenant updates return 404.
4. `DELETE /api/buttons/[id]` — admin-only delete with the same tenant scoping.
5. `POST /api/buttons/reorder` — admin-only atomic bulk update of `sort_order` for many rows in one tx; rows not owned by the verified `locationId` are rejected.

The supporting plumbing:
- `lib/validation.ts` — zod schemas: `buttonCreateSchema`, `buttonUpdateSchema`, `buttonReorderSchema`.
- Extend `test/api/route-helpers.ts` with `makePost` / `makePut` / `makeDelete` constructors for `NextRequest`.
- Add `zod@^4` to runtime deps.

**Spec reference:** §7 (routes table), §8 (`lib/validation.ts` + auth HOFs), §12 (security: locationId from SSO only, cross-tenant rejection).

**Out of scope for Phase 4:**
- `/api/workflows` — Phase 4 *technically* could include it, but spec §7 places it in the API surface and §10's phase table calls Phase 4 "Buttons CRUD". For clarity, defer `/api/workflows` to the start of Phase 5 (it's a one-line wrapper over `getGhlClient(loc).workflows.list()` and is consumed by the admin UI in Phase 7).
- `/api/enroll`, `/api/log`, `lib/rate-limit.ts` — Phase 5.
- Any UI work — Phase 6/7.

---

## API contract (JSON shape)

All requests carry `X-GHL-SSO: <jwt>`. All responses are JSON. The route layer translates between camelCase JSON and snake_case DB columns.

### `GET /api/buttons`
- Auth: `withSso` (any role)
- Response 200: `{ buttons: [{ id, label, color, workflowId, workflowName, sortOrder, sendsSoa }, ...] }`
- Errors: 401 (no/invalid SSO), 500 (db error)

### `POST /api/buttons`
- Auth: `withAdminSso`
- Body: `{ label, color, workflowId, workflowName, sendsSoa? }` (sendsSoa default true)
- Constraints (validated by zod, mirroring SQL CHECKs):
  - `label`: 1–50 chars
  - `color`: matches `/^#[0-9A-Fa-f]{6}$/`
  - `workflowId`: nonempty string
  - `workflowName`: nonempty string
  - `sendsSoa`: boolean, optional, defaults to `true`
- Server-assigned: `location_id` from SSO, `sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM buttons WHERE location_id = $1)`.
- Response 201: `{ button: <created row in camelCase> }`
- Errors: 400 (zod fail), 401, 403, 500

### `PUT /api/buttons/[id]`
- Auth: `withAdminSso`
- Body: same shape as POST (`buttonUpdateSchema`)
- Behavior: full replacement of the editable fields (label, color, workflowId, workflowName, sendsSoa). `sort_order` is NOT touched by this endpoint — that's `reorder`.
- Cross-tenant guard: the UPDATE WHERE clause includes `AND location_id = $1`; if 0 rows affected, return 404.
- Response 200: `{ button: <updated row> }`
- Errors: 400, 401, 403, 404, 500

### `DELETE /api/buttons/[id]`
- Auth: `withAdminSso`
- Cross-tenant guard: DELETE WHERE id AND location_id; 0 rows ⇒ 404.
- Response 204 (no body)
- Errors: 401, 403, 404, 500

### `POST /api/buttons/reorder`
- Auth: `withAdminSso`
- Body: `{ items: [{ id, sortOrder }, ...] }`
- Atomic: BEGIN; UPDATE each row WHERE id=? AND location_id=?; COMMIT. If any row update affects 0 rows (foreign id, cross-tenant), ROLLBACK and return 400 with `{ error: 'invalid id' }`.
- Response 200: `{ ok: true }`
- Errors: 400, 401, 403, 500

---

## File map

**Created:**
- `lib/validation.ts`
- `lib/validation.test.ts`
- `app/api/buttons/route.ts` (GET, POST)
- `test/api/buttons-list.test.ts`
- `test/api/buttons-create.test.ts`
- `app/api/buttons/[id]/route.ts` (PUT, DELETE)
- `test/api/buttons-update.test.ts`
- `test/api/buttons-delete.test.ts`
- `app/api/buttons/reorder/route.ts` (POST)
- `test/api/buttons-reorder.test.ts`

**Modified:**
- `test/api/route-helpers.ts` (add makePost/makePut/makeDelete + a token-signing helper)
- `package.json` / `package-lock.json` (+zod)

---

## Task 1: Install zod + extend route-helpers

- [ ] **Step 1: Install**

```bash
npm install zod
```

Expected: `zod` lands in `dependencies`. No types package — zod ships its own.

- [ ] **Step 2: Extend `test/api/route-helpers.ts`**

Add `makePost`, `makePut`, `makeDelete`, and a `signTestSso` helper:

```ts
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'

export function makeGet(path: string, searchParams: Record<string, string> = {}, headers: Record<string, string> = {}): NextRequest {
  const url = new URL(`https://test.example.com${path}`)
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url, { headers })
}

export function makePost(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://test.example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

export function makePut(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://test.example.com${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

export function makeDelete(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://test.example.com${path}`, { method: 'DELETE', headers })
}

export function signTestSso(payload: { userId?: string; companyId?: string; locationId: string; role: string }, secret: string): string {
  return jwt.sign(
    {
      userId: payload.userId ?? 'test-user',
      companyId: payload.companyId ?? 'test-company',
      locationId: payload.locationId,
      role: payload.role,
    },
    secret,
    { algorithm: 'HS256', expiresIn: '1h' },
  )
}
```

The existing `makeGet` signature gains an optional `headers` arg — backward compatible because the existing oauth-callback test only passes two args.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json test/api/route-helpers.ts
git commit -m "chore: install zod + extend route-helpers for Phase 4 routes"
```

---

## Task 2: lib/validation.ts (zod schemas)

- [ ] **Step 1: Write failing tests** — `lib/validation.test.ts`:

Cover:
- `buttonCreateSchema` accepts the documented happy path, drops extra fields, defaults `sendsSoa` to true
- rejects empty label, label > 50, bad color formats, empty workflowId/workflowName
- `buttonUpdateSchema` has the same shape (label, color, workflowId, workflowName, sendsSoa all required)
- `buttonReorderSchema` accepts `{ items: [{id, sortOrder}] }`; rejects items with negative sortOrder or non-uuid ids; rejects an empty items array

- [ ] **Step 2: Confirm RED**

```bash
npm test -- lib/validation.test.ts
```

- [ ] **Step 3: Implement `lib/validation.ts`**

```ts
import { z } from 'zod'

const labelSchema = z.string().min(1).max(50)
const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/)
const idStringSchema = z.string().min(1)
const uuidSchema = z.string().uuid()

export const buttonCreateSchema = z.object({
  label: labelSchema,
  color: colorSchema,
  workflowId: idStringSchema,
  workflowName: idStringSchema,
  sendsSoa: z.boolean().optional().default(true),
}).strict()

export const buttonUpdateSchema = z.object({
  label: labelSchema,
  color: colorSchema,
  workflowId: idStringSchema,
  workflowName: idStringSchema,
  sendsSoa: z.boolean(),
}).strict()

export const buttonReorderSchema = z.object({
  items: z.array(z.object({
    id: uuidSchema,
    sortOrder: z.number().int().nonnegative(),
  })).min(1),
}).strict()

export type ButtonCreateInput = z.infer<typeof buttonCreateSchema>
export type ButtonUpdateInput = z.infer<typeof buttonUpdateSchema>
export type ButtonReorderInput = z.infer<typeof buttonReorderSchema>
```

- [ ] **Step 4: Confirm GREEN + commit**

```bash
git add lib/validation.ts lib/validation.test.ts
git commit -m "feat(lib): add zod schemas for button create/update/reorder"
```

---

## Task 3: GET + POST `/api/buttons`

Build the list and create endpoints together — they share the route file and the same camelCase ↔ snake_case translation.

- [ ] **Step 1: Write failing tests**

`test/api/buttons-list.test.ts`:
- 401 when SSO header missing
- 401 when SSO token invalid
- returns buttons for the verified locationId, ordered by sort_order
- does NOT return buttons from a different locationId (cross-tenant isolation)
- empty array when no buttons exist

`test/api/buttons-create.test.ts`:
- 401 missing/invalid SSO
- 403 when role is not admin
- 400 on zod-invalid body
- 201 + persists row with `location_id` from SSO, sort_order auto-assigned starting at 0
- second create gets sort_order = 1
- ignores any `locationId` in the body (uses SSO)
- defaults sendsSoa to true when omitted

- [ ] **Step 2: Implement `app/api/buttons/route.ts`**

```ts
import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { withSso, withAdminSso } from '@/lib/auth'
import { buttonCreateSchema } from '@/lib/validation'

interface ButtonRow {
  id: string
  label: string
  color: string
  workflow_id: string
  workflow_name: string
  sort_order: number
  sends_soa: boolean
}

function rowToJson(r: ButtonRow) {
  return {
    id: r.id,
    label: r.label,
    color: r.color,
    workflowId: r.workflow_id,
    workflowName: r.workflow_name,
    sortOrder: r.sort_order,
    sendsSoa: r.sends_soa,
  }
}

export const GET = withSso(async (_req: NextRequest, sso) => {
  const { rows } = await getDb().query<ButtonRow>(
    `SELECT id, label, color, workflow_id, workflow_name, sort_order, sends_soa
     FROM buttons WHERE location_id = $1 ORDER BY sort_order ASC`,
    [sso.locationId],
  )
  return Response.json({ buttons: rows.map(rowToJson) })
})

export const POST = withAdminSso(async (req: NextRequest, sso) => {
  let body: unknown
  try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
  const parsed = buttonCreateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'validation', details: parsed.error.flatten() }, { status: 400 })
  }

  const input = parsed.data
  const { rows } = await getDb().query<ButtonRow>(
    `INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order, sends_soa)
     SELECT $1, $2, $3, $4, $5, COALESCE(MAX(sort_order) + 1, 0), $6
     FROM buttons WHERE location_id = $1
     RETURNING id, label, color, workflow_id, workflow_name, sort_order, sends_soa`,
    [sso.locationId, input.label, input.color, input.workflowId, input.workflowName, input.sendsSoa],
  )
  return Response.json({ button: rowToJson(rows[0]) }, { status: 201 })
})
```

- [ ] **Step 3: Confirm GREEN + commit**

```bash
git add app/api/buttons/route.ts test/api/buttons-list.test.ts test/api/buttons-create.test.ts
git commit -m "feat(api): add GET + POST /api/buttons"
```

---

## Task 4: PUT + DELETE `/api/buttons/[id]`

- [ ] **Step 1: Write failing tests**

`test/api/buttons-update.test.ts`:
- 401 missing/invalid SSO
- 403 non-admin
- 400 zod-invalid body
- 404 when id does not exist
- 404 when id exists but belongs to a different locationId (cross-tenant)
- 200 + persisted update on happy path

`test/api/buttons-delete.test.ts`:
- 401 / 403 / 404 (own + cross-tenant) parallel to update
- 204 on happy path; row gone afterwards

- [ ] **Step 2: Implement `app/api/buttons/[id]/route.ts`**

```ts
import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { withAdminSso } from '@/lib/auth'
import { buttonUpdateSchema } from '@/lib/validation'

interface ButtonRow { id: string; label: string; color: string; workflow_id: string; workflow_name: string; sort_order: number; sends_soa: boolean }
const rowToJson = (r: ButtonRow) => ({ id: r.id, label: r.label, color: r.color, workflowId: r.workflow_id, workflowName: r.workflow_name, sortOrder: r.sort_order, sendsSoa: r.sends_soa })

type Ctx = { params: Promise<{ id: string }> }

export const PUT = withAdminSso<[Ctx]>(async (req: NextRequest, sso, ctx) => {
  const { id } = await ctx.params
  let body: unknown
  try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
  const parsed = buttonUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'validation', details: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data
  const { rows } = await getDb().query<ButtonRow>(
    `UPDATE buttons SET label = $3, color = $4, workflow_id = $5, workflow_name = $6, sends_soa = $7
     WHERE id = $1 AND location_id = $2
     RETURNING id, label, color, workflow_id, workflow_name, sort_order, sends_soa`,
    [id, sso.locationId, input.label, input.color, input.workflowId, input.workflowName, input.sendsSoa],
  )
  if (rows.length === 0) return new Response('Not found', { status: 404 })
  return Response.json({ button: rowToJson(rows[0]) })
})

export const DELETE = withAdminSso<[Ctx]>(async (_req: NextRequest, sso, ctx) => {
  const { id } = await ctx.params
  const { rows } = await getDb().query<{ id: string }>(
    `DELETE FROM buttons WHERE id = $1 AND location_id = $2 RETURNING id`,
    [id, sso.locationId],
  )
  if (rows.length === 0) return new Response('Not found', { status: 404 })
  return new Response(null, { status: 204 })
})
```

- [ ] **Step 3: Confirm GREEN + commit**

```bash
git add app/api/buttons/[id]/route.ts test/api/buttons-update.test.ts test/api/buttons-delete.test.ts
git commit -m "feat(api): add PUT + DELETE /api/buttons/[id]"
```

---

## Task 5: POST `/api/buttons/reorder`

- [ ] **Step 1: Write failing tests**

`test/api/buttons-reorder.test.ts`:
- 401 / 403 parity
- 400 zod-invalid (empty items, non-uuid id, negative sortOrder)
- 400 when any id does not belong to the verified locationId (atomic — no partial updates)
- 200 + persisted new sort_order values on happy path

- [ ] **Step 2: Implement `app/api/buttons/reorder/route.ts`**

```ts
import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { withAdminSso } from '@/lib/auth'
import { buttonReorderSchema } from '@/lib/validation'

export const POST = withAdminSso(async (req: NextRequest, sso) => {
  let body: unknown
  try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
  const parsed = buttonReorderSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'validation', details: parsed.error.flatten() }, { status: 400 })
  }

  const db = getDb()
  await db.query('BEGIN')
  try {
    for (const item of parsed.data.items) {
      const { rows } = await db.query<{ id: string }>(
        `UPDATE buttons SET sort_order = $3 WHERE id = $1 AND location_id = $2 RETURNING id`,
        [item.id, sso.locationId, item.sortOrder],
      )
      if (rows.length === 0) {
        await db.query('ROLLBACK')
        return Response.json({ error: 'invalid id', id: item.id }, { status: 400 })
      }
    }
    await db.query('COMMIT')
  } catch (e) {
    await db.query('ROLLBACK')
    throw e
  }

  return Response.json({ ok: true })
})
```

- [ ] **Step 3: Confirm GREEN + commit**

```bash
git add app/api/buttons/reorder/route.ts test/api/buttons-reorder.test.ts
git commit -m "feat(api): add POST /api/buttons/reorder (atomic bulk sort_order update)"
```

---

## Task 6: Final verification + phase-4-complete tag

- [ ] **Step 1: Full test run**

```bash
npm test
```

Expected: ~prior 85 + delta from this phase. Count when observed.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: routes `/api/buttons`, `/api/buttons/[id]`, `/api/buttons/reorder` appear in the route summary.

- [ ] **Step 4: Tag**

```bash
git tag phase-4-complete
```

- [ ] **Step 5: Confirm clean tree**

```bash
git status
```
