import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'
import { withSso, withAdminSso } from './auth'
import type { SsoPayload } from './ghl-sso'

const TEST_SECRET = 'test-sso-key-for-auth-tests'

function makeToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, TEST_SECRET, { algorithm: 'HS256', expiresIn: '1h' })
}

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://test.example.com/api/anything', { headers })
}

describe('withSso', () => {
  beforeEach(() => {
    vi.stubEnv('GHL_SSO_KEY', TEST_SECRET)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 when the X-GHL-SSO header is missing', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = withSso(handler)
    const res = await wrapped(makeReq())
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 401 when the token is invalid', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = withSso(handler)
    const res = await wrapped(makeReq({ 'x-ghl-sso': 'not.a.real.jwt' }))
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes the decoded payload to the handler on success', async () => {
    const token = makeToken({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'user',
    })
    const handler = vi.fn(async (_req: NextRequest, sso: SsoPayload) => {
      return Response.json({ sawLocation: sso.locationId, sawRole: sso.role })
    })
    const wrapped = withSso(handler)
    const res = await wrapped(makeReq({ 'x-ghl-sso': token }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sawLocation: 'l1', sawRole: 'user' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('forwards extra context arguments (e.g. Next.js route params) through to the handler', async () => {
    const token = makeToken({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'admin',
    })
    const handler = vi.fn(
      async (
        _req: NextRequest,
        _sso: SsoPayload,
        ctx: { params: Promise<{ id: string }> },
      ) => {
        const { id } = await ctx.params
        return Response.json({ id })
      },
    )
    const wrapped = withSso(handler)
    const res = await wrapped(
      makeReq({ 'x-ghl-sso': token }),
      { params: Promise.resolve({ id: 'btn-1' }) },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'btn-1' })
  })
})

describe('withAdminSso', () => {
  beforeEach(() => {
    vi.stubEnv('GHL_SSO_KEY', TEST_SECRET)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 when the X-GHL-SSO header is missing', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = withAdminSso(handler)
    const res = await wrapped(makeReq())
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 401 when the token is invalid', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = withAdminSso(handler)
    const res = await wrapped(makeReq({ 'x-ghl-sso': 'broken' }))
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 403 when the token is valid but the role is not admin', async () => {
    const token = makeToken({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'user',
    })
    const handler = vi.fn(async () => new Response('ok'))
    const wrapped = withAdminSso(handler)
    const res = await wrapped(makeReq({ 'x-ghl-sso': token }))
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('invokes the handler with the decoded payload when the role is admin', async () => {
    const token = makeToken({
      userId: 'u1',
      companyId: 'c1',
      locationId: 'l1',
      role: 'admin',
    })
    const handler = vi.fn(async (_req: NextRequest, sso: SsoPayload) =>
      Response.json({ role: sso.role }),
    )
    const wrapped = withAdminSso(handler)
    const res = await wrapped(makeReq({ 'x-ghl-sso': token }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ role: 'admin' })
  })
})
