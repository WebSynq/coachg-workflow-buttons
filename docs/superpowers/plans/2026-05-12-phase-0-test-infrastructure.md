# Phase 0: Test Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Vitest + @testing-library/react + MSW so the next eight phases can practice RED → GREEN → REFACTOR. Phase 0 ends with three sample tests (pure, component, MSW-mocked) all green via `npm test`.

**Architecture:** Vitest is the test runner, invoked through npm scripts. Pure tests run in the Node environment; component tests opt in to `jsdom` via the `// @vitest-environment jsdom` directive at the top of each `.test.tsx`. MSW v2's `node` server intercepts `fetch` and is wired into a single `vitest.setup.ts` lifecycle (`beforeAll` / `afterEach` / `afterAll`). The `@/` path alias from `tsconfig.json` is resolved via `vite-tsconfig-paths`.

**Tech Stack:** Vitest 3.x · @vitejs/plugin-react 4.x · vite-tsconfig-paths 5.x · @testing-library/react 16.x · @testing-library/jest-dom 6.x · @testing-library/user-event 14.x · jsdom 25.x · msw 2.x

**Out of scope for Phase 0:** Next.js route-handler integration tests (Phase 2+ — those need different setup), real Supabase test database (Phase 1+), Playwright E2E (deferred to v2).

**Reference docs the engineer should skim before starting:**
- Vitest config: https://vitest.dev/config/
- Vitest environments: https://vitest.dev/guide/environment.html
- MSW v2 Node setup: https://mswjs.io/docs/integrations/node
- @testing-library/react with React 19: https://testing-library.com/docs/react-testing-library/intro
- The project's `AGENTS.md` says "read the relevant guide in `node_modules/next/dist/docs/` before writing any code." Phase 0 doesn't touch Next.js APIs, but if you reach for anything Next.js-specific (you shouldn't need to), read first.

---

## File map

Files this plan creates or modifies:

**Created:**
- `vitest.config.ts` — Vitest + plugin config
- `vitest.setup.ts` — jest-dom matchers + MSW lifecycle
- `test/msw-server.ts` — exports a single `server` instance for handlers
- `test/examples/sum.ts` — sample pure function
- `test/examples/sum.test.ts` — pure-function test
- `test/examples/Greeting.tsx` — sample React component
- `test/examples/Greeting.test.tsx` — component test
- `test/examples/fetcher.ts` — sample fetch wrapper
- `test/examples/fetcher.test.ts` — MSW-mocked test

**Modified:**
- `package.json` — add scripts + devDependencies

Each file has one clear responsibility. The three `test/examples/*` pairs serve as living documentation of the three test modes; they should remain in the repo as canonical examples for future phases.

---

## Task 1: Install Vitest core, configure, add scripts

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install Vitest + Vite plugins**

Run:
```bash
npm install --save-dev vitest@^3 @vitejs/plugin-react@^4 vite-tsconfig-paths@^5
```

Expected: installs succeed; `package.json` `devDependencies` now includes the three packages.

- [ ] **Step 2: Add test scripts to `package.json`**

Open `package.json` and add three scripts inside `"scripts"`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:related": "vitest related --run"
  }
}
```

(Append the three test scripts after `lint`; do not remove existing scripts.)

- [ ] **Step 3: Create `vitest.config.ts`**

Create the file at the repo root with this exact content:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
  },
})
```

Notes for the implementer:
- `globals: false` is intentional — every test imports `test`, `expect`, etc. explicitly from `vitest`. This keeps the type-check honest and matches modern Vitest usage.
- We do NOT add `setupFiles` yet. We'll add it in Task 3 when we have something to set up.
- The default environment is `node`. Component tests opt in per-file with a directive (Task 4).

- [ ] **Step 4: Verify Vitest runs (no tests yet)**

Run:
```bash
npm test
```

Expected output includes `No test files found` (or similar wording) and the process exits with a non-zero code — that's fine for now. We're confirming Vitest itself launches without config errors. If you see a stack trace or "Cannot find module" error, fix that before proceeding.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: bootstrap Vitest with TypeScript path resolution

Adds Vitest 3, @vitejs/plugin-react, and vite-tsconfig-paths
plus three npm scripts (test, test:watch, test:related). No
test files yet — that comes in the next task."
```

---

## Task 2: TDD a pure unit test (proves Vitest + TS work end-to-end)

**Files:**
- Create: `test/examples/sum.ts`
- Create: `test/examples/sum.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/examples/sum.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sum } from './sum'

