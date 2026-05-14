import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePut, signTestSso } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

const TEST_SECRET = 'test-sso-key-buttons-update'

async function insertButton(
  db: Awaited<ReturnType<typeof createTestQueryClient>>,
  locationId: string,
  label: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
     VALUES ($1, $2, '#FF0000', 'wf', 'WF', 0) RETURNING id`,
    [locationId, label],
  )
  return rows[0].id
}

const okBody = {
  label: 'Updated',
  color: '#00FF00',
  workflowId: 'wf-new',
  workflowName: 'New WF',
  sendsSoa: false,
}

describe('PUT /api/buttons/[id]', () => {
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
    const id = await insertButton(db!, 'loc1', 'Original')
    const { PUT } = await import('@/app/api/buttons/[id]/route')
    const res = await PUT(makePut(`/api/buttons/${id}`, okBody), ctx(id))
    expect(res.status).toBe(401)
  })

  it('returns 403 when the SSO role is not admin', async () => {
    await mountDb()
    const id = await insertButton(db!, 'loc1', 'Original')
    const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
    const { PUT } = await import('@/app/api/buttons/[id]/route')
    const res = await PUT(
      makePut(`/api/buttons/${id}`, okBody, { 'x-ghl-sso': token }),
      ctx(id),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when the body fails zod validation', async () => {
    await mountDb()
    const id = await insertButton(db!, 'loc1', 'Original')
    const token = signTestSso({ locationId: 'loc1', role: 'admin' }, TEST_SECRET)
    const { PUT } = await import('@/app/api/buttons/[id]/route')
    const res = await PUT(
      makePut(`/api/buttons/${id}`, { ...okBody, label: '' }, { 'x-ghl-sso': token }),
      ctx(id),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when the id does not exist', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc1', role: 'admin' }, TEST_SECRET)
    const missing = 'a1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f'
    const { PUT } = await import('@/app/api/buttons/[id]/route')
    const res = await PUT(
      makePut(`/api/buttons/${missing}`, okBody, { 'x-ghl-sso': token }),
      ctx(missing),
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when the id exists but belongs to a different locationId (cross-tenant guard)', async () => {
    await mountDb()
    const id = await insertButton(db!, 'loc-owner', 'Original')
    const token = signTestSso({ locationId: 'loc-attacker', role: 'admin' }, TEST_SECRET)
    const { PUT } = await import('@/app/api/buttons/[id]/route')
    const res = await PUT(
      makePut(`/api/buttons/${id}`, okBody, { 'x-ghl-sso': token }),
      ctx(id),
    )
    expect(res.status).toBe(404)

    // confirm no fields were touched
    const { rows } = await db!.query<{ label: string }>(
      `SELECT label FROM buttons WHERE id = $1`,
      [id],
    )
    expect(rows[0].label).toBe('Original')
  })

  it('updates the row and returns 200 + the new shape on the happy path', async () => {
    await mountDb()
    const id = await insertButton(db!, 'loc-happy', 'Original')
    const token = signTestSso({ locationId: 'loc-happy', role: 'admin' }, TEST_SECRET)
    const { PUT } = await import('@/app/api/buttons/[id]/route')
    const res = await PUT(
      makePut(`/api/buttons/${id}`, okBody, { 'x-ghl-sso': token }),
      ctx(id),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { button: { label: string; color: string; workflowId: string; sendsSoa: boolean } }
    expect(body.button).toMatchObject({
      label: 'Updated',
      color: '#00FF00',
      workflowId: 'wf-new',
      sendsSoa: false,
    })
  })
})
