import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDelete, signTestSso } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

const TEST_SECRET = 'test-sso-key-buttons-delete'

async function insertButton(
  db: Awaited<ReturnType<typeof createTestQueryClient>>,
  locationId: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
     VALUES ($1, 'X', '#FF0000', 'wf', 'WF', 0) RETURNING id`,
    [locationId],
  )
  return rows[0].id
}

describe('DELETE /api/buttons/[id]', () => {
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

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  it('returns 401 without an SSO header', async () => {
    await mountDb()
    const id = await insertButton(db!, 'loc1')
    const { DELETE } = await import('@/app/api/buttons/[id]/route')
    const res = await DELETE(makeDelete(`/api/buttons/${id}`), ctx(id))
    expect(res.status).toBe(401)
  })

  it('returns 403 when the SSO role is not admin', async () => {
    await mountDb()
    const id = await insertButton(db!, 'loc1')
    const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
    const { DELETE } = await import('@/app/api/buttons/[id]/route')
    const res = await DELETE(
      makeDelete(`/api/buttons/${id}`, { 'x-ghl-sso': token }),
      ctx(id),
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 when the id does not exist', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc1', role: 'admin' }, TEST_SECRET)
    const missing = 'a1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f'
    const { DELETE } = await import('@/app/api/buttons/[id]/route')
    const res = await DELETE(
      makeDelete(`/api/buttons/${missing}`, { 'x-ghl-sso': token }),
      ctx(missing),
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when the id belongs to a different locationId (cross-tenant guard)', async () => {
    await mountDb()
    const id = await insertButton(db!, 'loc-owner')
    const token = signTestSso({ locationId: 'loc-attacker', role: 'admin' }, TEST_SECRET)
    const { DELETE } = await import('@/app/api/buttons/[id]/route')
    const res = await DELETE(
      makeDelete(`/api/buttons/${id}`, { 'x-ghl-sso': token }),
      ctx(id),
    )
    expect(res.status).toBe(404)

    const { rows } = await db!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM buttons WHERE id = $1`,
      [id],
    )
    expect(rows[0].count).toBe('1')
  })

  it('returns 204 and removes the row on the happy path', async () => {
    await mountDb()
    const id = await insertButton(db!, 'loc-happy')
    const token = signTestSso({ locationId: 'loc-happy', role: 'admin' }, TEST_SECRET)
    const { DELETE } = await import('@/app/api/buttons/[id]/route')
    const res = await DELETE(
      makeDelete(`/api/buttons/${id}`, { 'x-ghl-sso': token }),
      ctx(id),
    )
    expect(res.status).toBe(204)

    const { rows } = await db!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM buttons WHERE id = $1`,
      [id],
    )
    expect(rows[0].count).toBe('0')
  })
})
