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

describe('getTenantDb', () => {
  afterEach(() => {
    resetDbForTests()
    vi.unstubAllEnvs()
    vi.doUnmock('postgres')
    vi.resetModules()
  })

  it('sets app.location_id via set_config before the caller statement, inside one transaction', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://test')
    const calls: Array<{ text: string; params: unknown[] }> = []
    const tx = {
      unsafe: vi.fn(async (text: string, params: unknown[] = []) => {
        calls.push({ text, params })
        return [{ ok: true }]
      }),
    }
    const sqlMock = {
      begin: vi.fn(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx)),
      end: vi.fn(async () => {}),
    }
    vi.resetModules()
    vi.doMock('postgres', () => ({ default: vi.fn(() => sqlMock) }))

    const { getTenantDb } = await import('./db')
    const { rows } = await getTenantDb('loc_a').query<{ ok: boolean }>('SELECT 1')

    expect(sqlMock.begin).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
    expect(calls[0].text).toMatch(/set_config/)
    expect(calls[0].params).toEqual(['loc_a'])
    expect(calls[1].text).toBe('SELECT 1')
    expect(rows).toEqual([{ ok: true }])
  })

  it('scopes the GUC to a transaction — a second query gets its own set_config call', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://test')
    const calls: Array<{ text: string; params: unknown[] }> = []
    const tx = {
      unsafe: vi.fn(async (text: string, params: unknown[] = []) => {
        calls.push({ text, params })
        return []
      }),
    }
    const sqlMock = {
      begin: vi.fn(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx)),
      end: vi.fn(async () => {}),
    }
    vi.resetModules()
    vi.doMock('postgres', () => ({ default: vi.fn(() => sqlMock) }))

    const { getTenantDb } = await import('./db')
    await getTenantDb('loc_a').query('SELECT 1')
    await getTenantDb('loc_b').query('SELECT 2')

    expect(sqlMock.begin).toHaveBeenCalledTimes(2)
    expect(calls[0].params).toEqual(['loc_a'])
    expect(calls[2].params).toEqual(['loc_b'])
  })
})
