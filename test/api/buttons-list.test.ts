import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeGet, signTestSso } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

const TEST_SECRET = 'test-sso-key-buttons-list'

async function seedButtons(
  db: Awaited<ReturnType<typeof createTestQueryClient>>,
  rows: Array<{ locationId: string; label: string; color: string; sortOrder: number }>,
) {
  for (const r of rows) {
    await db.query(
      `INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
       VALUES ($1, $2, $3, 'wf', 'WF Name', $4)`,
      [r.locationId, r.label, r.color, r.sortOrder],
    )
  }
}

describe('GET /api/buttons', () => {
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

  it('returns 401 when the X-GHL-SSO header is missing', async () => {
    await mountDb()
    const { GET } = await import('@/app/api/buttons/route')
    const res = await GET(makeGet('/api/buttons'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when the SSO token is invalid', async () => {
    await mountDb()
    const { GET } = await import('@/app/api/buttons/route')
    const res = await GET(makeGet('/api/buttons', {}, { 'x-ghl-sso': 'not.a.jwt' }))
    expect(res.status).toBe(401)
  })

  it('returns buttons for the verified locationId, ordered by sort_order, in camelCase JSON', async () => {
    await mountDb()
    await seedButtons(db!, [
      { locationId: 'loc-a', label: 'Second', color: '#00FF00', sortOrder: 1 },
      { locationId: 'loc-a', label: 'First', color: '#FF0000', sortOrder: 0 },
      // a row in another tenant — must NOT leak
      { locationId: 'loc-b', label: 'Other', color: '#0000FF', sortOrder: 0 },
    ])

    const token = signTestSso({ locationId: 'loc-a', role: 'user' }, TEST_SECRET)
    const { GET } = await import('@/app/api/buttons/route')
    const res = await GET(makeGet('/api/buttons', {}, { 'x-ghl-sso': token }))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { buttons: Array<{ label: string; sortOrder: number; sendsSoa: boolean }> }
    expect(body.buttons.map(b => b.label)).toEqual(['First', 'Second'])
    expect(body.buttons[0].sortOrder).toBe(0)
    // sends_soa default-true should round-trip
    expect(body.buttons[0].sendsSoa).toBe(true)
  })

  it('returns an empty array when no buttons exist for the locationId', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc-empty', role: 'admin' }, TEST_SECRET)
    const { GET } = await import('@/app/api/buttons/route')
    const res = await GET(makeGet('/api/buttons', {}, { 'x-ghl-sso': token }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ buttons: [] })
  })
})
