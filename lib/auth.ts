import { NextRequest } from 'next/server'
import { verifySso, type SsoPayload } from './ghl-sso'

const SSO_HEADER = 'x-ghl-sso'

/**
 * Higher-order route handler that pulls the GHL Marketplace SSO token
 * off the `X-GHL-SSO` request header, verifies it via `verifySso`, and
 * either invokes the inner handler with the decoded payload OR
 * short-circuits with 401.
 *
 * Extra positional arguments are forwarded through — this matches the
 * Next.js App Router contract where the second argument to a dynamic
 * route handler is `{ params: Promise<{...}> }`.
 *
 * The inner handler MUST treat `sso.locationId` as the only authoritative
 * tenant identifier. Query params and request bodies remain UX hints
 * only (spec §4, §12).
 */
export function withSso<Args extends unknown[]>(
  handler: (req: NextRequest, sso: SsoPayload, ...rest: Args) => Promise<Response>,
) {
  return async (req: NextRequest, ...rest: Args): Promise<Response> => {
    const token = req.headers.get(SSO_HEADER)
    if (!token) return new Response('Missing SSO token', { status: 401 })
    const sso = verifySso(token)
    if (!sso) return new Response('Invalid SSO token', { status: 401 })
    return handler(req, sso, ...rest)
  }
}

/**
 * Like `withSso`, but additionally enforces `sso.role === 'admin'`. Use
 * for every mutation endpoint surfaced through the admin UI (spec §5).
 * Returns 403 — never 401 — when the token is valid but the role
 * doesn't qualify; the distinction lets the client tell "you need to
 * re-auth" from "you need a different account."
 */
export function withAdminSso<Args extends unknown[]>(
  handler: (req: NextRequest, sso: SsoPayload, ...rest: Args) => Promise<Response>,
) {
  return withSso<Args>(async (req, sso, ...rest) => {
    if (sso.role !== 'admin') return new Response('Admin role required', { status: 403 })
    return handler(req, sso, ...rest)
  })
}
