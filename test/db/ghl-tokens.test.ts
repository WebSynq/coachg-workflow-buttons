import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

type Column = {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

describe('ghl_tokens table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  it('exists with the expected columns', async () => {
    db = await createTestDb()
    const { rows } = await db.query<Column>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ghl_tokens'
      ORDER BY ordinal_position
    `)
    expect(rows.map((r) => r.column_name)).toEqual([
      'location_id',
      'access_token',
      'refresh_token',
      'expires_at',
      'created_at',
      'updated_at',
    ])
  })

  it('uses location_id as the primary key', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ column_name: string }>(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        USING (constraint_schema, constraint_name)
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'ghl_tokens'
        AND tc.constraint_type = 'PRIMARY KEY'
    `)
    expect(rows.map((r) => r.column_name)).toEqual(['location_id'])
  })

  it('rejects rows with null access_token, refresh_token, or expires_at', async () => {
    db = await createTestDb()
    await expect(
      db.exec(`INSERT INTO ghl_tokens (location_id) VALUES ('loc_1')`),
    ).rejects.toThrow()
  })

  it('accepts a complete row insert', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
      VALUES ('loc_1', 'at', 'rt', now() + interval '1 hour')
    `)
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ghl_tokens`,
    )
    expect(rows[0].count).toBe('1')
  })

  it('bumps updated_at via trigger on UPDATE', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
      VALUES ('loc_1', 'at', 'rt', now() + interval '1 hour')
    `)
    const before = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM ghl_tokens WHERE location_id = 'loc_1'`,
    )

    // Wait long enough for now() to advance by at least 1 ms.
    await new Promise((r) => setTimeout(r, 5))

    await db.exec(`
      UPDATE ghl_tokens SET access_token = 'at2' WHERE location_id = 'loc_1'
    `)
    const after = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM ghl_tokens WHERE location_id = 'loc_1'`,
    )

    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].updated_at).getTime(),
    )
  })
})
