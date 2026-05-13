import { PGlite } from '@electric-sql/pglite'
import { loadAllMigrations } from './migrations'

export async function createPgLite(): Promise<PGlite> {
  return new PGlite()
}

export async function createTestDb(): Promise<PGlite> {
  const db = await createPgLite()
  await db.exec(loadAllMigrations())
  return db
}
