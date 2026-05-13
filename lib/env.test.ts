import { describe, expect, it } from 'vitest'
import { getEnv } from './env'

describe('getEnv', () => {
  it('returns the value when the env var is set', () => {
    process.env.COACHG_TEST_VAR = 'hello'
    expect(getEnv('COACHG_TEST_VAR')).toBe('hello')
    delete process.env.COACHG_TEST_VAR
  })

  it('throws a helpful error when the env var is missing', () => {
    delete process.env.COACHG_TEST_VAR
    expect(() => getEnv('COACHG_TEST_VAR')).toThrow(
      'Missing required env var: COACHG_TEST_VAR',
    )
  })

  it('throws when the env var is set to an empty string', () => {
    process.env.COACHG_TEST_VAR = ''
    expect(() => getEnv('COACHG_TEST_VAR')).toThrow(
      'Missing required env var: COACHG_TEST_VAR',
    )
    delete process.env.COACHG_TEST_VAR
  })
})
