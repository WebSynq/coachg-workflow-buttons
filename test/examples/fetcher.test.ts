import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../msw-server'
import { fetchUser } from './fetcher'

describe('fetchUser', () => {
  it('returns the parsed user JSON on 200', async () => {
    server.use(
      http.get('https://api.example.com/users/42', () =>
        HttpResponse.json({ id: 42, name: 'Ada' })
      )
    )

    const user = await fetchUser(42)

    expect(user).toEqual({ id: 42, name: 'Ada' })
  })

  it('throws when the server returns 404', async () => {
    server.use(
      http.get('https://api.example.com/users/999', () =>
        new HttpResponse(null, { status: 404 })
      )
    )

    await expect(fetchUser(999)).rejects.toThrow('user 999 not found')
  })

  it('throws on a 500', async () => {
    server.use(
      http.get('https://api.example.com/users/1', () =>
        new HttpResponse(null, { status: 500 })
      )
    )

    await expect(fetchUser(1)).rejects.toThrow('fetchUser failed: 500')
  })
})
