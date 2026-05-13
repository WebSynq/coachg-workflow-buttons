import { afterEach, describe, expect, it } from 'vitest'
import { makeGet } from './route-helpers'
import { createTestQueryClient } from './db-fixture'

describe('Phase 2 test harness', () => {
  it('makeGet builds a NextRequest with the expected URL', () => {
    const req = makeGet('/api/oauth/callback', { code: 'abc' })
    expect(req.method).toBe('GET')
    expect(req.nextUrl.pathname).toBe('/api/oauth/callback')
    expect(req.nextUrl.searchParams.get('code')).toBe('abc')
  })

  describe('createTestQueryClient', () => {
    let db: Awaited<ReturnType<typeof createTestQueryClient>> | null = null

    afterEach(async () => {
      if (db) {
        await db.end()
        db = null
      }
    })

    it('applies the migration and the four tables exist', async () => {
      db = await createTestQueryClient()
      const { rows } = await db.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `)
      expect(rows.map((r) => r.table_name)).toEqual([
        'activity_log',
        'buttons',
        'ghl_tokens',
        'rate_limits',
      ])
    })
  })
})
