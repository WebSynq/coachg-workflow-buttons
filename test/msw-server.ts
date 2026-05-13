import { setupServer } from 'msw/node'

// Tests register their own handlers per-case via `server.use(...)`.
// We start with zero handlers so unhandled requests fail loudly.
export const server = setupServer()
