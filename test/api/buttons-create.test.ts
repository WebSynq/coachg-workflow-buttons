import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePost, signTestSso } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

const TEST_SECRET = 'test-sso-key-buttons-create'

describe('POST /api/buttons', () => {
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

  const okBody = {
    label: 'SOA',
    color: '#FF0000',
    workflowId: 'wf-1',
    workflowName: 'Send SOA',
    sendsSoa: true,
  }

  it('returns 401 when SSO header is missing', async () => {
    await mountDb()
    const { POST } = await import('@/app/api/buttons/route')
    const res = await POST(makePost('/api/buttons', okBody))
    expect(res.status).toBe(401)
  })

  it('returns 403 when the SSO role is not admin', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
    const { POST } = await import('@/app/api/buttons/route')
    const res = await POST(makePost('/api/buttons', okBody, { 'x-ghl-sso': token }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when the body fails zod validation', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc1', role: 'admin' }, TEST_SECRET)
    const { POST } = await import('@/app/api/buttons/route')
    const res = await POST(
      makePost('/api/buttons', { ...okBody, color: 'red' }, { 'x-ghl-sso': token }),
    )
    expect(res.status).toBe(400)
  })

  it('persists with location_id from SSO and sort_order auto-assigned starting at 0', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc-create', role: 'admin' }, TEST_SECRET)
    const { POST } = await import('@/app/api/buttons/route')
    const res = await POST(makePost('/api/buttons', okBody, { 'x-ghl-sso': token }))

    expect(res.status).toBe(201)
    const body = (await res.json()) as { button: { id: string; sortOrder: number; sendsSoa: boolean } }
    expect(body.button.sortOrder).toBe(0)
    expect(body.button.sendsSoa).toBe(true)

    const { rows } = await db!.query<{ location_id: string; sort_order: number }>(
      `SELECT location_id, sort_order FROM buttons WHERE id = $1`,
      [body.button.id],
    )
    expect(rows[0]).toEqual({ location_id: 'loc-create', sort_order: 0 })
  })

  it('assigns sort_order = max+1 on subsequent inserts in the same tenant', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc-multi', role: 'admin' }, TEST_SECRET)
    const { POST } = await import('@/app/api/buttons/route')
    const a = await POST(makePost('/api/buttons', okBody, { 'x-ghl-sso': token }))
    const b = await POST(makePost('/api/buttons', { ...okBody, label: 'Second' }, { 'x-ghl-sso': token }))
    const c = await POST(makePost('/api/buttons', { ...okBody, label: 'Third' }, { 'x-ghl-sso': token }))
    expect(((await a.json()) as { button: { sortOrder: number } }).button.sortOrder).toBe(0)
    expect(((await b.json()) as { button: { sortOrder: number } }).button.sortOrder).toBe(1)
    expect(((await c.json()) as { button: { sortOrder: number } }).button.sortOrder).toBe(2)
  })

  it('ignores any locationId in the body (strict schema rejects it as 400)', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc-real', role: 'admin' }, TEST_SECRET)
    const { POST } = await import('@/app/api/buttons/route')
    const res = await POST(
      makePost(
        '/api/buttons',
        { ...okBody, locationId: 'loc-attacker' },
        { 'x-ghl-sso': token },
      ),
    )
    // Strict schema rejects unknown keys with 400 rather than silently dropping —
    // that's the safer posture for the cross-tenant attack vector.
    expect(res.status).toBe(400)
  })

  it('defaults sendsSoa to true when omitted from the body', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc-default', role: 'admin' }, TEST_SECRET)
    const { sendsSoa: _, ...rest } = okBody
    void _
    const { POST } = await import('@/app/api/buttons/route')
    const res = await POST(makePost('/api/buttons', rest, { 'x-ghl-sso': token }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { button: { sendsSoa: boolean } }
    expect(body.button.sendsSoa).toBe(true)
  })
})
