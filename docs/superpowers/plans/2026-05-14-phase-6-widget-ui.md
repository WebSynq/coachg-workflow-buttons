# Phase 6: Widget UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Build the contact-sidebar widget end-users see inside the GHL Marketplace iframe. Server component shell + client component that bootstraps the SSO JWT via `postMessage`, fetches the configured buttons + this contact's recent activity, renders the color-coded button grid, and on click confirms + enrolls the contact in the workflow.

**Spec reference:** §3 (architecture), §4 (postMessage SSO flow), §9 (UI behavior), §1 (SOA-last-sent surfacing).

**Out of scope for Phase 6:**
- The admin page (`/admin`) — Phase 7.
- Drag-and-drop reorder (admin feature) — out of v1.
- Encryption-at-rest for tokens — already noted in earlier phases as v2.
- Real Playwright E2E — per spec §11 deferred.

---

## Behavior contract

On mount the client component:

1. Posts `{ message: 'REQUEST_USER_DATA' }` to `window.parent`.
2. Listens for `message` events whose `data.key` is a string (the signed JWT).
3. Once the JWT arrives, fetches `GET /api/buttons` and `GET /api/log?contactId=<id>` in parallel with `X-GHL-SSO: <jwt>`.
4. While booting / fetching, shows a neutral "Loading…" placeholder.
5. Renders:
   - The button grid (color-coded). Empty-state message when no buttons.
   - The "SOA last sent: …" line (one line per contact, NOT per button), or "SOA last sent: never" when null.
   - The Activity panel — last 5 entries with success/error icons + button label + timestamp + (for error rows) the error message.
6. Clicking a button opens a Tailwind-styled modal: "Enroll {contactName} in {workflowName}?". Cancel closes; Confirm POSTs `/api/enroll` with `{ buttonId, contactId, contactName }`.
7. On success: green toast + optimistic prepend of the returned `entry` to the activity panel (and update `lastSoaSentAt` if the entry has one).
8. On failure: red toast + the activity panel still shows the error row (the API returns it on 502).

**Identity hints:** `contactId` and `contactName` come from the iframe URL query string (`?contactId=…&contactName=…`) — that's GHL's documented hint for which contact the iframe is currently scoped to. These hints are passed verbatim to `/api/enroll` in the body. **The server still ignores them for tenant scoping** — `locationId` always comes from the decoded SSO. Per spec §4, query params are UX hints, not identity.

**No client-side persistence:** the JWT lives in component state only. A page reload re-runs the postMessage handshake.

---

## File map

**Created:**
- `app/widget/page.tsx` — server component shell
- `app/widget/Widget.tsx` — client component (top-level)
- `app/widget/useSso.ts` — `useSso()` hook + a sentinel value while booting
- `app/widget/apiFetch.ts` — `apiFetch(token, path, init)` — injects `X-GHL-SSO` + parses JSON
- `app/widget/ButtonGrid.tsx`
- `app/widget/ConfirmModal.tsx`
- `app/widget/ActivityPanel.tsx`
- `app/widget/Toast.tsx`
- `app/widget/types.ts` — shared `Button`, `LogEntry`, `WidgetData` types
- Co-located tests: `*.test.tsx` for each component/hook/helper that has behavior

No modifications to existing files.

---

## Type shapes (single source for both UI + tests)

```ts
// app/widget/types.ts
export interface Button {
  id: string
  label: string
  color: string
  workflowId: string
  workflowName: string
  sortOrder: number
  sendsSoa: boolean
}

export interface LogEntry {
  id: string
  contactId: string
  contactName: string | null
  buttonLabel: string
  workflowId: string
  workflowName: string
  triggeredByUserId: string
  triggeredByUserName: string
  status: 'success' | 'error'
  errorMessage: string | null
  triggeredAt: string
  soaSentAt: string | null
}

export interface WidgetData {
  buttons: Button[]
  entries: LogEntry[]
  lastSoaSentAt: string | null
}
```

---

## Task 1: `useSso()` hook

**Files:** `app/widget/useSso.ts` + `app/widget/useSso.test.tsx`

- [ ] **Step 1: Failing test** — covers:
  - On mount, posts `{ message: 'REQUEST_USER_DATA' }` to `window.parent` once
  - Returns `null` initially
  - When a `MessageEvent` arrives with `data.key` (string), returns the JWT
  - Ignores messages without `data.key` (e.g. random parent chatter)
  - Ignores messages where `data.key` is not a string

