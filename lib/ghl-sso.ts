import jwt from 'jsonwebtoken'
import { getEnv } from './env'

export interface SsoPayload {
  userId: string
  companyId: string
  locationId: string
  role: string
}

/**
 * Verify a GHL Marketplace SSO JWT (HS256, signed by GHL with our app's
 * shared `GHL_SSO_KEY` from the Marketplace settings).
 *
 * Returns the narrow `SsoPayload` on success, or `null` on any failure
 * (bad signature, expired, wrong algorithm, malformed, missing required
 * fields). NEVER throws — every route handler treats `null` as 401,
 * so failing closed is the only safe behavior.
 *
 * Only the four documented payload fields are returned; GHL may send
 * additional fields (email, etc.) but consumers should ignore them
 * until the spec promises them.
 */
export function verifySso(token: string): SsoPayload | null {
  if (!token) return null

  const secret = getEnv('GHL_SSO_KEY')

  let decoded: unknown
  try {
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'] })
  } catch {
    return null
  }

  if (typeof decoded !== 'object' || decoded === null) return null

  const payload = decoded as Record<string, unknown>
  if (
    typeof payload.userId !== 'string' ||
    typeof payload.companyId !== 'string' ||
    typeof payload.locationId !== 'string' ||
    typeof payload.role !== 'string'
  ) {
    return null
  }

  return {
    userId: payload.userId,
    companyId: payload.companyId,
    locationId: payload.locationId,
    role: payload.role,
  }
}
