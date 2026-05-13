/**
 * Read a required server-side env var. Throws a clear error if missing or empty
 * so failures surface at boot, not deep inside a request handler.
 *
 * Never expose this to client-side code — there's nothing here that handles
 * NEXT_PUBLIC_* differently; the assumption is server-only.
 */
export function getEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}
