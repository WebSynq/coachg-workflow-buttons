import { describe, expect, it } from 'vitest'
import { decodeJwtClaims } from './decodeJwt'

function b64url(obj: object): string {
  return btoa(JSON.stringify(obj))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function makeJwt(payload: object): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`
}

describe('decodeJwtClaims', () => {
  it('returns the full claims object for an admin token', () => {
    const t = makeJwt({ role: 'admin', userId: 'u1', locationId: 'loc-1' })
    expect(decodeJwtClaims(t)).toEqual({
      role: 'admin',
      userId: 'u1',
      locationId: 'loc-1',
    })
  })

  it('returns role for a non-admin token', () => {
    const t = makeJwt({ role: 'user', userId: 'u2', locationId: 'loc-2' })
    expect(decodeJwtClaims(t)?.role).toBe('user')
  })

  it('returns null when the token has only two parts', () => {
    expect(decodeJwtClaims('header.payload')).toBeNull()
  })

  it('returns null when the payload is missing `role`', () => {
    const t = makeJwt({ userId: 'u1', locationId: 'loc-1' })
    expect(decodeJwtClaims(t)).toBeNull()
  })

  it('returns null when the payload base64 is malformed', () => {
    expect(decodeJwtClaims('aaa.!!!.bbb')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(decodeJwtClaims('')).toBeNull()
  })
})
