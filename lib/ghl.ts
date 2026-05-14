import { getDb } from './db'
import { getEnv } from './env'
import { refreshAccessToken } from './ghl-oauth'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_API_VERSION = '2021-07-28'
const REFRESH_BUFFER_MS = 60_000

export interface Workflow {
  id: string
  name: string
}

export interface GhlClient {
  workflows: {
    list(): Promise<Workflow[]>
  }
  contact: {
    enroll(workflowId: string, contactId: string): Promise<void>
  }
}

interface TokenRow {
  access_token: string
  refresh_token: string
  expires_at: string
}

async function loadToken(locationId: string): Promise<TokenRow> {
  const { rows } = await getDb().query<TokenRow>(
    `SELECT access_token, refresh_token, expires_at
     FROM ghl_tokens
     WHERE location_id = $1`,
    [locationId],
  )
  if (rows.length === 0) {
    throw new Error(`no ghl_tokens row for locationId=${locationId}`)
  }
  return rows[0]
}

async function persistToken(
  locationId: string,
  accessToken: string,
  refreshToken: string,
  expiresInSeconds: number,
): Promise<TokenRow> {
  // Subtract a 60s safety margin so we refresh before GHL's server-side
  // clock thinks the token is expired, not just before ours does.
  const expiresAt = new Date(
    Date.now() + (expiresInSeconds - 60) * 1000,
  ).toISOString()
  await getDb().query(
    `UPDATE ghl_tokens
     SET access_token = $2, refresh_token = $3, expires_at = $4
     WHERE location_id = $1`,
    [locationId, accessToken, refreshToken, expiresAt],
  )
  return { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt }
}

function isExpiringSoon(expiresAt: string): boolean {
  return Date.parse(expiresAt) - Date.now() < REFRESH_BUFFER_MS
}

async function refreshAndPersist(locationId: string, refreshTokenStr: string): Promise<TokenRow> {
  const refreshed = await refreshAccessToken({
    refreshToken: refreshTokenStr,
    clientId: getEnv('GHL_CLIENT_ID'),
    clientSecret: getEnv('GHL_CLIENT_SECRET'),
  })
  return persistToken(
    locationId,
    refreshed.accessToken,
    refreshed.refreshToken,
    refreshed.expiresIn,
  )
}

/**
 * Build a per-locationId GHL API client. Loads the OAuth token from
 * ghl_tokens, refreshes it if it's within 60s of expiry, and exposes
 * the upstream calls this app uses. Every request is sent with
 * `Authorization: Bearer …` + `Version: 2021-07-28`. On a 401 from any
 * authenticated call, the client transparently refreshes the token,
 * persists the new pair, and retries the call exactly once. A second
 * 401 surfaces as an error — we do not loop.
 *
 * The client is intentionally NOT cached; each route handler gets a
 * fresh load. This avoids stale-token reuse across concurrent invocations
 * on the same Vercel instance, which would otherwise need a separate
 * lock to refresh once instead of N times.
 */
export async function getGhlClient(locationId: string): Promise<GhlClient> {
  let token = await loadToken(locationId)
  if (isExpiringSoon(token.expires_at)) {
    token = await refreshAndPersist(locationId, token.refresh_token)
  }

  async function authedRequest(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.access_token}`,
      Version: GHL_API_VERSION,
      Accept: 'application/json',
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const init: RequestInit = {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }
    const res = await fetch(`${GHL_BASE}${path}`, init)
    if (res.status !== 401) return res

    // Single retry after a forced refresh.
    token = await refreshAndPersist(locationId, token.refresh_token)
    const retryHeaders = { ...headers, Authorization: `Bearer ${token.access_token}` }
    return fetch(`${GHL_BASE}${path}`, { ...init, headers: retryHeaders })
  }

  return {
    workflows: {
      async list() {
        const res = await authedRequest(
          'GET',
          `/workflows/?locationId=${encodeURIComponent(locationId)}`,
        )
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`GHL request failed: ${res.status} ${detail}`.trim())
        }
        const payload = (await res.json()) as { workflows?: Array<{ id: string; name: string }> }
        const list = payload.workflows ?? []
        return list.map(({ id, name }) => ({ id, name }))
      },
    },
    contact: {
      async enroll(workflowId, contactId) {
        const res = await authedRequest(
          'POST',
          `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`,
          { eventStartTime: new Date().toISOString() },
        )
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new Error(`GHL request failed: ${res.status} ${detail}`.trim())
        }
      },
    },
  }
}
