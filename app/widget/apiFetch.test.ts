import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/msw-server'
import { apiFetch } from './apiFetch'

describe('apiFetch', () => {
  it('sends the request with X-GHL-SSO header and returns the parsed JSON on 2xx', async () => {
    let seenHeader: string | null = null
    server.use(
      http.get('http://localhost/api/anything', ({ request }) => {
        seenHeader = request.headers.get('X-GHL-SSO')
        return HttpResponse.json({ ok: true, name: 'tim' })
      }),
    )

    const result = await apiFetch<{ ok: boolean; name: string }>(
      'jwt-token',
      'http://localhost/api/anything',
    )

    expect(seenHeader).toBe('jwt-token')
    expect(result).toEqual({ ok: true, name: 'tim' })
  })

  it('forwards method and body and adds Content-Type: application/json when body is present', async () => {
    let seenMethod: string | null = null
    let seenContentType: string | null = null
    let seenBody = ''
    server.use(
      http.post('http://localhost/api/post', async ({ request }) => {
        seenMethod = request.method
        seenContentType = request.headers.get('Content-Type')
        seenBody = await request.text()
        return HttpResponse.json({ created: true })
      }),
    )

    const result = await apiFetch<{ created: boolean }>('t', 'http://localhost/api/post', {
      method: 'POST',
      body: JSON.stringify({ foo: 1 }),
    })

    expect(seenMethod).toBe('POST')
    expect(seenContentType).toBe('application/json')
    expect(seenBody).toBe('{"foo":1}')
    expect(result).toEqual({ created: true })
  })

  it('does not overwrite a caller-supplied Content-Type', async () => {
    let seenContentType: string | null = null
    server.use(
      http.post('http://localhost/api/post', async ({ request }) => {
        seenContentType = request.headers.get('Content-Type')
        return HttpResponse.json({})
      }),
    )

    await apiFetch<unknown>('t', 'http://localhost/api/post', {
      method: 'POST',
      body: 'raw=text',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    expect(seenContentType).toBe('application/x-www-form-urlencoded')
  })

  it('throws an Error with the status code + body on non-2xx', async () => {
    server.use(
      http.get('http://localhost/api/err', () =>
        HttpResponse.text('boom', { status: 500 }),
      ),
    )

    await expect(
      apiFetch<unknown>('t', 'http://localhost/api/err'),
    ).rejects.toThrow(/500.*boom/)
  })

  it('falls back to statusText when the error body is empty', async () => {
    server.use(
      http.get('http://localhost/api/empty', () => new HttpResponse(null, { status: 404 })),
    )

    await expect(
      apiFetch<unknown>('t', 'http://localhost/api/empty'),
    ).rejects.toThrow(/404/)
  })
})
