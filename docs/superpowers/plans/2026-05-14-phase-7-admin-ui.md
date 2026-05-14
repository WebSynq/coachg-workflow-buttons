# Phase 7: Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Build the `/admin` configuration page — the sub-account settings UI for managing button definitions (CRUD + reorder) and viewing the full activity log.

**Spec reference:** §5 (roles), §7 (routes consumed), §9 (admin UI), §10 (Phase 7 test scope).

**Out of scope for Phase 7:**
- Drag-and-drop reorder — spec §15 explicit non-goal. Up/down arrows only.
- Dedicated styling polish / dark-mode tuning.
- Real Playwright E2E.

---

## Behavior contract

On mount the admin client:

1. Bootstraps the SSO JWT via the same `useSso()` hook the widget uses (postMessage handshake).
2. Decodes the JWT client-side **for display only** to read `role`. If `role !== 'admin'`, renders an "Insufficient permissions" gate instead of the UI. (The server is the security authority — every `withAdminSso` route already returns 403 to non-admins. The client gate is UX polish so a non-admin sees a clear message instead of an empty + 403-spammed table.)
3. Once admin is confirmed, fetches `/api/buttons`, `/api/workflows`, and `/api/log` (admin mode, first page) in parallel.
4. Renders a tab bar with two tabs: **Buttons** (default) and **Activity Log**.
5. Buttons tab:
   - Table with one row per button: color swatch, label, workflow name, up arrow, down arrow, Edit, Delete.
   - "Add Button" button above the table opens the form modal in create mode.
   - Up/down arrows swap with the neighbor row, then POST `/api/buttons/reorder` with the new full ordering. Disabled at boundaries.
   - Edit opens the form modal in edit mode pre-filled with the row's values.
   - Delete opens a small confirm dialog ("Delete '{label}'?") that calls `DELETE /api/buttons/[id]`.
6. Activity Log tab:
   - Paginated list of all entries for the location (uses `/api/log` admin mode). Default 20 per page; Previous/Next buttons; current page shown.
   - Each row shows: success/error icon, button label, workflow name, contact name, timestamp, optional error message.
7. Form modal (create/edit):
   - Label input (1–50 chars).
   - Color picker — 10 preset swatches + custom hex input. Selecting a swatch fills the hex input.
   - Workflow dropdown populated from `/api/workflows`.
   - "Sends SOA" checkbox (default checked).
   - Save → POST `/api/buttons` or PUT `/api/buttons/[id]`; on success, refreshes the buttons list + closes the modal; on validation error, surface the message.

**Identity & query params:** the page may receive `?locationId=…` from the OAuth post-install redirect. It's a UX hint only — server still authoritative.

---

## File map

**Created in `app/admin/`:**
- `page.tsx` — server-component shell
- `Admin.tsx` — client container
- `Admin.test.tsx` — integration coverage (role gate, tab switch, CRUD, reorder)
- `AdminGate.tsx` / `AdminGate.test.tsx` — role gate component
- `Tabs.tsx` / `Tabs.test.tsx` — minimal tab bar
- `ButtonTable.tsx` / `ButtonTable.test.tsx`
- `ButtonFormModal.tsx` / `ButtonFormModal.test.tsx`
- `ActivityTab.tsx` / `ActivityTab.test.tsx`

**Created in `lib/`:**
- `client-sso.ts` — `decodeSsoForDisplay(token): { role: string } | null`. Uses `atob` to read the JWT payload **without verifying** (display-only).
- `client-sso.test.ts`

**Imports from existing widget code:** `useSso`, `apiFetch`, `Toast`, `ConfirmModal`, `types.ts`. Importing across `app/widget/` and `app/admin/` is fine — both compile through Next.js' module resolver. We could move shared bits to a neutral location later if we add a third surface; for now, leaving them under `widget/` and importing from `admin/` is the minimal-change path.

---

## Color presets

```ts
export const COLOR_PRESETS = [
  '#EF4444', // red
  '#F97316', // orange
  '#EAB308', // yellow
  '#22C55E', // green
  '#14B8A6', // teal
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#A855F7', // purple
  '#EC4899', // pink
  '#6B7280', // gray
] as const
```

---

## Task 1: `lib/client-sso.ts` — decode-without-verify helper

**Test cases:**
- Returns `{ role: 'admin' }` from a valid 3-segment JWT whose payload contains `role: 'admin'`
- Returns null for empty / malformed / non-JWT strings
- Returns null when the payload lacks `role`
- Returns null when the payload's `role` is not a string

Implementation note: this lives in `lib/` (not `app/widget/`) because admin will import it; both widget and admin can pull from `lib/`. It does NOT call `jsonwebtoken.verify()` — verification only happens server-side, every request. This helper is purely for UX gating.

