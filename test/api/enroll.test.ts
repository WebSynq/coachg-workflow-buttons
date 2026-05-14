import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../msw-server'
import { makePost, signTestSso } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

const TEST_SECRET = 'test-sso-key-enroll'

interface EntryShape {
  id: string
  contactId: string
  contactName: string | null
  buttonLabel: string
  workflowId: string
  workflowName: string
  triggeredByUserId: string
  triggeredByUserName: string
  status: 'success' | 'error'
  errorMessage: string | null
  triggeredAt: string
  soaSentAt: string | null
}

async function insertButton(
  db: Awaited<ReturnType<typeof createTestQueryClient>>,
  opts: { locationId: string; label?: string; sendsSoa?: boolean; workflowId?: string; workflowName?: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order, sends_soa)
     VALUES ($1, $2, '#FF0000', $3, $4, 0, $5) RETURNING id`,
    [
      opts.locationId,
      opts.label ?? 'SOA',
      opts.workflowId ?? 'wf-1',
      opts.workflowName ?? 'WF One',
      opts.sendsSoa ?? true,
    ],
  )
  return rows[0].id
}

async function seedToken(
  db: Awaited<ReturnType<typeof createTestQueryClient>>,
  locationId: string,
) {
  await db.query(
    `INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
     VALUES ($1, 'at_fresh', 'rt_fresh', $2)`,
    [locationId, new Date(Date.now() + 600_000).toISOString()],
  )
}

describe('POST /api/enroll', () => {
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

  async function mountDb() {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({ getDb: () => db, resetDbForTests: () => {} }))
  }

  it('returns 401 without an SSO header', async () => {
    await mountDb()
    const { POST } = await import('@/app/api/enroll/route')
    const res = await POST(
      makePost('/api/enroll', {
        buttonId: 'a1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f',
        contactId: 'ctc-1',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when the body fails zod validation', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
    const { POST } = await import('@/app/api/enroll/route')
    const res = await POST(
      makePost(
        '/api/enroll',
        { buttonId: 'not-uuid', contactId: 'c' },
        { 'x-ghl-sso': token },
      ),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when buttonId does not exist', async () => {
    await mountDb()
    await seedToken(db!, 'loc1')
    const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
    const { POST } = await import('@/app/api/enroll/route')
    const res = await POST(
      makePost(
        '/api/enroll',
        {
          buttonId: 'a1b2c3d4-e5f6-4789-9abc-1a2b3c4d5e6f',
          contactId: 'ctc-1',
        },
        { 'x-ghl-sso': token },
      ),
    )
    expect(res.status).toBe(404)
    // No activity row written
    const { rows } = await db!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM activity_log`,
    )
    expect(rows[0].count).toBe('0')
  })

  it('returns 404 when buttonId belongs to a different locationId', async () => {
    await mountDb()
    await seedToken(db!, 'loc-attacker')
    const id = await insertButton(db!, { locationId: 'loc-owner' })
    const token = signTestSso({ locationId: 'loc-attacker', role: 'admin' }, TEST_SECRET)
    const { POST } = await import('@/app/api/enroll/route')
    const res = await POST(
      makePost(
        '/api/enroll',
        { buttonId: id, contactId: 'ctc-1' },
        { 'x-ghl-sso': token },
      ),
    )
    expect(res.status).toBe(404)
  })

  it('on success with sends_soa=true: writes activity_log row with status=success and soa_sent_at populated', async () => {
    await mountDb()
    await seedToken(db!, 'loc-happy')
    const id = await insertButton(db!, {
      locationId: 'loc-happy',
      label: 'Send SOA',
      sendsSoa: true,
      workflowId: 'wf-soa',
      workflowName: 'SOA Workflow',
    })
    server.use(
      http.post(
        'https://services.leadconnectorhq.com/contacts/:contactId/workflow/:workflowId',
        () => HttpResponse.json({}, { status: 200 }),
      ),
    )
    const token = signTestSso(
      { locationId: 'loc-happy', role: 'user', userId: 'usr-7' },
      TEST_SECRET,
    )
    const { POST } = await import('@/app/api/enroll/route')
    const res = await POST(
      makePost(
        '/api/enroll',
        { buttonId: id, contactId: 'ctc-1', contactName: 'Jane Doe' },
        { 'x-ghl-sso': token },
      ),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; entry: EntryShape }
    expect(body.ok).toBe(true)
    expect(body.entry.status).toBe('success')
    expect(body.entry.errorMessage).toBeNull()
    expect(body.entry.soaSentAt).not.toBeNull()
    expect(body.entry.buttonLabel).toBe('Send SOA')
    expect(body.entry.workflowId).toBe('wf-soa')
    expect(body.entry.contactName).toBe('Jane Doe')
    expect(body.entry.triggeredByUserId).toBe('usr-7')

    const { rows } = await db!.query<{ status: string; soa_sent_at: string | null }>(
      `SELECT status, soa_sent_at FROM activity_log`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('success')
    expect(rows[0].soa_sent_at).not.toBeNull()
  })

  it('on success with sends_soa=false: writes activity_log row with status=success and soa_sent_at = null', async () => {
    await mountDb()
    await seedToken(db!, 'loc-non-soa')
    const id = await insertButton(db!, {
      locationId: 'loc-non-soa',
      sendsSoa: false,
    })
    server.use(
      http.post(
        'https://services.leadconnectorhq.com/contacts/:contactId/workflow/:workflowId',
        () => HttpResponse.json({}, { status: 200 }),
      ),
    )
    const token = signTestSso({ locationId: 'loc-non-soa', role: 'user' }, TEST_SECRET)
    const { POST } = await import('@/app/api/enroll/route')
    const res = await POST(
      makePost(
        '/api/enroll',
        { buttonId: id, contactId: 'ctc-2' },
        { 'x-ghl-sso': token },
      ),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entry: EntryShape }
    expect(body.entry.soaSentAt).toBeNull()
  })

  it('on GHL failure: writes activity_log row with status=error + error_message and returns 502', async () => {
    await mountDb()
    await seedToken(db!, 'loc-fail')
    const id = await insertButton(db!, { locationId: 'loc-fail' })
    server.use(
      http.post(
        'https://services.leadconnectorhq.com/contacts/:contactId/workflow/:workflowId',
        () => HttpResponse.json({ error: 'workflow disabled' }, { status: 500 }),
      ),
    )
    const token = signTestSso({ locationId: 'loc-fail', role: 'user' }, TEST_SECRET)
    const { POST } = await import('@/app/api/enroll/route')
    const res = await POST(
      makePost(
        '/api/enroll',
        { buttonId: id, contactId: 'ctc-bad' },
        { 'x-ghl-sso': token },
      ),
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as { ok: boolean; entry: EntryShape }
    expect(body.ok).toBe(false)
    expect(body.entry.status).toBe('error')
    expect(body.entry.errorMessage).toMatch(/GHL request failed: 500/)
    expect(body.entry.soaSentAt).toBeNull()

    const { rows } = await db!.query<{ status: string; error_message: string | null }>(
      `SELECT status, error_message FROM activity_log`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('error')
    expect(rows[0].error_message).toMatch(/GHL request failed: 500/)
  })

  it('returns 429 once the rate limit is exceeded; no activity row written for the blocked call', async () => {
    await mountDb()
    await seedToken(db!, 'loc-limit')
    const id = await insertButton(db!, { locationId: 'loc-limit' })
    server.use(
      http.post(
        'https://services.leadconnectorhq.com/contacts/:contactId/workflow/:workflowId',
        () => HttpResponse.json({}, { status: 200 }),
      ),
    )
    const token = signTestSso(
      { locationId: 'loc-limit', role: 'user', userId: 'usr-rate' },
      TEST_SECRET,
    )
    const { POST } = await import('@/app/api/enroll/route')
    // Burn 10 successful calls.
    for (let i = 0; i < 10; i++) {
      const r = await POST(
        makePost(
          '/api/enroll',
          { buttonId: id, contactId: 'ctc-x' },
          { 'x-ghl-sso': token },
        ),
      )
      expect(r.status).toBe(200)
    }
    // 11th should be blocked.
    const blocked = await POST(
      makePost(
        '/api/enroll',
        { buttonId: id, contactId: 'ctc-x' },
        { 'x-ghl-sso': token },
      ),
    )
    expect(blocked.status).toBe(429)
    const { rows } = await db!.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM activity_log`,
    )
    // 10 successful enrolls only; the 429 didn't add a row.
    expect(rows[0].count).toBe('10')
  })

  it('rejects unknown body keys (strict zod) — locationId in the body is not honored', async () => {
    await mountDb()
    await seedToken(db!, 'loc-strict')
    const id = await insertButton(db!, { locationId: 'loc-strict' })
    const token = signTestSso({ locationId: 'loc-strict', role: 'user' }, TEST_SECRET)
    const { POST } = await import('@/app/api/enroll/route')
    const res = await POST(
      makePost(
        '/api/enroll',
        { buttonId: id, contactId: 'ctc-1', locationId: 'loc-attacker' },
        { 'x-ghl-sso': token },
      ),
    )
    expect(res.status).toBe(400)
  })
})
