import postgres, { type Sql } from 'postgres'
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

let cachedSql: Sql | null = null
let cachedDb: QueryClient | null = null

/**
 * The single `postgres` connection pool for the process lifetime, shared by
 * getDb() and every getTenantDb() call. Reads DATABASE_URL on first call so
 * test code can override the env first.
 */
function getSql(): Sql {
  if (cachedSql) return cachedSql
  const url = getEnv('DATABASE_URL')
  cachedSql = postgres(url, { prepare: false })
  return cachedSql
}

/**
 * Untenanted DB client for pre-tenant work (the OAuth callback, before a
 * locationId exists to scope to). Every other caller should use
 * getTenantDb() so RLS has a location_id to check.
 *
 * Tests that mutate DATABASE_URL between cases MUST call resetDbForTests()
 * in afterEach, or the cached client will leak across tests with the old URL.
 */
export function getDb(): QueryClient {
  if (cachedDb) return cachedDb
  const sql = getSql()
  cachedDb = {
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
  return cachedDb
}

/**
 * Tenant-scoped DB client. Each query() runs inside sql.begin() and sets the
 * `app.location_id` GUC via set_config(..., true) — the third arg makes it
 * transaction-local, same as SET LOCAL — before the caller's statement, so
 * RLS policies see the right tenant and a pooled connection can never leak
 * tenant context into the next request. set_config() over string-interpolated
 * SET LOCAL because SET does not accept bind parameters; set_config() does.
 */
export function getTenantDb(locationId: string): QueryClient {
  const sql = getSql()
  return {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]) {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe(`SELECT set_config('app.location_id', $1, true)`, [
          locationId,
        ] as never)
        return (await tx.unsafe<T[]>(text, params as never)) as T[]
      })
      return { rows: rows as T[] }
    },
    async end() {
      await sql.end()
    },
  }
}

/**
 * Test-only escape hatch: closes the cached pool and clears both singletons
 * so the next getDb()/getTenantDb() call re-reads DATABASE_URL. Used by tests
 * that mutate process.env between cases. Fire-and-forget close avoids forcing
 * callers to await — the next test gets a fresh client either way.
 */
export function resetDbForTests(): void {
  cachedSql?.end().catch(() => {})
  cachedSql = null
  cachedDb = null
}
