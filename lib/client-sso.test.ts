import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { decodeSsoForDisplay } from './client-sso'

describe('decodeSsoForDisplay', () => {
  it('returns the role from a valid JWT payload', () => {
    const token = jwt.sign(
      { userId: 'u1', companyId: 'c1', locationId: 'l1', role: 'admin' },
      'irrelevant-secret',
      { algorithm: 'HS256' },
    )
    expect(decodeSsoForDisplay(token)).toEqual({ role: 'admin' })
  })

  it('returns the role even when signature verification would fail', () => {
    // The point of this helper is display-only — it must not verify.
    const token = jwt.sign(
      { userId: 'u1', companyId: 'c1', locationId: 'l1', role: 'user' },
      'one-secret',
      { algorithm: 'HS256' },
    )
    expect(decodeSsoForDisplay(token)).toEqual({ role: 'user' })
  })

  it('returns null for empty / malformed input', () => {
    expect(decodeSsoForDisplay('')).toBeNull()
    expect(decodeSsoForDisplay('not.a.jwt.yo')).toBeNull()
    expect(decodeSsoForDisplay('justgarbage')).toBeNull()
    expect(decodeSsoForDisplay('aaa.bbb')).toBeNull() // only 2 segments
  })

  it('returns null when the payload lacks `role`', () => {
    const token = jwt.sign({ userId: 'u1', companyId: 'c1', locationId: 'l1' }, 's', {
      algorithm: 'HS256',
    })
    expect(decodeSsoForDisplay(token)).toBeNull()
  })

  it('returns null when the payload `role` is not a string', () => {
    const token = jwt.sign(
      { userId: 'u1', companyId: 'c1', locationId: 'l1', role: 123 },
      's',
      { algorithm: 'HS256' },
    )
    expect(decodeSsoForDisplay(token)).toBeNull()
  })

  it('returns null when the middle segment is invalid base64', () => {
    expect(decodeSsoForDisplay('header.@@@@@.signature')).toBeNull()
  })
})
