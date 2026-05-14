/**
 * Decode-without-verify of a GHL Marketplace SSO JWT. Returns the role
 * for UX gating purposes only — every server route still calls
 * `verifySso()` to enforce identity. This helper exists so the admin
 * page can render an "Insufficient permissions" message instead of
 * spamming the user with 403s from admin-only endpoints.
 *
 * Returns null on any failure (not a 3-segment JWT, malformed base64,
 * payload missing `role`, etc.). Safe to use anywhere in the browser.
 */
export function decodeSsoForDisplay(token: string): { role: string } | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(b64)) as unknown
    if (typeof json !== 'object' || json === null) return null
    const role = (json as { role?: unknown }).role
    if (typeof role !== 'string') return null
    return { role }
  } catch {
    return null
  }
}