```ts
export function decodeSsoForDisplay(token: string): { role: string } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    // base64url → base64 → atob → JSON
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(b64)) as unknown
    if (typeof json !== 'object' || json === null) return null
    const role = (json as { role?: unknown }).role
    if (typeof role !== 'string') return null
    return { role }
  } catch {
    return null
  }
}
```

---

## Task 2: `AdminGate` + `Tabs`

**AdminGate test cases:**
- When `role === 'admin'`, renders children
- Otherwise renders an "Insufficient permissions" message (and not the children)

**Tabs test cases:**
- Renders one button per tab label
- Highlights the active tab (some role/aria-current marker)
- Clicking a non-active tab calls `onSelect(tabKey)`

Both are tiny presentational components — simple Tailwind.

---

## Task 3: `ButtonFormModal`

**Test cases:**
- Hidden when `open={false}`
- Open in **create mode** (no `initial` prop): inputs blank, "Sends SOA" pre-checked, workflows dropdown shows the passed workflow list
- Open in **edit mode** (with `initial`): fields pre-filled with the existing values, color swatch reflects the existing color
- Clicking a preset swatch updates the color hex input — **round-trip test**: pick a different preset, click Save, assert the `onSave` arg has the new color
- Rejects an invalid hex (form-level validation) — Save disabled OR a visible error
- Cancel calls `onCancel`, Save calls `onSave({ label, color, workflowId, workflowName, sendsSoa })`

Implementation: it's a controlled form. On Save, derives `workflowName` from the dropdown's selected option.

---

## Task 4: `ButtonTable`

**Test cases:**
- Renders a row per button with the label, workflow name, and a color swatch element
- Up arrow on row N calls `onReorder([..., row[N], row[N-1], ...])` (i.e. swaps the two)
- Up arrow disabled on the first row; Down arrow disabled on the last row
- Edit calls `onEdit(row)`
- Delete calls `onDelete(row)`
- Empty list shows the empty state

---

## Task 5: `ActivityTab`

**Test cases:**
- Shows the page of entries with success/error icons + button label + workflow name + contact name + timestamp + error message (when present)
- "Previous" disabled on page 1; "Next" disabled on the last page
- Clicking Next/Previous calls `onPageChange(newOffset)`
- Shows "page X of Y" derived from `total` / `limit`

---

## Task 6: `Admin` container + integration test

The container threads through:
- `useSso()` → token
- `decodeSsoForDisplay(token)` → role
- If not admin: render `<AdminGate />` only
- Else: fetch `/api/buttons` + `/api/workflows` + `/api/log` (admin mode) in parallel, then render the tabbed UI
- On mutation (create/update/delete/reorder): refetch `/api/buttons` to stay consistent with the server (avoids divergence from sort_order auto-assignment)
- On activity-tab page change: refetch `/api/log` with the new offset

**Integration tests (MSW + jsdom):**
- Non-admin sees the gate, not the table or the Add button.
- Admin sees the Add button + the existing rows.
- Adding a button: open modal → fill → Save → POST `/api/buttons` called with the right body → table re-fetched.
- Deleting a button: confirm prompt → DELETE called.
- Reorder: click "Up" on row 2 → POST `/api/buttons/reorder` called with the swapped order.
- Activity tab: clicking Next loads the next page (offset advances).
- Color picker round-trip: pick a different preset in the form modal, save, assert request body has the new color.

---

## Task 7: `app/admin/page.tsx`

Server component shell — same shape as the widget's, with no `searchParams` required (admin doesn't take contactId).

```tsx
import { Admin } from './Admin'
export default function AdminPage() {
  return (
    <main className="p-6 max-w-4xl mx-auto">
      <Admin />
    </main>
  )
}
```

---

## Task 8: Verify + tag

- [ ] `npm test` — full suite (deltas across new files; verify the total grew accordingly)
- [ ] `npm run lint`
- [ ] `npm run build` — `/admin` appears in route summary
- [ ] `git tag phase-7-complete`
- [ ] `git status` clean

---

## What's NOT in Phase 7

- **Form-level field-by-field error highlighting.** The modal will surface one generic "save failed" message instead of mapping zod's per-field errors back onto inputs. v2 polish.
- **Drag-and-drop.** Up/down only per spec §15.
- **Real-time activity refresh.** Reload the page or switch tabs to re-fetch.
- **Bulk button operations.** Spec non-goal.
- **A separate admin-only `/api/log?role=admin` check.** Spec §7 lists `withSso` (not `withAdminSso`) for `/api/log`; admin UI hides the activity tab from non-admins via the role gate — server still serves any SSO holder.
