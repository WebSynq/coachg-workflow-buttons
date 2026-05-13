import { NextRequest } from 'next/server'

/**
 * Build a NextRequest for unit-testing route handlers. The URL must be
 * absolute (NextRequest requires a fully-formed URL). Origin is irrelevant
 * to the tests but must parse; we use a literal example.com.
 */
export function makeGet(path: string, searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL(`https://test.example.com${path}`)
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v)
  }
  return new NextRequest(url)
}
