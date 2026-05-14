import { getDb } from './db'

const MAX_PER_MIN = 10

/**
 * Atomically increment + check the (locationId, userId) bucket for the
 * current minute. Returns true if the call is allowed (count <= MAX),
 * false if the rate limit was hit. Single round trip to the
 * rate_limit_check() Postgres function — no race window between the
 * increment and the check.
 */
export async function checkRateLimit(locationId: string, userId: string): Promise<boolean> {
  const { rows } = await getDb().query<{ allowed: boolean }>(
    `SELECT rate_limit_check($1, $2, $3) AS allowed`,
    [locationId, userId, MAX_PER_MIN],
  )
  return rows[0].allowed
}
