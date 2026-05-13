import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

describe('rate_limits table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  it('exists with the expected columns', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'rate_limits'
      ORDER BY ordinal_position
    `)
    expect(rows.map((r) => r.column_name)).toEqual([
      'location_id',
      'user_id',
      'window_start',
      'count',
    ])
  })

  it('uses (location_id, user_id, window_start) as the primary key', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ column_name: string }>(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        USING (constraint_schema, constraint_name)
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'rate_limits'
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `)
    expect(rows.map((r) => r.column_name)).toEqual([
      'location_id',
      'user_id',
      'window_start',
    ])
  })

  it('defaults count to 1', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO rate_limits (location_id, user_id, window_start)
      VALUES ('loc_1', 'usr_1', now())
    `)
    const { rows } = await db.query<{ count: number }>(
      `SELECT count FROM rate_limits`,
    )
    expect(rows[0].count).toBe(1)
  })

  it('rejects a duplicate (location_id, user_id, window_start) insert', async () => {
    db = await createTestDb()
    const window = "date_trunc('minute', now())"
    await db.exec(`
      INSERT INTO rate_limits (location_id, user_id, window_start)
      VALUES ('loc_1', 'usr_1', ${window})
    `)
    await expect(
      db.exec(`
        INSERT INTO rate_limits (location_id, user_id, window_start)
        VALUES ('loc_1', 'usr_1', ${window})
      `),
    ).rejects.toThrow()
  })
})
