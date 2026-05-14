import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw-server'
import { createTestQueryClient } from '../test/api/db-fixture'

const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token'

describe('getGhlClient', () => {
  let db: Awaited<ReturnType<typeof createTestQueryClient>> | null = null

  beforeEach(() => {
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

  async function seedToken(opts: {
    locationId: string
    accessToken: string
    refreshToken: string
    expiresAt: string
  }) {
    db = await createTestQueryClient()
    await db.query(
      `INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [opts.locationId, opts.accessToken, opts.refreshToken, opts.expiresAt],
    )
    vi.doMock('@/lib/db', () => ({
      getDb: () => db,
      resetDbForTests: () => {},
    }))
  }

  it('refreshes the token when it is within 60s of expiry, persists the new pair, and uses the new access token on subsequent calls', async () => {
    await seedToken({
      locationId: 'loc1',
      accessToken: 'at_old',
      refreshToken: 'rt_old',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    })

    let workflowsAuth: string | null = null
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: 'at_new',
          refresh_token: 'rt_new',
          expires_in: 3600,
          locationId: 'loc1',
        }),
      ),
      http.get('https://services.leadconnectorhq.com/workflows/', ({ request }) => {
        workflowsAuth = request.headers.get('Authorization')
        const url = new URL(request.url)
        expect(url.searchParams.get('locationId')).toBe('loc1')
        return HttpResponse.json({ workflows: [{ id: 'wf1', name: 'Welcome' }] })
      }),
    )

    const { getGhlClient } = await import('@/lib/ghl')
    const client = await getGhlClient('loc1')
    const workflows = await client.workflows.list()

    expect(workflows).toEqual([{ id: 'wf1', name: 'Welcome' }])
    expect(workflowsAuth).toBe('Bearer at_new')

    const { rows } = await db!.query<{
      access_token: string
      refresh_token: string
    }>(`SELECT access_token, refresh_token FROM ghl_tokens WHERE location_id = 'loc1'`)
    expect(rows[0]).toEqual({ access_token: 'at_new', refresh_token: 'rt_new' })
  })

  it('uses the existing access token when the token is more than 60s from expiry', async () => {
    await seedToken({
      locationId: 'loc2',
      accessToken: 'at_fresh',
      refreshToken: 'rt_fresh',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    let workflowsAuth: string | null = null
    let refreshHits = 0
    server.use(
      http.post(TOKEN_URL, () => {
        refreshHits++
        return HttpResponse.json({}, { status: 500 })
      }),
      http.get('https://services.leadconnectorhq.com/workflows/', ({ request }) => {
        workflowsAuth = request.headers.get('Authorization')
        return HttpResponse.json({ workflows: [] })
      }),
    )

    const { getGhlClient } = await import('@/lib/ghl')
    const client = await getGhlClient('loc2')
    await client.workflows.list()

    expect(workflowsAuth).toBe('Bearer at_fresh')
    expect(refreshHits).toBe(0)
  })

  it('throws a clear error if no ghl_tokens row exists for the locationId', async () => {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({
      getDb: () => db,
      resetDbForTests: () => {},
    }))

    const { getGhlClient } = await import('@/lib/ghl')

    await expect(getGhlClient('missing_loc')).rejects.toThrow(
      /no ghl_tokens row for locationId=missing_loc/,
    )
  })

  it('on a 401 from workflows.list, refreshes the token, persists it, and retries once with the new bearer', async () => {
    await seedToken({
      locationId: 'loc3',
      accessToken: 'at_stale',
      refreshToken: 'rt_stale',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    let workflowsHits = 0
    let refreshHits = 0
    const seenAuths: string[] = []
    server.use(
      http.post(TOKEN_URL, () => {
        refreshHits++
        return HttpResponse.json({
          access_token: 'at_post_retry',
          refresh_token: 'rt_post_retry',
          expires_in: 3600,
          locationId: 'loc3',
        })
      }),
      http.get('https://services.leadconnectorhq.com/workflows/', ({ request }) => {
        workflowsHits++
        seenAuths.push(request.headers.get('Authorization') ?? '')
        if (workflowsHits === 1) {
          return HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
        }
        return HttpResponse.json({ workflows: [{ id: 'wf1', name: 'X' }] })
      }),
    )

    const { getGhlClient } = await import('@/lib/ghl')
    const client = await getGhlClient('loc3')
    const workflows = await client.workflows.list()

    expect(workflows).toEqual([{ id: 'wf1', name: 'X' }])
    expect(workflowsHits).toBe(2)
    expect(refreshHits).toBe(1)
    expect(seenAuths).toEqual(['Bearer at_stale', 'Bearer at_post_retry'])

    const { rows } = await db!.query<{ access_token: string }>(
      `SELECT access_token FROM ghl_tokens WHERE location_id = 'loc3'`,
    )
    expect(rows[0].access_token).toBe('at_post_retry')
  })

  it('does not loop: a second 401 after the retry is surfaced as an error', async () => {
    await seedToken({
      locationId: 'loc4',
      accessToken: 'at_stale',
      refreshToken: 'rt_stale',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    let workflowsHits = 0
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: 'at_new',
          refresh_token: 'rt_new',
          expires_in: 3600,
          locationId: 'loc4',
        }),
      ),
      http.get('https://services.leadconnectorhq.com/workflows/', () => {
        workflowsHits++
        return HttpResponse.json({ error: 'still unauthorized' }, { status: 401 })
      }),
    )

    const { getGhlClient } = await import('@/lib/ghl')
    const client = await getGhlClient('loc4')

    await expect(client.workflows.list()).rejects.toThrow(/GHL request failed: 401/)
    expect(workflowsHits).toBe(2)
  })

  it('contact.enroll posts the documented body shape to the documented path and retries once on 401', async () => {
    await seedToken({
      locationId: 'loc5',
      accessToken: 'at_stale',
      refreshToken: 'rt_stale',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })

    let enrollHits = 0
    let lastBody: unknown = null
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: 'at_fresh',
          refresh_token: 'rt_fresh',
          expires_in: 3600,
          locationId: 'loc5',
        }),
      ),
      http.post(
        'https://services.leadconnectorhq.com/contacts/:contactId/workflow/:workflowId',
        async ({ request, params }) => {
          enrollHits++
          if (enrollHits === 1) {
            return HttpResponse.json({}, { status: 401 })
          }
          expect(params.contactId).toBe('contact-xyz')
          expect(params.workflowId).toBe('wf-abc')
          lastBody = await request.json()
          return HttpResponse.json({}, { status: 200 })
        },
      ),
    )

    const { getGhlClient } = await import('@/lib/ghl')
    const client = await getGhlClient('loc5')
    await client.contact.enroll('wf-abc', 'contact-xyz')

    expect(enrollHits).toBe(2)
    expect(lastBody).toEqual({
      eventStartTime: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
      ),
    })
  })

  it('surfaces a refresh failure (refresh endpoint returns 400) as a clean error', async () => {
    await seedToken({
      locationId: 'loc6',
      accessToken: 'at_old',
      refreshToken: 'rt_revoked',
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
    })

    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
      ),
    )

    const { getGhlClient } = await import('@/lib/ghl')

    await expect(getGhlClient('loc6')).rejects.toThrow(/GHL token refresh failed: 400/)
  })
})
