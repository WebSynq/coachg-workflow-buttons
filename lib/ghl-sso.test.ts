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

  it('returns null for an empty string', () => {
    expect(verifySso('')).toBeNull()
  })

  it('returns null for a malformed token (not a JWT)', () => {
    expect(verifySso('not.a.jwt')).toBeNull()
    expect(verifySso('justgarbage')).toBeNull()
  })

  it('returns null when the signature is invalid (signed with the wrong secret)', () => {
    const token = makeToken(
      { userId: 'u1', companyId: 'c1', locationId: 'l1', role: 'admin' },
      { algorithm: 'HS256' },
      'a-different-secret',
    )
    expect(verifySso(token)).toBeNull()
  })

  it('returns null when the token is expired', () => {
    const token = makeToken(
      {
        userId: 'u1',
        companyId: 'c1',
        locationId: 'l1',
        role: 'admin',
        // expired 60s ago
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      { algorithm: 'HS256' },
    )
    expect(verifySso(token)).toBeNull()
  })

  it('returns null when the token was signed with a different algorithm (HS512)', () => {
    const token = makeToken(
      { userId: 'u1', companyId: 'c1', locationId: 'l1', role: 'admin' },
      { algorithm: 'HS512' },
    )
    expect(verifySso(token)).toBeNull()
  })

  it('returns null when the payload is missing required fields', () => {
    // Valid signature, but no userId/companyId/locationId/role
    const token = makeToken({ somethingElse: 'foo' })
    expect(verifySso(token)).toBeNull()
  })

  it('drops payload fields it does not promise (returns only the four documented fields)', () => {
    const token = makeToken({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'admin',
      email: 'tim@example.com',
      iat: 1700000000,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    const result = verifySso(token)

    expect(result).toEqual({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'admin',
    })
    // Stronger than not.toHaveProperty: lock the exact set of keys so a
    // future refactor that adds passthrough fields fails loudly.
    expect(Object.keys(result!).sort()).toEqual([
      'companyId',
      'locationId',
      'role',
      'userId',
    ])
  })
})
