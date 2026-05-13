import postgres from 'postgres'
import { getEnv } from './env'

/**
 * Minimal DB shape this app needs. Both `postgres` and PGlite can implement
 * it trivially, so tests swap PGlite in for `postgres` without changing
 * application code. Keep this interface narrow — only add methods we use.
 */
export interface QueryClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>
  end(): Promise<void>
}

let cached: QueryClient | null = null

/**
 * Production DB client backed by the `postgres` driver. Cached as a singleton
 * for the process lifetime. Reads DATABASE_URL on first call so test code
 * can override the env first.
 *
 * Tests that mutate DATABASE_URL between cases MUST call resetDbForTests()
 * in afterEach, or the cached client will leak across tests with the old URL.
 */
export function getDb(): QueryClient {
  if (cached) return cached
  const url = getEnv('DATABASE_URL')
  const sql = postgres(url, { prepare: false })
  cached = {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      // `postgres` types unsafe()'s params as a union of driver-specific
      // serializable values; we pass plain primitives + ISO date strings, so
      // the `as never` short-circuits the variance check without losing safety
      // at the QueryClient interface boundary.
      const rows = (await sql.unsafe<T[]>(text, params as never)) as T[]
      return { rows }
    },
    async end() {
      await sql.end()
    },
  }
  return cached
}

/**
 * Test-only escape hatch: closes the cached client and clears the singleton
 * so the next getDb() call re-reads DATABASE_URL. Used by tests that mutate
 * process.env between cases. Fire-and-forget close avoids forcing callers
 * to await — the next test gets a fresh client either way.
 */
export function resetDbForTests(): void {
  cached?.end().catch(() => {})
  cached = null
}