- [ ] **Step 2: Implement**:

```tsx
'use client'
import { useEffect, useState } from 'react'

export function useSso(): string | null {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
    function onMessage(ev: MessageEvent) {
      const data: unknown = ev.data
      if (typeof data === 'object' && data !== null && 'key' in data) {
        const key = (data as { key: unknown }).key
        if (typeof key === 'string') setToken(key)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return token
}
```

The `'*'` target origin is correct for GHL Marketplace iframes — we don't know the parent's origin until we hear from it, and the JWT itself is the only thing we trust.

- [ ] **Step 3: GREEN + commit.**

---

## Task 2: `apiFetch()` helper

**Files:** `app/widget/apiFetch.ts` + `app/widget/apiFetch.test.ts`

- [ ] **Step 1: Failing test** — covers:
  - Sends the request to the given path with `X-GHL-SSO: <token>`
  - Forwards `method`/`headers`/`body` on the init
  - Returns the parsed JSON on 2xx
  - Throws an `Error` whose message includes the status code + body text on non-2xx (so callers can show the message in a toast)

- [ ] **Step 2: Implement**:

```ts
export async function apiFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('X-GHL-SSO', token)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${res.status} ${detail || res.statusText}`.trim())
  }
  return res.json() as Promise<T>
}
```

- [ ] **Step 3: GREEN + commit.**

---

## Task 3: `ButtonGrid` component

**Files:** `app/widget/ButtonGrid.tsx` + `app/widget/ButtonGrid.test.tsx`

- [ ] **Step 1: Failing test** — covers:
  - Renders one button per item, using `label`, with `style.backgroundColor` set to `button.color`
  - Empty list renders the "no buttons configured" empty state
  - Clicking a button calls `onClick` with the full button object

- [ ] **Step 2: Implement** — semantic `<button>`s in a CSS grid. Use inline `style={{ backgroundColor: button.color }}` because Tailwind cannot generate per-hex colors at build time.

- [ ] **Step 3: GREEN + commit.**

---

## Task 4: `ConfirmModal` component

**Files:** `app/widget/ConfirmModal.tsx` + `app/widget/ConfirmModal.test.tsx`

- [ ] **Step 1: Failing test** — covers:
  - Hidden when `open` is false (not in the DOM, or `hidden` aria-hidden)
  - Visible when `open` is true; shows "Enroll {contactName} in {workflowName}?"
  - "Cancel" calls `onCancel`
  - "Confirm" calls `onConfirm`
  - Confirm button is disabled when `busy` is true

- [ ] **Step 2: Implement** — Tailwind modal: fixed-position overlay + centered panel. Keep it simple — no portal, no focus-trap (v1 polish budget).

- [ ] **Step 3: GREEN + commit.**

---

## Task 5: `ActivityPanel` + `Toast`

**Files:** `app/widget/ActivityPanel.tsx` + `app/widget/ActivityPanel.test.tsx` + `app/widget/Toast.tsx` + `app/widget/Toast.test.tsx`

- [ ] **Step 1: ActivityPanel tests** — covers:
  - Empty entries → "No activity yet"
  - Renders success row with the button label and a check (✓ or aria-label="success")
  - Renders error row with the button label, an x icon, AND the `errorMessage` text
  - Renders in the order it's given (caller handles sort)

- [ ] **Step 2: Toast tests** — covers:
  - `kind='success'` renders the message with a green class
  - `kind='error'` renders with a red class
  - `null` message renders nothing

- [ ] **Step 3: GREEN + commit.**

---

## Task 6: `Widget` top-level + integration test

**Files:** `app/widget/Widget.tsx` + `app/widget/Widget.test.tsx`

Integration test scope (MSW for fetch, dispatchEvent for postMessage):

- [ ] On mount: shows the loading state. After dispatching a `MessageEvent` with `{ key: '<jwt>' }`, fetches `/api/buttons` + `/api/log?contactId=…` and renders them.
- [ ] Renders "SOA last sent: 2026-05-12" when the log endpoint returns a non-null `lastSoaSentAt`.
- [ ] Renders "SOA last sent: never" when `lastSoaSentAt` is null.
- [ ] Clicking a button opens the confirm modal with "Enroll {contactName} in {workflowName}?"
- [ ] Confirming POSTs to `/api/enroll` with the SSO header and the right body, then prepends the returned entry to the activity panel.
- [ ] On 502, the activity panel still gets the error row prepended AND a red toast appears.
- [ ] Cancelling the modal does not call `/api/enroll`.

Props:
```ts
interface WidgetProps {
  contactId: string
  contactName: string
}
```

Implementation sketch:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useSso } from './useSso'
import { apiFetch } from './apiFetch'
import type { Button, LogEntry, WidgetData } from './types'
// ...sub-component imports

export function Widget({ contactId, contactName }: WidgetProps) {
  const token = useSso()
  const [data, setData] = useState<WidgetData | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [pending, setPending] = useState<Button | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const [b, l] = await Promise.all([
          apiFetch<{ buttons: Button[] }>(token, '/api/buttons'),
          apiFetch<{ entries: LogEntry[]; lastSoaSentAt: string | null }>(
            token,
            `/api/log?contactId=${encodeURIComponent(contactId)}`,
          ),
        ])
        if (!cancelled) setData({
          buttons: b.buttons,
          entries: l.entries,
          lastSoaSentAt: l.lastSoaSentAt,
        })
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : 'load failed')
      }
    })()
    return () => { cancelled = true }
  }, [token, contactId])

  async function confirmEnroll() {
    if (!token || !pending || !data) return
    setBusy(true)
    try {
      const res = await fetch('/api/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GHL-SSO': token },
        body: JSON.stringify({ buttonId: pending.id, contactId, contactName }),
      })
      const payload = (await res.json()) as { ok: boolean; entry: LogEntry }
      // ok=false still includes an entry (the error row)
      setData(d => d ? {
        buttons: d.buttons,
        entries: [payload.entry, ...d.entries].slice(0, 5),
        lastSoaSentAt: payload.entry.soaSentAt ?? d.lastSoaSentAt,
      } : d)
      setToast({
        kind: payload.ok ? 'success' : 'error',
        message: payload.ok
          ? `Enrolled in ${pending.workflowName}`
          : `Enrollment failed: ${payload.entry.errorMessage ?? 'unknown'}`,
      })
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'request failed' })
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  // ...render
}
```

