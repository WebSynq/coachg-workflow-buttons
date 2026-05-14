import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestQueryClient } from '../test/api/db-fixture'

describe('checkRateLimit', () => {
  let db: Awaited<ReturnType<typeof createTestQueryClient>> | null = null

  afterEach(async () => {
    if (db) {
      await db.end()
      db = null
    }
    vi.resetModules()
  })

  async function mountDb() {
    db = await createTestQueryClient()
    vi.doMock('@/lib/db', () => ({ getDb: () => db, resetDbForTests: () => {} }))
  }

  it('returns true for calls 1 through 10 within the same minute', async () => {
    await mountDb()
    const { checkRateLimit } = await import('@/lib/rate-limit')
    for (let i = 0; i < 10; i++) {
      expect(await checkRateLimit('loc1', 'usr1')).toBe(true)
    }
  })

  it('returns false on the 11th call within the same minute', async () => {
    await mountDb()
    const { checkRateLimit } = await import('@/lib/rate-limit')
    for (let i = 0; i < 10; i++) {
      await checkRateLimit('loc1', 'usr1')
    }
    expect(await checkRateLimit('loc1', 'usr1')).toBe(false)
  })

  it('uses independent buckets per (locationId, userId)', async () => {
    await mountDb()
    const { checkRateLimit } = await import('@/lib/rate-limit')
    for (let i = 0; i < 10; i++) {
      await checkRateLimit('loc1', 'usr1')
    }
    // Different user, same location — fresh bucket
    expect(await checkRateLimit('loc1', 'usr2')).toBe(true)
    // Different location, same user — fresh bucket
    expect(await checkRateLimit('loc2', 'usr1')).toBe(true)
  })
})
