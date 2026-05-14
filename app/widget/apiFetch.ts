/**
 * Browser-side fetch helper for the widget + admin clients. Injects the
 * X-GHL-SSO header on every call so callers don't have to remember it,
 * adds Content-Type: application/json when a body is present (unless
 * the caller set one explicitly), and surfaces non-2xx responses as a
 * thrown Error whose message includes the status code + response body —
 * which is what the UI toasts on.
 */
export async function apiFetch<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('X-GHL-SSO', token)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const tail = detail || res.statusText
    throw new Error(`${res.status} ${tail}`.trim())
  }
  return res.json() as Promise<T>
}