- [ ] **GREEN + commit.**

---

## Task 7: `app/widget/page.tsx` server shell

**Files:** `app/widget/page.tsx`

- [ ] **Step 1**: server component that reads `contactId` + `contactName` from `searchParams` (Next.js 16: `Promise<…>`) and passes them to the client `<Widget />`.

```tsx
import { Widget } from './Widget'

export default async function WidgetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const contactId = typeof sp.contactId === 'string' ? sp.contactId : ''
  const contactName = typeof sp.contactName === 'string' ? sp.contactName : ''
  return (
    <main className="p-4">
      <Widget contactId={contactId} contactName={contactName} />
    </main>
  )
}
```

The page is *Server* so the iframe HTML can hydrate quickly with no JS-only shell.

No test for the page itself — its only behavior is "renders <Widget />" which the Widget tests cover.

- [ ] **Step 2**: commit.

---

## Task 8: Verify + tag

- [ ] `npm test` — full suite green (deltas: 1 useSso + 1 apiFetch + 1 ButtonGrid + 1 ConfirmModal + 1 ActivityPanel + 1 Toast + 1 Widget — approximate test counts per file).
- [ ] `npm run lint`
- [ ] `npm run build` — new route `/widget` appears.
- [ ] `git tag phase-6-complete`.
- [ ] `git status` clean.

---

## What's NOT in Phase 6

- **Focus trap / keyboard nav** in the confirm modal — v2 a11y polish.
- **Animated transitions** on the toast / modal — v2.
- **Retry/abort affordances** on a failed enroll — operator can click again; the activity row preserves the error.
- **Real-time activity feed** — page reload re-fetches.
- **Bulk enroll** — explicitly excluded in §15 non-goals.
- **A dedicated handshake-failure UI** when the parent never posts the JWT — we stay in the "Loading…" state. The server will reject any call missing/invalid SSO, so security isn't impacted; the worst case is an indefinite loading state in a development context where the iframe isn't actually embedded.
