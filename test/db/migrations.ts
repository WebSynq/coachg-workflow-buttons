import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'supabase',
  'migrations',
)

/**
 * Read every `*.sql` file under `supabase/migrations/`, sort by filename so
 * `0001_*` runs before `0002_*`, and return the concatenated SQL.
 *
 * Both `test/db/setup.ts::createTestDb()` and `test/api/db-fixture.ts::createTestQueryClient()`
 * consume this so new migrations (`0003_*.sql`, etc.) are picked up automatically.
 * No glob ordering hacks — lexicographic sort on the zero-padded prefix works as
 * long as the project sticks to four-digit prefixes (the Supabase convention).
 */
export function loadAllMigrations(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  return files
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    .join('\n\n')
}
