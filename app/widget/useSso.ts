'use client'
import { useEffect, useState } from 'react'

/**
 * Bootstraps the GHL Marketplace SSO JWT from the parent frame.
 * On mount, posts `{ message: 'REQUEST_USER_DATA' }` to `window.parent`
 * and listens for the `{ key: '<jwt>' }` response. Returns the JWT
 * (or null until it arrives).
 *
 * The target origin for postMessage is `'*'` because we don't know the
 * GHL parent frame's origin in advance. Security comes from the JWT
 * itself: every server route verifies the signature with GHL_SSO_KEY,
 * so a forged message from a different origin can't produce a valid
 * token. The JWT is kept in component state only — no localStorage.
 */
export function useSso(): string | null {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')

    function onMessage(ev: MessageEvent) {
      const data: unknown = ev.data
      if (typeof data !== 'object' || data === null) return
      if (!('key' in data)) return
      const key = (data as { key: unknown }).key
      if (typeof key === 'string') setToken(key)
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return token
}
