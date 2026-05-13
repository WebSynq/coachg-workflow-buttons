import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { QueryClient } from '@/lib/db'

const MIGRATION_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '0001_init.sql',
)

/**
 * Boots a fresh PGlite, applies the Phase 1 migration, and wraps it in the
 * QueryClient shape from lib/db.ts. Tests use this with `vi.doMock('@/lib/db', ...)`
 * to swap the production singleton for a test instance.
 *
 * Always `await client.end()` in afterEach to release the WASM instance.
 */
export async function createTestQueryClient(): Promise<QueryClient & { _pglite: PGlite }> {
  const pg = new PGlite()
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  await pg.exec(sql)

  return {
    _pglite: pg,
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      const result = await pg.query<T>(text, params)
      return { rows: result.rows as T[] }
    },
    async end() {
      await pg.close()
    },
  }
}
