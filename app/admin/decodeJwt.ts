/**
 * Client-side decode of a GHL Marketplace SSO JWT payload.
 *
 * IMPORTANT: This does NOT verify the signature — that's intentional.
 * The browser doesn't have GHL_SSO_KEY and shouldn't. Every server
 * route that depends on role information runs the JWT through
 * `verifySso()` (HS256) with the shared secret. The decoded role here
 * is used only for UX purposes (showing the admin UI vs the
 * "insufficient permissions" gate). A tampered token that flips
 * `role=admin` will fail every API call with 403.
 *
 * Returns `null` on any failure (malformed token, bad base64, missing
 * `role` field). Callers MUST treat `null` as "not admin".
 */
export interface SsoJwtClaims {
  role: string
  userId?: string
  locationId?: string
}

export function decodeJwtClaims(token: string): SsoJwtClaims | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json: unknown = JSON.parse(atob(padded))
    if (typeof json !== 'object' || json === null) return null
    const payload = json as Record<string, unknown>
    if (typeof payload.role !== 'string') return null
    return {
      role: payload.role,
      userId: typeof payload.userId === 'string' ? payload.userId : undefined,
      locationId: typeof payload.locationId === 'string' ? payload.locationId : undefined,
    }
  } catch {
    return null
  }
}
