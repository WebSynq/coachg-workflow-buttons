const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token'

export interface ExchangeCodeInput {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}

export interface ExchangeCodeResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  locationId: string
}

/**
 * Exchange an OAuth authorization code for an access/refresh token pair.
 * Calls GHL's token endpoint with form-encoded body (which is what the GHL
 * Marketplace spec requires; JSON is rejected).
 *
 * Throws on non-2xx or on a payload that's missing any required field.
 * Returns only the fields downstream code uses — extras like userId/scope
 * are intentionally dropped to keep callers honest about what's persisted.
 */
export async function exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    // Bounded failure mode: surface a clean throw if GHL hangs, rather than
    // waiting for Vercel's outer function timeout (10s+ on most plans).
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    // Capture the response body so operational triage during a failed install
    // can see the actual GHL error ({error, error_description}) instead of
    // just the HTTP status. Falls back gracefully if reading the body throws.
    const detail = await res.text().catch(() => '')
    throw new Error(
      detail
        ? `GHL token exchange failed: ${res.status} ${detail}`
        : `GHL token exchange failed: ${res.status}`,
    )
  }

  const payload = (await res.json()) as Record<string, unknown>

  const accessToken = payload.access_token
  const refreshToken = payload.refresh_token
  const expiresIn = payload.expires_in
  const locationId = payload.locationId

  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresIn !== 'number' ||
    typeof locationId !== 'string'
  ) {
    throw new Error('GHL token response missing required field')
  }

  return { accessToken, refreshToken, expiresIn, locationId }
}

export interface RefreshInput {
  refreshToken: string
  clientId: string
  clientSecret: string
}

/**
 * Exchange a refresh token for a fresh access/refresh pair.
 * Same response shape as exchangeCode — caller persists the new tuple
 * and the new `expires_at` to ghl_tokens.
 */
export async function refreshAccessToken(input: RefreshInput): Promise<ExchangeCodeResult> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      detail
        ? `GHL token refresh failed: ${res.status} ${detail}`
        : `GHL token refresh failed: ${res.status}`,
    )
  }

  const payload = (await res.json()) as Record<string, unknown>

  const accessToken = payload.access_token
  const refreshToken = payload.refresh_token
  const expiresIn = payload.expires_in
  const locationId = payload.locationId

  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresIn !== 'number' ||
    typeof locationId !== 'string'
  ) {
    throw new Error('GHL token response missing required field')
  }

  return { accessToken, refreshToken, expiresIn, locationId }
}
