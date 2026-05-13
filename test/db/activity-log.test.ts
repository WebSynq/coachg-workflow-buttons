import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

describe('activity_log table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  async function insertSuccessRow() {
    await db!.exec(`
      INSERT INTO activity_log (
        location_id, contact_id, contact_name, button_label,
        workflow_id, workflow_name,
        triggered_by_user_id, triggered_by_user_name, status
      )
      VALUES (
        'loc_1', 'con_1', 'Jane Doe', 'Hot Lead',
        'wf_1', 'Nurture',
        'usr_1', 'Tim', 'success'
      )
    `)
  }

  it('exists with the expected columns', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'activity_log'
      ORDER BY ordinal_position
    `)
    expect(rows.map((r) => r.column_name)).toEqual([
      'id',
      'location_id',
      'contact_id',
      'contact_name',
      'button_label',
      'workflow_id',
      'workflow_name',
      'triggered_by_user_id',
      'triggered_by_user_name',
      'status',
      'error_message',
      'triggered_at',
      'soa_sent_at',
    ])
  })

  it('soa_sent_at is nullable and defaults to NULL on success rows', async () => {
    db = await createTestDb()
    await insertSuccessRow()
    const { rows } = await db.query<{ soa_sent_at: string | null }>(
      `SELECT soa_sent_at FROM activity_log`,
    )
    expect(rows[0].soa_sent_at).toBeNull()
  })

  it('accepts a row with soa_sent_at populated', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO activity_log (
        location_id, contact_id, button_label, workflow_id, workflow_name,
        triggered_by_user_id, triggered_by_user_name, status, soa_sent_at
      )
      VALUES (
        'loc_1', 'con_1', 'Send SOA', 'wf_1', 'Send Scope of Appointment',
        'usr_1', 'Tim', 'success', now()
      )
    `)
    const { rows } = await db.query<{ soa_sent_at: string | null }>(
      `SELECT soa_sent_at FROM activity_log`,
    )
    expect(rows[0].soa_sent_at).not.toBeNull()
    const ageMs = Date.now() - new Date(rows[0].soa_sent_at!).getTime()
    expect(ageMs).toBeLessThan(5000)
  })

  it('has a partial index for SOA last-sent lookups', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'activity_log'
    `)
    const defs = rows.map((r) => r.indexdef).join('\n')
    expect(defs).toMatch(/\(location_id,\s*contact_id,\s*soa_sent_at DESC\)/)
    expect(defs).toMatch(/WHERE \(?soa_sent_at IS NOT NULL\)?/i)
  })

  it('accepts a successful enrollment row', async () => {
    db = await createTestDb()
    await insertSuccessRow()
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM activity_log`,
    )
    expect(rows[0].count).toBe('1')
  })

  it('accepts an error row with an error_message', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO activity_log (
        location_id, contact_id, button_label, workflow_id, workflow_name,
        triggered_by_user_id, triggered_by_user_name, status, error_message
      )
      VALUES (
        'loc_1', 'con_1', 'Hot Lead', 'wf_1', 'Nurture',
        'usr_1', 'Tim', 'error', 'GHL returned 502'
      )
    `)
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM activity_log`,
    )
    expect(rows[0].count).toBe('1')
  })

  it('allows a null contact_name', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO activity_log (
        location_id, contact_id, button_label, workflow_id, workflow_name,
        triggered_by_user_id, triggered_by_user_name, status
      )
      VALUES (
        'loc_1', 'con_1', 'Hot Lead', 'wf_1', 'Nurture',
        'usr_1', 'Tim', 'success'
      )
    `)
    const { rows } = await db.query<{ contact_name: string | null }>(
      `SELECT contact_name FROM activity_log`,
    )
    expect(rows[0].contact_name).toBeNull()
  })

  it('rejects a status that is not success or error', async () => {
    db = await createTestDb()
    await expect(
      db.exec(`
        INSERT INTO activity_log (
          location_id, contact_id, button_label, workflow_id, workflow_name,
          triggered_by_user_id, triggered_by_user_name, status
        )
        VALUES (
          'loc_1', 'con_1', 'Hot Lead', 'wf_1', 'Nurture',
          'usr_1', 'Tim', 'pending'
        )
      `),
    ).rejects.toThrow()
  })

  it('defaults triggered_at to now()', async () => {
    db = await createTestDb()
    await insertSuccessRow()
    const { rows } = await db.query<{ triggered_at: string }>(
      `SELECT triggered_at FROM activity_log`,
    )
    const ageMs = Date.now() - new Date(rows[0].triggered_at).getTime()
    expect(ageMs).toBeLessThan(5000)
    expect(ageMs).toBeGreaterThanOrEqual(0)
  })

  it('has an index on (location_id, contact_id, triggered_at DESC)', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'activity_log'
    `)
    const defs = rows.map((r) => r.indexdef).join('\n')
    expect(defs).toMatch(/\(location_id,\s*contact_id,\s*triggered_at DESC\)/)
  })

  it('has an index on (location_id, triggered_at DESC) for admin history reads', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'activity_log'
    `)
    const defs = rows.map((r) => r.indexdef).join('\n')
    expect(defs).toMatch(/\(location_id,\s*triggered_at DESC\)/)
  })
})
