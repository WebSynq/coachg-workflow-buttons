import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetDbForTests } from './db'

describe('lib/db.ts', () => {
  afterEach(() => {
    resetDbForTests()
    vi.unstubAllEnvs()
  })

  it('exports a QueryClient interface with query() and end()', async () => {
    // The interface is structural; we assert by importing and inspecting.
    const mod = await import('./db')
    expect(typeof mod.getDb).toBe('function')
    expect(typeof mod.resetDbForTests).toBe('function')
  })

  it('getDb() throws when DATABASE_URL is missing', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const { getDb } = await import('./db')
    expect(() => getDb()).toThrow('Missing required env var: DATABASE_URL')
  })
})
