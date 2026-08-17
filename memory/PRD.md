# Product Requirements — CoachG Workflow Buttons

## Original problem statement
A GHL Marketplace App that injects an iframe widget into the GoHighLevel
contact-record sidebar. Agents click color-coded buttons to enroll the current
contact into a pre-configured GHL workflow. The primary use case is sending a
Scope of Appointment (SOA) PDF — a CMS insurance compliance requirement.
Every enrollment is recorded in an activity log for legal paper trail. A
separate admin panel (sub-account settings page) lets GHL admins configure
buttons and view the full log.

Spec: `docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md`

## Architecture (one-line per layer)
- Next.js 16 App Router on Vercel (TypeScript strict)
- Postgres (Supabase) via the `postgres` driver (NOT @supabase/supabase-js)
- GHL OAuth 2.0 + GHL Marketplace SSO (HS256 JWT delivered via postMessage)
- Tailwind v4 (CSS-only config via `@theme inline`)
- Vitest + MSW + @testing-library/react + PGlite for tests

## User personas
- **Agent (default role)** — opens a contact in GHL, sees the widget in the
  sidebar, clicks a button to enroll the contact in a workflow.
- **Admin** — accesses the configuration page in sub-account settings to
  add/edit/reorder/delete buttons and view the full activity log.
- **Agency owner (you, WebSynq)** — installs the Marketplace App into the
  agency's 79 sub-accounts (OAuth one-time per sub-account).

## Core requirements (stable)
- `locationId` is ALWAYS derived from the verified SSO JWT, never from
  request body / query / headers. Cross-tenant access is impossible.
- Admin mutations enforced server-side via `withAdminSso` HOF.
- Browser never sees: Supabase URL, GHL client secret, GHL_SSO_KEY.
- Rate limit on `/api/enroll`: 10/minute per (locationId, userId).
- Activity log records every enrollment attempt (success or error), with
  `soa_sent_at` populated for buttons configured as `sends_soa = true`.
- `tsc --noEmit` clean, ESLint clean, all tests green at every phase tag.

## Implementation status

| Phase | Scope | Status | Tag |
|---|---|---|---|
| 0 | Test infrastructure (Vitest, MSW, fixtures) | ✅ | `phase-0-complete` |
| 1 | Supabase schema (4 tables, rate_limit_check fn, 3 migrations) | ✅ | `phase-1-complete` |
| 2 | OAuth callback (`/api/oauth/callback`) | ✅ | `phase-2-complete` |
| 2.5 | SSO verification (`lib/ghl-sso.ts`) | ✅ | `phase-2.5-complete` |
| 3 | GHL API client + auth HOFs (`lib/ghl.ts`, `lib/auth.ts`, 401-retry) | ✅ | `phase-3-complete` |
| 4 | Buttons CRUD (GET/POST/PUT/DELETE/reorder) + zod validation | ✅ | `phase-4-complete` |
| 5 | Enroll + log + rate-limit (`/api/enroll`, `/api/log`, `/api/workflows`) | ✅ | `phase-5-complete` |
| 6 | Widget UI (postMessage SSO, button grid, confirm modal, activity panel) | ✅ | `phase-6-complete` |
| 7 | Admin UI (role gate, button CRUD modal, color picker, activity log) | ✅ | `phase-7-complete` (2026-05-16) |

Total tests: **233 / 233 passing** • Lint clean • TS strict clean • `next build` green.

## Deployment status
- Repo is local in `/app`, on `master`, working tree clean.
- Hosted target: **Vercel** (user-driven; agent cannot push).
- DB target: **Supabase** (user needs to create a fresh project).
- App is NOT yet deployed. See `/app/DEPLOYMENT.md` for the full guide.

## Future / Backlog
- **P1 — CNA Button (future phase)** — 11-question Compliance Needs Assessment
  flow; adds Claude-API recommendation, writes to GHL custom fields, new
  `button_type = 'cna'` column on `buttons`.
- **P1 — Onboarding Engine (future phase)** — Chase's video-series checklist
  for new agent sub-accounts; new `onboarding_progress` table.
- **P2 — Drag-and-drop reorder** (currently up/down arrows).
- **P2 — Encryption-at-rest for OAuth tokens** (currently plaintext in
  Postgres; relies on Supabase row-level security + private network).
- **P2 — i18n layer** for multi-language sub-accounts.
- **P2 — Email digest of weekly error rows** (compliance audit aid).

## Out-of-scope (explicitly NOT this app)
- Mobile-only / native iOS/Android.
- A drag-builder for workflows themselves (workflows are still built in GHL).
- Replacing GHL's own contact UI; this is a sidebar embed only.
