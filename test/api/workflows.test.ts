import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../msw-server'
import { makeGet, signTestSso } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

const TEST_SECRET = 'test-sso-key-workflows'

describe('GET /api/workflows', () => {
  let db: Awaited<ReturnType<typeof createTestQueryClient>> | null = null

  beforeEach(() => {
    vi.stubEnv('GHL_SSO_KEY', TEST_SECRET)
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

  async function mountDbWithToken(locationId: string) {
    db = await createTestQueryClient()
    await db.query(
      `INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
       VALUES ($1, 'at_fresh', 'rt_fresh', $2)`,
      [locationId, new Date(Date.now() + 600_000).toISOString()],
    )
    vi.doMock('@/lib/db', () => ({ getDb: () => db, resetDbForTests: () => {} }))
  }

  it('returns 401 when SSO header is missing', async () => {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({ getDb: () => db, resetDbForTests: () => {} }))
    const { GET } = await import('@/app/api/workflows/route')
    const res = await GET(makeGet('/api/workflows'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with the upstream workflow list', async () => {
    await mountDbWithToken('loc-happy')
    server.use(
      http.get('https://services.leadconnectorhq.com/workflows/', () =>
        HttpResponse.json({
          workflows: [
            { id: 'wf1', name: 'Welcome' },
            { id: 'wf2', name: 'SOA' },
          ],
        }),
      ),
    )
    const token = signTestSso({ locationId: 'loc-happy', role: 'user' }, TEST_SECRET)
    const { GET } = await import('@/app/api/workflows/route')
    const res = await GET(makeGet('/api/workflows', {}, { 'x-ghl-sso': token }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      workflows: [
        { id: 'wf1', name: 'Welcome' },
        { id: 'wf2', name: 'SOA' },
      ],
    })
  })

  it('returns 502 when GHL responds non-2xx', async () => {
    await mountDbWithToken('loc-err')
    server.use(
      http.get('https://services.leadconnectorhq.com/workflows/', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
      // refresh attempt on 401 won't fire here (the failure is 500), but
      // keep the handler dormant for clarity:
      http.post('https://services.leadconnectorhq.com/oauth/token', () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    )
    const token = signTestSso({ locationId: 'loc-err', role: 'user' }, TEST_SECRET)
    const { GET } = await import('@/app/api/workflows/route')
    const res = await GET(makeGet('/api/workflows', {}, { 'x-ghl-sso': token }))
    expect(res.status).toBe(502)
  })
})
