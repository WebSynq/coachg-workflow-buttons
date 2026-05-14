import jwt from 'jsonwebtoken'
import { NextRequest } from 'next/server'

/**
 * Build a NextRequest for unit-testing route handlers. The URL must be
 * absolute (NextRequest requires a fully-formed URL). Origin is irrelevant
 * to the tests but must parse; we use a literal example.com.
 */
export function makeGet(
  path: string,
  searchParams: Record<string, string> = {},
  headers: Record<string, string> = {},
): NextRequest {
  const url = new URL(`https://test.example.com${path}`)
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v)
  }
  return new NextRequest(url, { headers })
}

export function makePost(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`https://test.example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

export function makePut(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`https://test.example.com${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

export function makeDelete(
  path: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`https://test.example.com${path}`, {
    method: 'DELETE',
    headers,
  })
}

/**
 * Sign an SSO JWT with the test secret. Mirrors the shape GHL sends:
 * { userId, companyId, locationId, role }. Defaults locationId/role to
 * something the caller passes explicitly because those drive every
 * tenant-scoping test.
 */
export function signTestSso(
  payload: { userId?: string; companyId?: string; locationId: string; role: string },
  secret: string,
): string {
  return jwt.sign(
    {
      userId: payload.userId ?? 'test-user',
      companyId: payload.companyId ?? 'test-company',
      locationId: payload.locationId,
      role: payload.role,
    },
    secret,
    { algorithm: 'HS256', expiresIn: '1h' },
  )
}
