import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

describe('rate_limit_check() function', () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  async function check(
    locationId: string,
    userId: string,
    max: number,
  ): Promise<boolean> {
    const { rows } = await db!.query<{ allowed: boolean }>(
      `SELECT rate_limit_check($1, $2, $3) AS allowed`,
      [locationId, userId, max],
    )
    return rows[0].allowed
  }

  it('returns true on the first call within an empty window', async () => {
    db = await createTestDb()
    expect(await check('loc_1', 'usr_1', 10)).toBe(true)
  })

  it('returns true on the 10th call when max=10', async () => {
    db = await createTestDb()
    for (let i = 0; i < 9; i++) {
      await check('loc_1', 'usr_1', 10)
    }
    expect(await check('loc_1', 'usr_1', 10)).toBe(true)
  })

  it('returns false on the 11th call when max=10', async () => {
    db = await createTestDb()
    for (let i = 0; i < 10; i++) {
      await check('loc_1', 'usr_1', 10)
    }
    expect(await check('loc_1', 'usr_1', 10)).toBe(false)
  })

  it('keeps separate buckets per user_id', async () => {
    db = await createTestDb()
    for (let i = 0; i < 10; i++) {
      await check('loc_1', 'usr_1', 10)
    }
    expect(await check('loc_1', 'usr_2', 10)).toBe(true)
  })

  it('keeps separate buckets per location_id', async () => {
    db = await createTestDb()
    for (let i = 0; i < 10; i++) {
      await check('loc_1', 'usr_1', 10)
    }
    expect(await check('loc_2', 'usr_1', 10)).toBe(true)
  })

  it('ignores rows from a prior minute window', async () => {
    db = await createTestDb()
    // Simulate a fully-saturated bucket from two minutes ago.
    await db.exec(`
      INSERT INTO rate_limits (location_id, user_id, window_start, count)
      VALUES ('loc_1', 'usr_1', date_trunc('minute', now()) - interval '2 minutes', 999)
    `)
    expect(await check('loc_1', 'usr_1', 10)).toBe(true)
  })

  it('increments the count column on successive calls', async () => {
    db = await createTestDb()
    await check('loc_1', 'usr_1', 10)
    await check('loc_1', 'usr_1', 10)
    await check('loc_1', 'usr_1', 10)
    const { rows } = await db.query<{ count: number }>(`
      SELECT count FROM rate_limits
      WHERE location_id = 'loc_1' AND user_id = 'usr_1'
        AND window_start = date_trunc('minute', now())
    `)
    expect(rows[0].count).toBe(3)
  })
})
