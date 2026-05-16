# CoachG Workflow Buttons — Deployment Guide

This is the complete, step-by-step playbook to take the code in this repo from
"green tests on master" to "live in 79 GHL sub-accounts." Follow steps in
order. Do not skip ahead. Each step has a verification at the end — do not
move on until verification passes.

---

## Architecture in one paragraph

This is a single Next.js app deployed once on Vercel that serves ALL 79
sub-accounts. Each sub-account "installs" the app via GHL's Marketplace, which
runs a one-time OAuth handshake and stores tokens in Supabase keyed by
`locationId`. Agents see your widget as an iframe in the contact sidebar; admins
configure buttons via a second iframe in sub-account settings. When an agent
clicks a button, your server proxies the call to GHL's workflow-enrollment API
and writes an activity_log row for the CMS compliance paper trail.

---

## Step 1 — Create a fresh Supabase project (10 min)

1. Go to <https://supabase.com> → sign in → **New project**
2. Name: `coachg-workflow-buttons`
3. Region: pick **US East** (lowest latency to Vercel's default region)
4. Generate and **save the database password** in your password manager — you only see it once
5. Wait for the project to provision (~2 min)

### Apply the migrations
Supabase dashboard → SQL Editor → **New query**. Paste-and-run each migration
**in order**, one at a time. Each must complete cleanly before running the next.

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_add_soa_sent_at.sql
supabase/migrations/0003_add_sends_soa.sql
```

### Grab your connection string
Supabase → Settings → Database → **Connection string** → URI mode

You'll see two URLs. **Use the pooler URL on port 6543** — NOT the direct
connection on port 5432. The pooler is what Vercel needs for serverless.

Example shape:
```
postgresql://postgres.<project-ref>:<password>@aws-east.pooler.supabase.com:6543/postgres
```

Save this as `DATABASE_URL`. You'll paste it into Vercel in Step 4.

### ✅ Verification
- Supabase → Table Editor → you should see 4 tables: `ghl_tokens`, `buttons`,
  `activity_log`, `rate_limits`.
- Supabase → Database → Functions → you should see `rate_limit_check`.

---

## Step 2 — Verify (or create) your GHL Marketplace App (15 min)

If you already created the app for the agency, the settings below need to
match exactly. Open: GHL Agency → App Marketplace → Developer Portal → your app.

### 2a. Basic settings
| Field | Required value |
|---|---|
| App Type | **Private** (scoped to your agency's sub-accounts) |
| Distribution | Internal only |

### 2b. OAuth settings
| Field | Value |
|---|---|
| Redirect URI | `https://YOUR-VERCEL-URL.vercel.app/api/oauth/callback` *(set this AFTER Step 4)* |
| Scopes | `contacts.write`, `contacts.readonly`, `workflows.readonly`, `locations.readonly` |

### 2c. Custom Pages (THE iframes)
You need exactly two Custom Pages:

| # | Name | URL | Location | Visible to |
|---|---|---|---|---|
| 1 | Workflow Buttons | `https://YOUR-VERCEL-URL.vercel.app/widget` | Contact Sidebar | All roles |
| 2 | Workflow Buttons Admin | `https://YOUR-VERCEL-URL.vercel.app/admin` | Sub-account Settings | Admin only |

The "Admin only" filter on Custom Page #2 is UX polish — the app also enforces
admin on every API call server-side, so a non-admin who somehow opens `/admin`
sees an "Insufficient permissions" gate, never the real UI.

### 2d. Credentials to copy
On the same app page, copy three values into a temp file:

| Variable | Where it shows up in GHL |
|---|---|
| `GHL_CLIENT_ID` | OAuth section |
| `GHL_CLIENT_SECRET` | OAuth section — click "show" / "regenerate" if hidden |
| `GHL_SSO_KEY` | SSO section (sometimes labeled "shared secret" or "SSO key") |

⚠️ **If the SSO Key is missing from your existing app**, your iframes can't
authenticate. Most often GHL hides the SSO key until you toggle "Enable SSO"
on the app. Make sure it's enabled before copying.

### ✅ Verification
- You have all 3 credentials saved.
- You have 2 Custom Pages configured (their URLs are placeholders for now —
  you'll fill them in after deploy).

---

## Step 3 — Push the code to GitHub (2 min)

You cannot push from inside this Emergent environment, so use Emergent's
**Save to GitHub** button (top of your chat) and pick:

- Repo: `WebSynq/coachg-workflow-buttons`
- Branch: `master`

This pushes Phases 0–7 to your repo.

### ✅ Verification
Visit `https://github.com/WebSynq/coachg-workflow-buttons` and check:
- `app/admin/`, `app/widget/`, `app/api/` folders are visible
- `git tag` includes `phase-0-complete` through `phase-7-complete`

---

## Step 4 — Deploy on Vercel (10 min)

1. <https://vercel.com> → Add New… → Project → Import Git Repository
2. Pick `WebSynq/coachg-workflow-buttons` → Continue
3. Framework: **Next.js** (auto-detected)
4. Build & Output: leave defaults
5. **Before clicking Deploy**, expand "Environment Variables" and add:

| Name | Value |
|---|---|
| `DATABASE_URL` | The pooler URL from Step 1 (port 6543) |
| `GHL_CLIENT_ID` | From Step 2d |
| `GHL_CLIENT_SECRET` | From Step 2d |
| `GHL_SSO_KEY` | From Step 2d |
| `NEXT_PUBLIC_APP_URL` | Leave as `https://placeholder.vercel.app` for now — you'll update after deploy |

6. Click **Deploy**.
7. After ~2 min Vercel gives you the production URL, like
   `https://coachg-workflow-buttons-abc123.vercel.app`. Copy it.
8. Settings → Environment Variables → Edit `NEXT_PUBLIC_APP_URL` → paste the
   real URL → Save → Deployments → click the last deploy → **Redeploy**.

### ✅ Verification
Run these in any terminal (PowerShell, curl, or your browser):

```bash
# OAuth callback responds, but errors without a code param (correct):
curl -i https://YOUR-VERCEL-URL.vercel.app/api/oauth/callback
# Expected: HTTP/2 400 (or similar) — proves the route is alive

# SSO-gated endpoints reject unauthenticated requests:
curl -i https://YOUR-VERCEL-URL.vercel.app/api/buttons
# Expected: HTTP/2 401 with "Missing SSO token" — proves the gate is alive
```

If either returns 500, something is wrong with env vars or Supabase
connectivity. Vercel → Project → Logs to debug.

---

## Step 5 — Wire the Vercel URL back into GHL (3 min)

Go back to your GHL Marketplace App settings (Step 2) and replace every
`YOUR-VERCEL-URL.vercel.app` placeholder with the real Vercel URL:

- OAuth → Redirect URI → `https://your-real-url/api/oauth/callback`
- Custom Page #1 → URL → `https://your-real-url/widget`
- Custom Page #2 → URL → `https://your-real-url/admin`

Save the app.

---

## Step 6 — Install in ONE test sub-account first (10 min)

DO NOT install in all 79 sub-accounts yet. Validate end-to-end on one
low-stakes sub-account first.

### 6a. Install
1. GHL → switch into a test sub-account
2. App Marketplace → search "Workflow Buttons" → **Install**
3. GHL will redirect your browser through:
   `https://your-vercel-url/api/oauth/callback?code=xxx` (this URL flashes briefly)
4. After OAuth completes, GHL redirects you to the sub-account's settings page
   (your app's redirect target). You may see the admin iframe immediately.

### 6b. Verify the OAuth handshake worked
Supabase → Table Editor → `ghl_tokens` → you should see a new row with:
- `location_id` = the test sub-account's locationId
- `access_token`, `refresh_token`, `expires_at` populated

If the row is missing: Vercel → Logs → search for `/api/oauth/callback` and
look for the error. Most common failures are wrong scopes or wrong redirect URI.

### 6c. Configure your first button (admin path)
1. Inside the test sub-account → **Settings** → look for **"Workflow Buttons
   Admin"** in the sidebar
2. Click it — your `/admin` page loads inside the iframe
3. You should see:
   - The "Insufficient permissions" gate if you're NOT logged in as an admin
   - OR the full admin UI with **Buttons** and **Activity Log** tabs
4. On the Buttons tab → **Add Button**:
   - Label: `Send SOA`
   - Color: pick any red preset
   - Workflow: pick a real GHL workflow you've already built in this
     sub-account that sends your SOA PDF
   - "This button sends the SOA" — leave checked
5. **Save**. The new row appears in the table.

### 6d. Verify on the agent path
1. Same test sub-account → open any contact
2. Look at the right-hand sidebar — the **Workflow Buttons** widget appears
3. Your `Send SOA` red button is there
4. Click it → confirmation modal: "Enroll [contact name] in [workflow]?" → **Confirm**
5. You should see:
   - A green success toast at the bottom right
   - The new entry at the top of the "Recent activity" list with a green ✓
   - The "SOA last sent: YYYY-MM-DD" line below the buttons updates
6. **Verify in GHL** — open the contact's Workflows tab → contact is now
   enrolled in your SOA workflow → workflow fires → SOA PDF is sent
7. **Verify in Supabase** → `activity_log` table → new row with:
   - `status = 'success'`
   - `contact_id` = the contact
   - `soa_sent_at` is populated

### ✅ Step 6 Verification checklist
- [ ] OAuth row exists in `ghl_tokens`
- [ ] Admin UI loads inside GHL settings iframe
- [ ] You can add/edit/delete a button
- [ ] Widget loads inside contact sidebar
- [ ] Click → confirm → success toast appears
- [ ] Contact is actually enrolled in the GHL workflow
- [ ] `activity_log` row is written with `status='success'` and `soa_sent_at` populated

**If all 7 pass, you are production-ready.** Move to Step 7.

---

## Step 7 — Roll out to the remaining 78 sub-accounts (1 hour)

### Option A — Manual install per-agent (lowest risk, recommended)
Send each agent the install link:
```
https://marketplace.gohighlevel.com/apps/<your-app-id>/install
```
They install from their own sub-account → OAuth fires → tokens stored.

You can find `<your-app-id>` in the URL of your GHL Marketplace app page.

### Option B — Bulk install via GHL Agency API (PowerShell)
Only do this AFTER Option A worked smoothly for at least 5 sub-accounts:

```powershell
$headers = @{
    "Authorization" = "Bearer YOUR_AGENCY_TOKEN"
    "Version" = "2021-07-28"
    "Content-Type" = "application/json"
}

$locationIds = @(
    "locId-1",
    "locId-2"
    # ... all 79
)

foreach ($locId in $locationIds) {
    $body = @{ locationId = $locId } | ConvertTo-Json
    try {
        Invoke-RestMethod `
            -Uri "https://services.leadconnectorhq.com/oauth/installedLocations" `
            -Method POST `
            -Headers $headers `
            -Body $body
        Write-Host "Installed: $locId"
    } catch {
        Write-Host "Failed: $locId — $($_.Exception.Message)" -ForegroundColor Red
    }
    Start-Sleep -Milliseconds 250  # respect rate limits
}
```

### ✅ Step 7 Verification
- Supabase → `ghl_tokens` table → row count should equal the number of
  sub-accounts you've installed into (79 when fully rolled out).
- Spot-check 3 random sub-accounts: log in, open a contact, see the widget,
  click a button, verify enrollment.

---

## Step 8 — Ongoing monitoring & maintenance

### Daily / weekly
- **Vercel → Logs** → filter for `/api/enroll` → any `500` or `502` responses
  indicate a GHL upstream issue or a config problem in that sub-account
- **Supabase → activity_log table** → filter `WHERE status = 'error'`:
  - `workflow not found` → admin deleted the workflow in GHL but kept the button
  - `permission denied` → OAuth scopes were narrowed by GHL since install
  - `429` → rate limited (rare; means an agent click-spammed a button)

### Per-quarter
- Audit `activity_log` for CMS compliance — every SOA-bearing button click
  has a `soa_sent_at` timestamp and a `triggered_by_user_id` for accountability
- Rotate `GHL_CLIENT_SECRET` if your security policy requires it (regenerate
  in GHL Marketplace → update in Vercel env vars → redeploy)

### Adding a new sub-account later
Just send the new agent the install link from Step 7 Option A. Nothing else
changes — same Vercel URL, same Supabase project. The new `ghl_tokens` row
appears automatically after their OAuth completes.

---

## Common errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `/widget` loads but says "Loading…" forever | `GHL_SSO_KEY` env var doesn't match the actual SSO key in GHL | Compare exact value in Vercel vs. GHL Marketplace app → re-paste → redeploy |
| `/api/buttons` returns 401 from inside the iframe | postMessage from GHL parent isn't reaching the iframe | Confirm Custom Page URLs in GHL exactly match the deployed Vercel URL (including https) |
| `/api/enroll` returns 502 with "GHL request failed: 401" | OAuth tokens for that sub-account are revoked or expired beyond refresh | The sub-account needs to reinstall the app from Marketplace |
| `/api/enroll` returns 429 | Agent hit 10 enrolls/min for the same contact | Wait a minute; rate limit is per-(locationId, userId) |
| Admin UI shows the "Insufficient permissions" gate even though you're an agency admin | GHL is sending you the JWT with role != 'admin' for THIS sub-account | Confirm your GHL user has the admin role specifically on the sub-account you're testing in |
| Vercel build fails on first deploy | Missing one of the 5 env vars | Settings → Environment Variables → confirm all 5 are set |
| Cold-start latency on the first request | Serverless cold start + Postgres pool boot | Subsequent requests are fast; usually <50ms |

---

## Key URLs cheat sheet

| What | URL |
|---|---|
| Production app | `https://YOUR-VERCEL-URL.vercel.app` |
| Widget iframe | `https://YOUR-VERCEL-URL.vercel.app/widget` |
| Admin iframe | `https://YOUR-VERCEL-URL.vercel.app/admin` |
| OAuth callback | `https://YOUR-VERCEL-URL.vercel.app/api/oauth/callback` |
| Supabase dashboard | `https://supabase.com/dashboard/project/<your-ref>` |
| Vercel dashboard | `https://vercel.com/websynq/coachg-workflow-buttons` |
| GHL Marketplace app | GHL Agency → App Marketplace → Developer Portal |

---

## Environment variables checklist

These five MUST be set in Vercel before the first deploy works:

- [ ] `DATABASE_URL` — Supabase pooler URL (port 6543)
- [ ] `GHL_CLIENT_ID` — from GHL Marketplace app
- [ ] `GHL_CLIENT_SECRET` — from GHL Marketplace app
- [ ] `GHL_SSO_KEY` — from GHL Marketplace app (must enable SSO first)
- [ ] `NEXT_PUBLIC_APP_URL` — your actual Vercel URL (set after first deploy)

---

## What's NOT done (deferred / future)

| Item | Phase | Notes |
|---|---|---|
| CNA button (11-question compliance form + Claude summary) | Future | New `button_type='cna'` column; new `/api/cna` route |
| Onboarding engine (Chase's video-series checklist) | Future | New `onboarding_progress` table; new `/onboarding` page |
| Drag-and-drop reorder | P2 | Currently up/down arrows |
| OAuth token encryption-at-rest | P2 | Currently plaintext; relies on Supabase RLS |
| i18n | P2 | Currently English only |
| Weekly error-row email digest | P2 | Currently you manually query `activity_log` |
