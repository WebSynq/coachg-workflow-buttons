import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '0001_init.sql',
)

export async function createPgLite(): Promise<PGlite> {
  return new PGlite()
}

export async function createTestDb(): Promise<PGlite> {
  const db = await createPgLite()
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  await db.exec(sql)
  return db
}
