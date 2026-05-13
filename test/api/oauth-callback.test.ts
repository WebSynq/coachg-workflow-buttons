import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../msw-server'
import { makeGet } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

describe('GET /api/oauth/callback', () => {
  let db: Awaited<ReturnType<typeof createTestQueryClient>> | null = null

  beforeEach(() => {
    vi.stubEnv('GHL_CLIENT_ID', 'cid')
    vi.stubEnv('GHL_CLIENT_SECRET', 'csecret')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
  })

  afterEach(async () => {
    if (db) {
      await db.end()
      db = null
    }
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('exchanges the code, upserts the token row, and redirects to /admin', async () => {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({
      getDb: () => db,
      resetDbForTests: () => {},
    }))

    server.use(
      http.post('https://services.leadconnectorhq.com/oauth/token', () =>
        HttpResponse.json({
          access_token: 'at_xyz',
          refresh_token: 'rt_xyz',
          expires_in: 3600,
          locationId: 'loc_abc',
        }),
      ),
    )

    const { GET } = await import('@/app/api/oauth/callback/route')
    const res = await GET(makeGet('/api/oauth/callback', { code: 'authcode' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('Location')).toBe(
      'https://app.example.com/admin?locationId=loc_abc',
    )

    const { rows } = await db.query<{
      location_id: string
      access_token: string
      refresh_token: string
    }>(`SELECT location_id, access_token, refresh_token FROM ghl_tokens`)
    expect(rows).toEqual([
      { location_id: 'loc_abc', access_token: 'at_xyz', refresh_token: 'rt_xyz' },
    ])
  })
})
