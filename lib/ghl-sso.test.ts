import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { verifySso } from './ghl-sso'

const TEST_SECRET = 'test-sso-key-do-not-use-in-production'

function makeToken(
  payload: Record<string, unknown>,
  options: jwt.SignOptions = { algorithm: 'HS256' },
  secret: string = TEST_SECRET,
): string {
  return jwt.sign(payload, secret, options)
}

describe('verifySso', () => {
  beforeEach(() => {
    vi.stubEnv('GHL_SSO_KEY', TEST_SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the decoded payload for a valid HS256 token', () => {
    const token = makeToken({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'admin',
    })

    const result = verifySso(token)

    expect(result).toEqual({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'admin',
    })
  })
})