describe('sum', () => {
  it('adds two positive numbers', () => {
    expect(sum(2, 3)).toBe(5)
  })

  it('treats negative numbers correctly', () => {
    expect(sum(-1, 4)).toBe(3)
  })

  it('returns zero for two zeros', () => {
    expect(sum(0, 0)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
npm test
```

Expected: Vitest finds 1 file with 3 tests. All three FAIL with a module resolution error (`Cannot find module './sum'` or `Failed to resolve import`).

- [ ] **Step 3: Implement `sum`**

Create `test/examples/sum.ts`:

```ts
export function sum(a: number, b: number): number {
  return a + b
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
npm test
```

Expected: 3 passed, 0 failed. Total run time under 2 seconds.

- [ ] **Step 5: Commit**

```bash
git add test/examples/sum.ts test/examples/sum.test.ts
git commit -m "test: add pure-function sample test (sum)

Canonical example of a Vitest pure-function test. Lives under
test/examples/ as living documentation for future phases."
```

---

## Task 3: Add jsdom + testing-library, create vitest.setup.ts

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `vitest.config.ts` (add `setupFiles`)
- Create: `vitest.setup.ts`

- [ ] **Step 1: Install jsdom + testing-library packages**

Run:
```bash
npm install --save-dev jsdom@^25 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14
```

Expected: install succeeds. `@testing-library/react@^16` is required for React 19 compatibility.

- [ ] **Step 2: Create `vitest.setup.ts`**

Create at the repo root:

```ts
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Auto-cleanup between component tests. Necessary because Vitest's
// globals: false means @testing-library/react's auto-cleanup can't
// find afterEach on globalThis and won't self-register.
afterEach(() => {
  cleanup()
})
```

The first import registers all jest-dom matchers (`toBeInTheDocument`, `toHaveClass`, etc.) onto Vitest's `expect`. The `afterEach(cleanup)` block unmounts rendered components between tests — required under `globals: false`.

- [ ] **Step 3: Wire `vitest.setup.ts` into `vitest.config.ts`**

Edit `vitest.config.ts` — add `setupFiles` inside the `test` block. The file becomes:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
  },
})
```

- [ ] **Step 4: Verify existing sum tests still pass with the new setup**

Run:
```bash
npm test
```

Expected: 3 passed, 0 failed. The setup file shouldn't break anything.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts vitest.setup.ts
git commit -m "test: add jsdom + testing-library, wire jest-dom matchers"
```

---

## Task 4: TDD a React component test

**Files:**
- Create: `test/examples/Greeting.tsx`
- Create: `test/examples/Greeting.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `test/examples/Greeting.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Greeting } from './Greeting'

describe('Greeting', () => {
  it('renders the name passed in', () => {
    render(<Greeting name="Tim" />)
    expect(screen.getByText('Hello, Tim!')).toBeInTheDocument()
  })

  it('falls back to "world" when no name is given', () => {
    render(<Greeting />)
    expect(screen.getByText('Hello, world!')).toBeInTheDocument()
  })

  it('renders inside a heading', () => {
    render(<Greeting name="Tim" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Tim!')
  })
})
```

The first line — `// @vitest-environment jsdom` — is REQUIRED. Without it, the test runs in Node, has no `document`, and `render` will throw.

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
npm test
```

Expected: 6 total tests (3 pass from sum, 3 fail from Greeting). The failures cite "Cannot find module './Greeting'".

- [ ] **Step 3: Implement `Greeting`**

Create `test/examples/Greeting.tsx`:

```tsx
type GreetingProps = {
  name?: string
}

export function Greeting({ name = 'world' }: GreetingProps) {
  return <h1>Hello, {name}!</h1>
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
npm test
```

Expected: 6 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add test/examples/Greeting.tsx test/examples/Greeting.test.tsx
git commit -m "test: add React component sample test (Greeting)

Canonical example of a Vitest component test with
@testing-library/react and jest-dom matchers. Uses the
// @vitest-environment jsdom directive to opt into a DOM."
```

---

## Task 5: Install MSW + create server, wire into setup

**Files:**
- Modify: `package.json` (via npm install)
- Create: `test/msw-server.ts`
- Modify: `vitest.setup.ts` (add MSW lifecycle)

- [ ] **Step 1: Install MSW**

Run:
```bash
npm install --save-dev msw@^2
```

- [ ] **Step 2: Create `test/msw-server.ts`**

Create the file with this content:

```ts
import { setupServer } from 'msw/node'

// Tests register their own handlers per-case via `server.use(...)`.
// We start with zero handlers so unhandled requests fail loudly.
export const server = setupServer()
```

- [ ] **Step 3: Update `vitest.setup.ts` to manage the MSW lifecycle**

Replace `vitest.setup.ts` with:

```ts
import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './test/msw-server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

`onUnhandledRequest: 'error'` is intentional. If a test makes a real network call by accident, the test fails — we never want production HTTP from tests.

- [ ] **Step 4: Verify all existing tests still pass**

Run:
```bash
npm test
```

Expected: 6 passed, 0 failed. (MSW is listening but no handlers are registered, and the existing tests don't make HTTP calls.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json test/msw-server.ts vitest.setup.ts
git commit -m "test: add MSW v2 with strict unhandled-request policy

server.listen({ onUnhandledRequest: 'error' }) — any test that
makes an unexpected network call fails loudly. Handlers are
registered per-test with server.use(...) for isolation."
```

---

## Task 6: TDD an MSW-mocked fetch test

**Files:**
- Create: `test/examples/fetcher.ts`
- Create: `test/examples/fetcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/examples/fetcher.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
npm test
```

Expected: 9 total tests, 3 fail (the new ones) citing "Cannot find module './fetcher'".

- [ ] **Step 3: Implement `fetchUser`**

Create `test/examples/fetcher.ts`:

```ts
export type User = {
  id: number
  name: string
}

export async function fetchUser(id: number): Promise<User> {
  const res = await fetch(`https://api.example.com/users/${id}`)
  if (res.status === 404) {
    throw new Error(`user ${id} not found`)
  }
  if (!res.ok) {
    throw new Error(`fetchUser failed: ${res.status}`)
  }
  return res.json() as Promise<User>
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
npm test
```

Expected: 9 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add test/examples/fetcher.ts test/examples/fetcher.test.ts
git commit -m "test: add MSW-mocked HTTP sample test (fetchUser)

Canonical example of intercepting fetch with MSW per-test.
Demonstrates 200, 404, and 500 paths."
```

---

## Task 7: Final verification + Phase 0 wrap-up

**Files:**
- None (verification only)

- [ ] **Step 1: Full test run**

Run:
```bash
npm test
```

Expected output (exact numbers may vary slightly with formatting):

```
 Test Files  3 passed (3)
      Tests  9 passed (9)
```

Specifically: 3 test files, 9 passing tests, 0 failing tests.

- [ ] **Step 2: Verify all three test modes are exercised**

Confirm by reading the output that:
- `test/examples/sum.test.ts` ran (pure / node environment)
- `test/examples/Greeting.test.tsx` ran (jsdom environment via directive)
- `test/examples/fetcher.test.ts` ran (msw handlers intercepted)

If any test file is missing from the output, check the `include` glob in `vitest.config.ts`.

- [ ] **Step 3: Verify the lint script still works**

Run:
```bash
npm run lint
```

Expected: no errors from the new files. (The existing eslint config doesn't ignore `test/` and that's fine — these test files are valid TS/TSX.)

- [ ] **Step 4: Verify the build still works**

Run:
```bash
npm run build
```

Expected: build succeeds. Vitest config and test files should not be included in the Next.js bundle. If the build fails because Next.js tries to compile `test/`, add `test/**` to `next.config.ts`'s `pageExtensions` exclusion (unlikely needed — Next.js only routes files under `app/`).

- [ ] **Step 5: Tag Phase 0 complete**

```bash
git tag phase-0-complete
```

The tag marks the verified state. Subsequent phases start from here.

- [ ] **Step 6: Summary commit (only if uncommitted changes exist)**

Check:
```bash
git status
```

If clean: nothing to do.
If anything is uncommitted (e.g., a `.gitignore` tweak, or `next.config.ts` change from Step 4): commit it:

```bash
git add -A
git commit -m "test: Phase 0 final cleanup"
```

---

## Verification checklist for the executor

Before marking Phase 0 complete, all of these must be true:

- [ ] `npm test` exits 0 with 9 passing tests across 3 files
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `vitest.config.ts`, `vitest.setup.ts`, `test/msw-server.ts` exist
- [ ] `test/examples/` contains 3 source + 3 test files (6 total)
- [ ] `package.json` has `test`, `test:watch`, `test:related` scripts
- [ ] Tag `phase-0-complete` exists on the current commit
- [ ] No uncommitted changes (`git status` is clean)

If any check fails, the phase is NOT done. Fix and re-run from the earliest failing step.

---

## What's NOT in Phase 0 (deferred to later phases)

These come up in Phase 1+ — call them out here so they don't get pulled in:

- **Real Supabase test client.** Phase 1 introduces the schema; Phase 2+ introduces a Supabase client test fixture (likely a dedicated test Supabase project, with table truncation between tests).
- **Next.js route handler test harness.** Phase 2 introduces a small helper to invoke `app/api/.../route.ts` handlers directly with a `Request`. Don't preemptively build it now.
- **postMessage / SSO test utilities.** Phase 2.5 introduces a JWT signing helper for tests; don't build it now.
- **Test coverage reporting.** Add `--coverage` and a coverage threshold only when Phase 7 is done. Premature coverage targets distort phase-by-phase TDD discipline.
