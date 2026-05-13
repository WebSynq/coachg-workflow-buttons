import { PGlite } from '@electric-sql/pglite'
import type { QueryClient } from '@/lib/db'
import { loadAllMigrations } from '../db/migrations'

/**
 * Boots a fresh PGlite, applies every migration in `supabase/migrations/`
 * (in sorted order), and wraps it in the QueryClient shape from lib/db.ts.
 * Tests use this with `vi.doMock('@/lib/db', ...)` to swap the production
 * singleton for a test instance.
 *
 * Always `await client.end()` in afterEach to release the WASM instance.
 */
export async function createTestQueryClient(): Promise<QueryClient & { _pglite: PGlite }> {
  const pg = new PGlite()
  await pg.exec(loadAllMigrations())

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
