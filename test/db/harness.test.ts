import { afterEach, describe, expect, it } from 'vitest'
import { createPgLite } from './setup'

describe('PGlite harness', () => {
  let db: Awaited<ReturnType<typeof createPgLite>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  it('can spin up an empty Postgres and run a query', async () => {
    db = await createPgLite()
    const result = await db.query<{ sum: number }>('SELECT 1 + 1 AS sum')
    expect(result.rows).toEqual([{ sum: 2 }])
  })

  it('reports the Postgres version', async () => {
    db = await createPgLite()
    const result = await db.query<{ version: string }>('SELECT version()')
    expect(result.rows[0].version).toMatch(/PostgreSQL/)
  })
})
