import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

type Column = {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

describe('buttons table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  async function insertValidButton(label = 'Hot Lead', color = '#ff0000') {
    await db!.exec(`
      INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
      VALUES ('loc_1', '${label}', '${color}', 'wf_1', 'Nurture', 0)
    `)
  }

  it('exists with the expected columns', async () => {
    db = await createTestDb()
    const { rows } = await db.query<Column>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'buttons'
      ORDER BY ordinal_position
    `)
    expect(rows.map((r) => r.column_name)).toEqual([
      'id',
      'location_id',
      'label',
      'color',
      'workflow_id',
      'workflow_name',
      'sort_order',
      'created_at',
      'updated_at',
      'sends_soa',
    ])
  })

  it('defaults sends_soa to true on a row that omits it', async () => {
    db = await createTestDb()
    await insertValidButton()
    const { rows } = await db.query<{ sends_soa: boolean }>(
      `SELECT sends_soa FROM buttons`,
    )
    expect(rows[0].sends_soa).toBe(true)
  })

  it('accepts sends_soa = false for non-SOA buttons', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order, sends_soa)
      VALUES ('loc_1', 'Add to Drip', '#0066cc', 'wf_2', 'Email Drip', 0, false)
    `)
    const { rows } = await db.query<{ sends_soa: boolean }>(
      `SELECT sends_soa FROM buttons`,
    )
    expect(rows[0].sends_soa).toBe(false)
  })

  it('rejects rows that explicitly set sends_soa to null', async () => {
    db = await createTestDb()
    await expect(
      db.exec(`
        INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order, sends_soa)
        VALUES ('loc_1', 'Broken', '#000000', 'wf_3', 'X', 0, NULL)
      `),
    ).rejects.toThrow()
  })

  it('generates a uuid id by default', async () => {
    db = await createTestDb()
    await insertValidButton()
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM buttons`)
    expect(rows[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('rejects an invalid color format', async () => {
    db = await createTestDb()
    await expect(
      db.exec(`
        INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
        VALUES ('loc_1', 'Bad', 'red', 'wf_1', 'Nurture', 0)
      `),
    ).rejects.toThrow()
  })

  it('rejects a 4-digit hex color', async () => {
    db = await createTestDb()
    await expect(
      db.exec(`
        INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
        VALUES ('loc_1', 'Bad', '#fff', 'wf_1', 'Nurture', 0)
      `),
    ).rejects.toThrow()
  })

  it('accepts both lowercase and uppercase 6-digit hex colors', async () => {
    db = await createTestDb()
    await insertValidButton('Lower', '#abcdef')
    await insertValidButton('Upper', '#ABCDEF')
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM buttons`,
    )
    expect(rows[0].count).toBe('2')
  })

  it('rejects a label longer than 50 characters', async () => {
    db = await createTestDb()
    const longLabel = 'x'.repeat(51)
    await expect(
      db.exec(`
        INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
        VALUES ('loc_1', '${longLabel}', '#ff0000', 'wf_1', 'Nurture', 0)
      `),
    ).rejects.toThrow()
  })

  it('has an index on (location_id, sort_order)', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'buttons'
    `)
    const defs = rows.map((r) => r.indexdef).join('\n')
    expect(defs).toMatch(/\(location_id,\s*sort_order\)/)
  })

  it('bumps updated_at via trigger on UPDATE', async () => {
    db = await createTestDb()
    await insertValidButton()
    const before = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM buttons LIMIT 1`,
    )
    await new Promise((r) => setTimeout(r, 5))
    await db.exec(`UPDATE buttons SET label = 'Renamed'`)
    const after = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM buttons LIMIT 1`,
    )
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].updated_at).getTime(),
    )
  })
})
