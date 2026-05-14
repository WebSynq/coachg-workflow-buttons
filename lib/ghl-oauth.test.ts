import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw-server'
import { exchangeCode, refreshAccessToken } from './ghl-oauth'

const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token'

describe('exchangeCode', () => {
  it('exchanges an auth code for tokens and returns the parsed payload', async () => {
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        const body = await request.text()
        expect(body).toContain('grant_type=authorization_code')
        expect(body).toContain('code=abc123')
        expect(body).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fapi%2Foauth%2Fcallback')
        expect(body).toContain('client_id=cid')
        expect(body).toContain('client_secret=csecret')
        return HttpResponse.json({
          access_token: 'at_xyz',
          refresh_token: 'rt_xyz',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'workflows.readonly contacts.write',
          userType: 'Location',
          locationId: 'loc_abc',
          companyId: 'co_abc',
          userId: 'usr_abc',
        })
      }),
    )

    const result = await exchangeCode({
      code: 'abc123',
      redirectUri: 'https://app.example.com/api/oauth/callback',
      clientId: 'cid',
      clientSecret: 'csecret',
    })

    expect(result).toEqual({
      accessToken: 'at_xyz',
      refreshToken: 'rt_xyz',
      expiresIn: 3600,
      locationId: 'loc_abc',
    })
  })

  it('throws when GHL returns a non-2xx response', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
      ),
    )

    await expect(
      exchangeCode({
        code: 'bad',
        redirectUri: 'https://app.example.com/api/oauth/callback',
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    ).rejects.toThrow(/GHL token exchange failed: 400/)
  })

  it('throws when the token response is missing required fields', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: 'at_only',
          // refresh_token, expires_in, locationId all missing
        }),
      ),
    )

    await expect(
      exchangeCode({
        code: 'abc',
        redirectUri: 'https://app.example.com/api/oauth/callback',
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    ).rejects.toThrow(/GHL token response missing required field/)
  })
})

describe('refreshAccessToken', () => {
  it('exchanges a refresh token for a new access/refresh pair', async () => {
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        const body = await request.text()
        expect(body).toContain('grant_type=refresh_token')
        expect(body).toContain('refresh_token=rt_old')
        expect(body).toContain('client_id=cid')
        expect(body).toContain('client_secret=csecret')
        return HttpResponse.json({
          access_token: 'at_new',
          refresh_token: 'rt_new',
          expires_in: 3600,
          locationId: 'loc_abc',
        })
      }),
    )

    const result = await refreshAccessToken({
      refreshToken: 'rt_old',
      clientId: 'cid',
      clientSecret: 'csecret',
    })

    expect(result).toEqual({
      accessToken: 'at_new',
      refreshToken: 'rt_new',
      expiresIn: 3600,
      locationId: 'loc_abc',
    })
  })

  it('throws when GHL returns a non-2xx', async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ error: 'invalid_grant' }, { status: 400 }),
      ),
    )

    await expect(
      refreshAccessToken({
        refreshToken: 'bad',
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    ).rejects.toThrow(/GHL token refresh failed: 400/)
  })

  it('throws when the refresh response is missing required fields', async () => {
    server.use(
      http.post(TOKEN_URL, () => HttpResponse.json({ access_token: 'only_this' })),
    )

    await expect(
      refreshAccessToken({
        refreshToken: 'rt_old',
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    ).rejects.toThrow(/GHL token response missing required field/)
  })
})
