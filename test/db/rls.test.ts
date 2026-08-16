import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

type Db = Awaited<ReturnType<typeof createTestDb>>

/**
 * PGlite's default connection is a superuser, and superusers bypass RLS.
 * `SET ROLE app_runtime` inside the same multi-statement `exec()` batch is
 * what makes the policies observable — a test that forgets it passes for
 * the wrong reason. `SET LOCAL` is transaction-scoped, and a multi-statement
 * simple-query batch runs as one implicit transaction, so folding the GUC
 * and the query into a single `exec()` call keeps `SET LOCAL` in effect for
 * that query without leaking it to the next call.
 */
async function selectAsAppRuntime<T = Record<string, unknown>>(
  db: Db,
  locationId: string | null,
  sql: string,
): Promise<T[]> {
  const guc = locationId ? `SET LOCAL app.location_id = '${locationId}';` : ''
  const results = await db.exec(`SET ROLE app_runtime; ${guc} ${sql};`)
  return results[results.length - 1].rows as T[]
}

async function updateAsAppRuntime(
  db: Db,
  locationId: string | null,
  sql: string,
): Promise<number> {
  const guc = locationId ? `SET LOCAL app.location_id = '${locationId}';` : ''
  const results = await db.exec(`SET ROLE app_runtime; ${guc} ${sql};`)
  return results[results.length - 1].affectedRows ?? 0
}

describe('RLS tenant isolation', () => {
  let db: Db | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  describe('buttons', () => {
    async function seed() {
      const a = await db!.query<{ id: string }>(`
        INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
        VALUES ('loc_a', 'A Button', '#ff0000', 'wf_1', 'Nurture', 0)
        RETURNING id
      `)
      const b = await db!.query<{ id: string }>(`
        INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
        VALUES ('loc_b', 'B Button', '#00ff00', 'wf_2', 'Follow Up', 0)
        RETURNING id
      `)
      return { aId: a.rows[0].id, bId: b.rows[0].id }
    }

    it('SELECT with app.location_id = A returns only A rows', async () => {
      db = await createTestDb()
      await seed()
      const rows = await selectAsAppRuntime(db, 'loc_a', `SELECT * FROM buttons`)
      expect(rows).toHaveLength(1)
      expect((rows[0] as { location_id: string }).location_id).toBe('loc_a')
    })

    it('SELECT with app.location_id unset returns zero rows', async () => {
      db = await createTestDb()
      await seed()
      const rows = await selectAsAppRuntime(db, null, `SELECT * FROM buttons`)
      expect(rows).toHaveLength(0)
    })

    it('UPDATE targeting B row while GUC is A affects zero rows', async () => {
      db = await createTestDb()
      const { bId } = await seed()
      const affected = await updateAsAppRuntime(
        db,
        'loc_a',
        `UPDATE buttons SET label = 'Hijacked' WHERE id = '${bId}'`,
      )
      expect(affected).toBe(0)
    })
  })

  describe('activity_log', () => {
    async function seed() {
      const a = await db!.query<{ id: string }>(`
        INSERT INTO activity_log (
          location_id, contact_id, contact_name, button_label,
          workflow_id, workflow_name, triggered_by_user_id, triggered_by_user_name, status
        )
        VALUES ('loc_a', 'con_a', 'Alice', 'Hot Lead', 'wf_1', 'Nurture', 'usr_1', 'Tim', 'success')
        RETURNING id
      `)
      const b = await db!.query<{ id: string }>(`
        INSERT INTO activity_log (
          location_id, contact_id, contact_name, button_label,
          workflow_id, workflow_name, triggered_by_user_id, triggered_by_user_name, status
        )
        VALUES ('loc_b', 'con_b', 'Bob', 'Hot Lead', 'wf_1', 'Nurture', 'usr_2', 'Sam', 'success')
        RETURNING id
      `)
      return { aId: a.rows[0].id, bId: b.rows[0].id }
    }

    it('SELECT with app.location_id = A returns only A rows', async () => {
      db = await createTestDb()
      await seed()
      const rows = await selectAsAppRuntime(db, 'loc_a', `SELECT * FROM activity_log`)
      expect(rows).toHaveLength(1)
      expect((rows[0] as { location_id: string }).location_id).toBe('loc_a')
    })

    it('SELECT with app.location_id unset returns zero rows', async () => {
      db = await createTestDb()
      await seed()
      const rows = await selectAsAppRuntime(db, null, `SELECT * FROM activity_log`)
      expect(rows).toHaveLength(0)
    })

    it('UPDATE targeting B row while GUC is A affects zero rows', async () => {
      db = await createTestDb()
      const { bId } = await seed()
      const affected = await updateAsAppRuntime(
        db,
        'loc_a',
        `UPDATE activity_log SET status = 'error' WHERE id = '${bId}'`,
      )
      expect(affected).toBe(0)
    })
  })

  describe('ghl_tokens', () => {
    async function seed() {
      await db!.exec(`
        INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
        VALUES ('loc_a', 'at_a', 'rt_a', now() + interval '1 hour')
      `)
      await db!.exec(`
        INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
        VALUES ('loc_b', 'at_b', 'rt_b', now() + interval '1 hour')
      `)
    }

    it('SELECT with app.location_id = A returns only A rows', async () => {
      db = await createTestDb()
      await seed()
      const rows = await selectAsAppRuntime(db, 'loc_a', `SELECT * FROM ghl_tokens`)
      expect(rows).toHaveLength(1)
      expect((rows[0] as { location_id: string }).location_id).toBe('loc_a')
    })

    it('SELECT with app.location_id unset returns zero rows', async () => {
      db = await createTestDb()
      await seed()
      const rows = await selectAsAppRuntime(db, null, `SELECT * FROM ghl_tokens`)
      expect(rows).toHaveLength(0)
    })

    it('UPDATE targeting B row while GUC is A affects zero rows', async () => {
      db = await createTestDb()
      await seed()
      const affected = await updateAsAppRuntime(
        db,
        'loc_a',
        `UPDATE ghl_tokens SET access_token = 'hijacked' WHERE location_id = 'loc_b'`,
      )
      expect(affected).toBe(0)
    })
  })

  describe('rate_limits', () => {
    async function seed() {
      await db!.exec(`
        INSERT INTO rate_limits (location_id, user_id, window_start, count)
        VALUES ('loc_a', 'usr_1', date_trunc('minute', now()), 1)
      `)
      await db!.exec(`
        INSERT INTO rate_limits (location_id, user_id, window_start, count)
        VALUES ('loc_b', 'usr_1', date_trunc('minute', now()), 1)
      `)
    }

    it('SELECT with app.location_id = A returns only A rows', async () => {
      db = await createTestDb()
      await seed()
      const rows = await selectAsAppRuntime(db, 'loc_a', `SELECT * FROM rate_limits`)
      expect(rows).toHaveLength(1)
      expect((rows[0] as { location_id: string }).location_id).toBe('loc_a')
    })

    it('SELECT with app.location_id unset returns zero rows', async () => {
      db = await createTestDb()
      await seed()
      const rows = await selectAsAppRuntime(db, null, `SELECT * FROM rate_limits`)
      expect(rows).toHaveLength(0)
    })

    it('UPDATE targeting B row while GUC is A affects zero rows', async () => {
      db = await createTestDb()
      await seed()
      const affected = await updateAsAppRuntime(
        db,
        'loc_a',
        `UPDATE rate_limits SET count = 999 WHERE location_id = 'loc_b' AND user_id = 'usr_1'`,
      )
      expect(affected).toBe(0)
    })
  })
})
