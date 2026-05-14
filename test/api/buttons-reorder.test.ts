import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePost, signTestSso } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

const TEST_SECRET = 'test-sso-key-buttons-reorder'

async function insertButton(
  db: Awaited<ReturnType<typeof createTestQueryClient>>,
  locationId: string,
  sortOrder: number,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
     VALUES ($1, 'L', '#FF0000', 'wf', 'WF', $2) RETURNING id`,
    [locationId, sortOrder],
  )
  return rows[0].id
}

describe('POST /api/buttons/reorder', () => {
  let db: Awaited<ReturnType<typeof createTestQueryClient>> | null = null

  beforeEach(() => {
    vi.stubEnv('GHL_SSO_KEY', TEST_SECRET)
  })

  afterEach(async () => {
    if (db) {
      await db.end()
      db = null
    }
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function mountDb() {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({ getDb: () => db, resetDbForTests: () => {} }))
  }

  it('returns 401 without an SSO header', async () => {
    await mountDb()
    const { POST } = await import('@/app/api/buttons/reorder/route')
    const res = await POST(
      makePost('/api/buttons/reorder', {
        items: [{ id: 'a1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f', sortOrder: 0 }],
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 when the SSO role is not admin', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
    const { POST } = await import('@/app/api/buttons/reorder/route')
    const res = await POST(
      makePost(
        '/api/buttons/reorder',
        { items: [{ id: 'a1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f', sortOrder: 0 }] },
        { 'x-ghl-sso': token },
      ),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when the body fails zod validation', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc1', role: 'admin' }, TEST_SECRET)
    const { POST } = await import('@/app/api/buttons/reorder/route')
    const res = await POST(
      makePost('/api/buttons/reorder', { items: [] }, { 'x-ghl-sso': token }),
    )
    expect(res.status).toBe(400)
  })

  it('updates all sort_order values atomically on the happy path', async () => {
    await mountDb()
    const a = await insertButton(db!, 'loc-happy', 0)
    const b = await insertButton(db!, 'loc-happy', 1)
    const c = await insertButton(db!, 'loc-happy', 2)
    const token = signTestSso({ locationId: 'loc-happy', role: 'admin' }, TEST_SECRET)
    const { POST } = await import('@/app/api/buttons/reorder/route')
    // reverse the order
    const res = await POST(
      makePost(
        '/api/buttons/reorder',
        {
          items: [
            { id: a, sortOrder: 2 },
            { id: b, sortOrder: 1 },
            { id: c, sortOrder: 0 },
          ],
        },
        { 'x-ghl-sso': token },
      ),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const { rows } = await db!.query<{ id: string; sort_order: number }>(
      `SELECT id, sort_order FROM buttons WHERE location_id = 'loc-happy' ORDER BY sort_order`,
    )
    expect(rows.map(r => r.id)).toEqual([c, b, a])
  })

  it('rolls back atomically when any id belongs to a different locationId', async () => {
    await mountDb()
    const own = await insertButton(db!, 'loc-attacker', 0)
    const foreign = await insertButton(db!, 'loc-victim', 5)
    const token = signTestSso({ locationId: 'loc-attacker', role: 'admin' }, TEST_SECRET)
    const { POST } = await import('@/app/api/buttons/reorder/route')
    const res = await POST(
      makePost(
        '/api/buttons/reorder',
        {
          items: [
            { id: own, sortOrder: 99 },
            { id: foreign, sortOrder: 0 }, // cross-tenant — must abort the whole tx
          ],
        },
        { 'x-ghl-sso': token },
      ),
    )
    expect(res.status).toBe(400)

    // Neither row should have changed.
    const { rows: ownRows } = await db!.query<{ sort_order: number }>(
      `SELECT sort_order FROM buttons WHERE id = $1`,
      [own],
    )
    const { rows: foreignRows } = await db!.query<{ sort_order: number }>(
      `SELECT sort_order FROM buttons WHERE id = $1`,
      [foreign],
    )
    expect(ownRows[0].sort_order).toBe(0)
    expect(foreignRows[0].sort_order).toBe(5)
  })

  it('rolls back atomically when any id does not exist at all', async () => {
    await mountDb()
    const real = await insertButton(db!, 'loc-mix', 0)
    const fake = 'b1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f'
    const token = signTestSso({ locationId: 'loc-mix', role: 'admin' }, TEST_SECRET)
    const { POST } = await import('@/app/api/buttons/reorder/route')
    const res = await POST(
      makePost(
        '/api/buttons/reorder',
        {
          items: [
            { id: real, sortOrder: 5 },
            { id: fake, sortOrder: 0 },
          ],
        },
        { 'x-ghl-sso': token },
      ),
    )
    expect(res.status).toBe(400)

    const { rows } = await db!.query<{ sort_order: number }>(
      `SELECT sort_order FROM buttons WHERE id = $1`,
      [real],
    )
    expect(rows[0].sort_order).toBe(0)
  })
})
