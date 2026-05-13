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
  })

  if (!res.ok) {
    throw new Error(`GHL token exchange failed: ${res.status}`)
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
