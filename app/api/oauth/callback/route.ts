import { NextRequest, NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { getDb } from '@/lib/db'
import { exchangeCode } from '@/lib/ghl-oauth'

export async function GET(request: NextRequest): Promise<Response> {
  const code = request.nextUrl.searchParams.get('code')
  if (!code) {
    return new Response('Missing code parameter', { status: 400 })
  }

  const appUrl = getEnv('NEXT_PUBLIC_APP_URL')
  const clientId = getEnv('GHL_CLIENT_ID')
  const clientSecret = getEnv('GHL_CLIENT_SECRET')
  const redirectUri = `${appUrl}/api/oauth/callback`

  const tokens = await exchangeCode({
    code,
    redirectUri,
    clientId,
    clientSecret,
  })

  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString()

  await getDb().query(
    `INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (location_id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at`,
    [tokens.locationId, tokens.accessToken, tokens.refreshToken, expiresAt],
  )

  return NextResponse.redirect(
    `${appUrl}/admin?locationId=${encodeURIComponent(tokens.locationId)}`,
  )
}
