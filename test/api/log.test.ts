import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeGet, signTestSso } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

const TEST_SECRET = 'test-sso-key-log'

interface ActivityInsert {
  locationId: string
  contactId: string
  status?: 'success' | 'error'
  triggeredAt?: string
  soaSentAt?: string | null
  buttonLabel?: string
  errorMessage?: string | null
}

async function insertActivity(
  db: Awaited<ReturnType<typeof createTestQueryClient>>,
  opts: ActivityInsert,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO activity_log
      (location_id, contact_id, contact_name, button_label, workflow_id, workflow_name,
       triggered_by_user_id, triggered_by_user_name, status, error_message,
       triggered_at, soa_sent_at)
     VALUES ($1, $2, 'Name', $3, 'wf', 'WF', 'u1', 'u1', $4, $5, $6, $7)
     RETURNING id`,
    [
      opts.locationId,
      opts.contactId,
      opts.buttonLabel ?? 'B',
      opts.status ?? 'success',
      opts.errorMessage ?? null,
      opts.triggeredAt ?? new Date().toISOString(),
      opts.soaSentAt ?? null,
    ],
  )
  return rows[0].id
}

describe('GET /api/log', () => {
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
    const { GET } = await import('@/app/api/log/route')
    const res = await GET(makeGet('/api/log'))
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid query (negative offset)', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
    const { GET } = await import('@/app/api/log/route')
    const res = await GET(
      makeGet('/api/log', { offset: '-1' }, { 'x-ghl-sso': token }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 on invalid query (limit > 100)', async () => {
    await mountDb()
    const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
    const { GET } = await import('@/app/api/log/route')
    const res = await GET(
      makeGet('/api/log', { limit: '101' }, { 'x-ghl-sso': token }),
    )
    expect(res.status).toBe(400)
  })

  describe('widget mode (contactId present)', () => {
    it('returns last 5 entries ordered by triggered_at DESC, scoped to (locationId, contactId)', async () => {
      await mountDb()
      // Seed 7 rows for (loc1, ctc-1) at distinct times
      const baseMs = Date.parse('2026-05-01T12:00:00Z')
      for (let i = 0; i < 7; i++) {
        await insertActivity(db!, {
          locationId: 'loc1',
          contactId: 'ctc-1',
          buttonLabel: `B${i}`,
          triggeredAt: new Date(baseMs + i * 60_000).toISOString(),
        })
      }
      // Rows that must NOT appear (different contact or location)
      await insertActivity(db!, { locationId: 'loc1', contactId: 'ctc-other', buttonLabel: 'X' })
      await insertActivity(db!, { locationId: 'loc-other', contactId: 'ctc-1', buttonLabel: 'Y' })

      const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
      const { GET } = await import('@/app/api/log/route')
      const res = await GET(
        makeGet('/api/log', { contactId: 'ctc-1' }, { 'x-ghl-sso': token }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        entries: Array<{ buttonLabel: string; triggeredAt: string }>
        lastSoaSentAt: string | null
      }
      expect(body.entries).toHaveLength(5)
      // newest 5 = B6, B5, B4, B3, B2 (DESC)
      expect(body.entries.map(e => e.buttonLabel)).toEqual(['B6', 'B5', 'B4', 'B3', 'B2'])
    })

    it('returns lastSoaSentAt = max(soa_sent_at) for (locationId, contactId), even when older than the last 5', async () => {
      await mountDb()
      // Very old SOA — should still surface as lastSoaSentAt
      const old = '2026-01-01T00:00:00.000Z'
      await insertActivity(db!, {
        locationId: 'loc1',
        contactId: 'ctc-1',
        triggeredAt: '2026-01-01T00:00:00.000Z',
        soaSentAt: old,
      })
      // 5 newer rows without an SOA stamp
      for (let i = 0; i < 5; i++) {
        await insertActivity(db!, {
          locationId: 'loc1',
          contactId: 'ctc-1',
          triggeredAt: `2026-05-${(i + 1).toString().padStart(2, '0')}T00:00:00Z`,
          soaSentAt: null,
        })
      }
      const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
      const { GET } = await import('@/app/api/log/route')
      const res = await GET(
        makeGet('/api/log', { contactId: 'ctc-1' }, { 'x-ghl-sso': token }),
      )
      const body = (await res.json()) as { entries: unknown[]; lastSoaSentAt: string | null }
      // entries[] has only the 5 newest (none with SOA), but lastSoaSentAt is set
      expect(body.entries).toHaveLength(5)
      expect(body.lastSoaSentAt).not.toBeNull()
      expect(Date.parse(body.lastSoaSentAt!)).toBe(Date.parse(old))
    })

    it('returns lastSoaSentAt = null when no SOA-bearing row exists for the contact', async () => {
      await mountDb()
      await insertActivity(db!, { locationId: 'loc1', contactId: 'ctc-1', soaSentAt: null })
      const token = signTestSso({ locationId: 'loc1', role: 'user' }, TEST_SECRET)
      const { GET } = await import('@/app/api/log/route')
      const res = await GET(
        makeGet('/api/log', { contactId: 'ctc-1' }, { 'x-ghl-sso': token }),
      )
      const body = (await res.json()) as { entries: unknown[]; lastSoaSentAt: string | null }
      expect(body.lastSoaSentAt).toBeNull()
    })
  })

  describe('admin mode (no contactId)', () => {
    it('returns paginated entries + total count, ordered DESC, scoped to locationId', async () => {
      await mountDb()
      const baseMs = Date.parse('2026-05-01T12:00:00Z')
      for (let i = 0; i < 25; i++) {
        await insertActivity(db!, {
          locationId: 'loc1',
          contactId: `ctc-${i}`,
          buttonLabel: `B${i}`,
          triggeredAt: new Date(baseMs + i * 60_000).toISOString(),
        })
      }
      // Other tenant — must NOT leak
      await insertActivity(db!, { locationId: 'loc-other', contactId: 'x', buttonLabel: 'BX' })

      const token = signTestSso({ locationId: 'loc1', role: 'admin' }, TEST_SECRET)
      const { GET } = await import('@/app/api/log/route')
      const res = await GET(makeGet('/api/log', {}, { 'x-ghl-sso': token }))
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        entries: Array<{ buttonLabel: string }>
        total: number
        limit: number
        offset: number
      }
      expect(body.total).toBe(25)
      expect(body.limit).toBe(20)
      expect(body.offset).toBe(0)
      expect(body.entries).toHaveLength(20)
      // newest first
      expect(body.entries[0].buttonLabel).toBe('B24')
    })

    it('respects custom limit and offset', async () => {
      await mountDb()
      for (let i = 0; i < 10; i++) {
        await insertActivity(db!, {
          locationId: 'loc1',
          contactId: 'c',
          buttonLabel: `B${i}`,
          triggeredAt: new Date(Date.now() + i * 1000).toISOString(),
        })
      }
      const token = signTestSso({ locationId: 'loc1', role: 'admin' }, TEST_SECRET)
      const { GET } = await import('@/app/api/log/route')
      const res = await GET(
        makeGet('/api/log', { limit: '3', offset: '2' }, { 'x-ghl-sso': token }),
      )
      const body = (await res.json()) as {
        entries: Array<{ buttonLabel: string }>
        total: number
        limit: number
        offset: number
      }
      expect(body.limit).toBe(3)
      expect(body.offset).toBe(2)
      expect(body.entries).toHaveLength(3)
      // entries are DESC; skipping the first 2 (B9, B8) leaves [B7, B6, B5]
      expect(body.entries.map(e => e.buttonLabel)).toEqual(['B7', 'B6', 'B5'])
    })
  })
})
