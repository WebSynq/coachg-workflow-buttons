# Phase 1: Supabase Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `supabase/migrations/0001_init.sql` — four tables (`ghl_tokens`, `buttons`, `activity_log`, `rate_limits`), a `set_updated_at()` trigger function, table triggers on the mutable tables, and a `rate_limit_check()` function — all tested against an in-process Postgres via PGlite. Phase ends with the migration file committed, all tests green, and a `phase-1-complete` tag.

**Architecture:** The migration is written as one SQL file. It's tested against [PGlite](https://pglite.dev) — Postgres 16 compiled to WASM, running in-process inside Node via `@electric-sql/pglite`. No Docker, no remote Supabase calls during testing. Each test calls `createTestDb()` to spin up a fresh PGlite, apply the migration, and assert structure or behavior. Applying the same migration to the user's real Supabase project is a **separate, user-gated operation** that happens after this phase is sealed — outside the scope of this plan.

**Tech Stack:** `@electric-sql/pglite` (Postgres 16 in WASM, in-process, ~3MB), Vitest (already installed from Phase 0), Node `fs`/`path`/`url`. No new runtime dependencies — PGlite is dev-only.

**Spec reference:** `docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md` section 6 (Supabase schema).

**Out of scope for Phase 1:**
- Applying the migration to the user's actual Supabase project. That's a user-gated operational step that follows phase verification. Task 7 documents how to do it but does NOT do it.
- Encryption-at-rest for `ghl_tokens` (deferred to v2 per spec section 14).
- Row-Level Security policies (off for v1 per spec section 6).
- Retention/cleanup policies for `activity_log` or `rate_limits` (deferred to v2 per spec section 14).
- Any application code that uses these tables — that's Phase 2+.
- Future tables (webhooks, etc.) — not in v1 design.

**Reference docs to skim if anything looks unfamiliar:**
- PGlite API: https://pglite.dev/docs/api (focus on `new PGlite()`, `db.exec()`, `db.query()`)
- Postgres CHECK constraints: https://www.postgresql.org/docs/16/ddl-constraints.html
- Postgres `ON CONFLICT`: https://www.postgresql.org/docs/16/sql-insert.html#SQL-ON-CONFLICT
- The design spec section 6 (link above)

**Important repo conventions (already established in Phase 0):**
- TypeScript with `"strict": true`, `"module": "esnext"`, `"moduleResolution": "bundler"`.
- Vitest with `globals: false` — every test imports `describe, expect, it` (and friends) from `'vitest'`.
- Default Vitest environment is `node`. None of Phase 1's tests need jsdom.
- ESM throughout. `__dirname` is not available; use `import.meta.dirname` (Node 20.11+).
- MSW is wired in `vitest.setup.ts` with `onUnhandledRequest: 'error'`. PGlite is in-process and makes no HTTP calls, so this doesn't interfere with DB tests.
- `test/examples/` from Phase 0 stays in place as living documentation. Don't touch it.

---

## How the migration file grows across tasks

`supabase/migrations/0001_init.sql` is created in Task 2 and APPENDED to in Tasks 3–6. Each task's "Step: write SQL" shows the SQL block to APPEND to the end of the file (preserving everything from prior tasks). **Do NOT overwrite the file** — each task is additive. The whole migration must remain a single file (one transaction at apply time).

Each task's tests assert only the schema introduced by that task. Earlier task tests must continue to pass as the migration grows. If a later task's SQL breaks an earlier test, that's a regression — STOP and report.

---

## File map

**Created:**
- `supabase/migrations/0001_init.sql` — the migration. Grown across Tasks 2–6.
- `test/db/setup.ts` — PGlite test harness. Exports `createPgLite()` (empty DB) and `createTestDb()` (migration applied).
- `test/db/ghl-tokens.test.ts` — structural + trigger tests for `ghl_tokens`.
- `test/db/buttons.test.ts` — structural + constraint + trigger tests for `buttons`.
- `test/db/activity-log.test.ts` — structural + constraint tests for `activity_log`.
- `test/db/rate-limits.test.ts` — structural tests for `rate_limits`.
- `test/db/rate-limit-check.test.ts` — behavioral tests for `rate_limit_check()`.

**Modified:**
- `package.json` — adds `@electric-sql/pglite` to devDependencies.

Each test file has one clear responsibility: assert the migration produces the schema or behavior its name describes. The harness has one responsibility: spin up Postgres + apply the migration.

---

## Task 1: PGlite test harness

**Files:**
- Modify: `package.json` (install dep)
- Create: `test/db/setup.ts`
- Create: `test/db/harness.test.ts` (verification test for the harness — deleted at end of phase)

- [ ] **Step 1: Install PGlite**

Run:
```bash
npm install --save-dev @electric-sql/pglite
```

Expected: install succeeds. `package.json` `devDependencies` now includes `@electric-sql/pglite` at version `^0.2.x` or `^0.3.x`.

- [ ] **Step 2: Create the test harness**

Create `test/db/setup.ts` with EXACTLY this content:

```ts
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '0001_init.sql',
)

export async function createPgLite(): Promise<PGlite> {
  return new PGlite()
}

export async function createTestDb(): Promise<PGlite> {
  const db = await createPgLite()
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  await db.exec(sql)
  return db
}
```

Notes for the implementer:
- `createPgLite()` returns a fresh in-memory Postgres instance with no schema. Use it when you need a clean slate.
- `createTestDb()` does the same, then applies the migration file. Most Phase 1 tests use this.
- `import.meta.dirname` requires Node 20.11+. If `npm test` reports `Cannot read properties of undefined`, fall back to:
  ```ts
  import { fileURLToPath } from 'node:url'
  import { dirname } from 'node:path'
  const __here = dirname(fileURLToPath(import.meta.url))
  ```
  and replace `import.meta.dirname` with `__here`.

- [ ] **Step 3: Write a verification test for the harness**

Create `test/db/harness.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { createPgLite } from './setup'

describe('PGlite harness', () => {
  let db: Awaited<ReturnType<typeof createPgLite>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  it('can spin up an empty Postgres and run a query', async () => {
    db = await createPgLite()
    const result = await db.query<{ sum: number }>('SELECT 1 + 1 AS sum')
    expect(result.rows).toEqual([{ sum: 2 }])
  })

  it('reports the Postgres version', async () => {
    db = await createPgLite()
    const result = await db.query<{ version: string }>('SELECT version()')
    expect(result.rows[0].version).toMatch(/PostgreSQL/)
  })
})
```

This test does NOT use `createTestDb()` — it uses the lower-level `createPgLite()` because the migration file does not exist yet. That's intentional. Phase 1 Task 2 introduces the migration; the harness must be testable before any migration exists.

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
npm test
```

Expected: 11 passed (9 Phase 0 + 2 new harness). If PGlite's first run takes longer than usual (~1–2s), that's normal — the WASM is being initialized.

If you see `Cannot read properties of undefined (reading 'dirname')`, apply the `__here` fallback described in Step 2 and re-run.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json test/db/setup.ts test/db/harness.test.ts
git commit -m "test: add PGlite-based DB test harness for Phase 1

Spins up Postgres 16 in WASM (no Docker required) for migration
testing. createPgLite() returns an empty instance; createTestDb()
applies supabase/migrations/0001_init.sql once it exists. The
harness.test.ts verification will be removed at end of phase."
```

---

## Task 2: ghl_tokens table + set_updated_at() trigger function

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `test/db/ghl-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/db/ghl-tokens.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

type Column = {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

describe('ghl_tokens table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  it('exists with the expected columns', async () => {
    db = await createTestDb()
    const { rows } = await db.query<Column>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ghl_tokens'
      ORDER BY ordinal_position
    `)
    expect(rows.map((r) => r.column_name)).toEqual([
      'location_id',
      'access_token',
      'refresh_token',
      'expires_at',
      'created_at',
      'updated_at',
    ])
  })

  it('uses location_id as the primary key', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ column_name: string }>(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        USING (constraint_schema, constraint_name)
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'ghl_tokens'
        AND tc.constraint_type = 'PRIMARY KEY'
    `)
    expect(rows.map((r) => r.column_name)).toEqual(['location_id'])
  })

  it('rejects rows with null access_token, refresh_token, or expires_at', async () => {
    db = await createTestDb()
    await expect(
      db.exec(`INSERT INTO ghl_tokens (location_id) VALUES ('loc_1')`),
    ).rejects.toThrow()
  })

  it('accepts a complete row insert', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
      VALUES ('loc_1', 'at', 'rt', now() + interval '1 hour')
    `)
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ghl_tokens`,
    )
    expect(rows[0].count).toBe('1')
  })

  it('bumps updated_at via trigger on UPDATE', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO ghl_tokens (location_id, access_token, refresh_token, expires_at)
      VALUES ('loc_1', 'at', 'rt', now() + interval '1 hour')
    `)
    const before = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM ghl_tokens WHERE location_id = 'loc_1'`,
    )

    // Wait long enough for now() to advance by at least 1 ms.
    await new Promise((r) => setTimeout(r, 5))

    await db.exec(`
      UPDATE ghl_tokens SET access_token = 'at2' WHERE location_id = 'loc_1'
    `)
    const after = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM ghl_tokens WHERE location_id = 'loc_1'`,
    )

    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].updated_at).getTime(),
    )
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
npm test
```

Expected: the harness test still passes (2). The new `ghl-tokens.test.ts` file FAILS at module load with `ENOENT: no such file or directory ... 0001_init.sql` (because the migration file does not yet exist). This is the correct RED state.

- [ ] **Step 3: Create the migration file**

Create `supabase/migrations/0001_init.sql` with EXACTLY this content:

```sql
-- CoachG Workflow Buttons — initial schema
-- See docs/superpowers/specs/2026-05-12-coachg-workflow-buttons-design.md §6

-- Cross-table trigger function: bump updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- OAuth tokens, one row per GHL sub-account (location).
CREATE TABLE ghl_tokens (
  location_id   text PRIMARY KEY,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER ghl_tokens_set_updated_at
  BEFORE UPDATE ON ghl_tokens
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
npm test
```

Expected: 16 passed (9 Phase 0 + 2 harness + 5 ghl-tokens). If any earlier test fails, STOP and investigate — the migration must not break harness tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql test/db/ghl-tokens.test.ts
git commit -m "feat(db): add ghl_tokens table + set_updated_at trigger

First slice of the Phase 1 migration. Defines the cross-table
set_updated_at() function and the ghl_tokens table that stores
GHL OAuth access/refresh tokens (one row per location)."
```

---

## Task 3: buttons table + indexes + constraints + trigger

**Files:**
- Modify: `supabase/migrations/0001_init.sql` (append)
- Create: `test/db/buttons.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/db/buttons.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

type Column = {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

describe('buttons table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  async function insertValidButton(label = 'Hot Lead', color = '#ff0000') {
    await db!.exec(`
      INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
      VALUES ('loc_1', '${label}', '${color}', 'wf_1', 'Nurture', 0)
    `)
  }

  it('exists with the expected columns', async () => {
    db = await createTestDb()
    const { rows } = await db.query<Column>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'buttons'
      ORDER BY ordinal_position
    `)
    expect(rows.map((r) => r.column_name)).toEqual([
      'id',
      'location_id',
      'label',
      'color',
      'workflow_id',
      'workflow_name',
      'sort_order',
      'created_at',
      'updated_at',
    ])
  })

  it('generates a uuid id by default', async () => {
    db = await createTestDb()
    await insertValidButton()
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM buttons`)
    expect(rows[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('rejects an invalid color format', async () => {
    db = await createTestDb()
    await expect(
      db.exec(`
        INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
        VALUES ('loc_1', 'Bad', 'red', 'wf_1', 'Nurture', 0)
      `),
    ).rejects.toThrow()
  })

  it('rejects a 4-digit hex color', async () => {
    db = await createTestDb()
    await expect(
      db.exec(`
        INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
        VALUES ('loc_1', 'Bad', '#fff', 'wf_1', 'Nurture', 0)
      `),
    ).rejects.toThrow()
  })

  it('accepts both lowercase and uppercase 6-digit hex colors', async () => {
    db = await createTestDb()
    await insertValidButton('Lower', '#abcdef')
    await insertValidButton('Upper', '#ABCDEF')
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM buttons`,
    )
    expect(rows[0].count).toBe('2')
  })

  it('rejects a label longer than 50 characters', async () => {
    db = await createTestDb()
    const longLabel = 'x'.repeat(51)
    await expect(
      db.exec(`
        INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order)
        VALUES ('loc_1', '${longLabel}', '#ff0000', 'wf_1', 'Nurture', 0)
      `),
    ).rejects.toThrow()
  })

  it('has an index on (location_id, sort_order)', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'buttons'
    `)
    const defs = rows.map((r) => r.indexdef).join('\n')
    expect(defs).toMatch(/\(location_id,\s*sort_order\)/)
  })

  it('bumps updated_at via trigger on UPDATE', async () => {
    db = await createTestDb()
    await insertValidButton()
    const before = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM buttons LIMIT 1`,
    )
    await new Promise((r) => setTimeout(r, 5))
    await db.exec(`UPDATE buttons SET label = 'Renamed'`)
    const after = await db.query<{ updated_at: string }>(
      `SELECT updated_at FROM buttons LIMIT 1`,
    )
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].updated_at).getTime(),
    )
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
npm test
```

Expected: the 8 new `buttons` tests FAIL (most with "relation \"buttons\" does not exist"). All prior tests still pass.

- [ ] **Step 3: Append to the migration**

APPEND the following block to the END of `supabase/migrations/0001_init.sql` (do NOT replace the file):

```sql

-- Operator-configured buttons, scoped to a GHL location.
CREATE TABLE buttons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   text NOT NULL,
  label         text NOT NULL,
  color         text NOT NULL,
  workflow_id   text NOT NULL,
  workflow_name text NOT NULL,
  sort_order    integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buttons_label_length CHECK (char_length(label) <= 50),
  CONSTRAINT buttons_color_format CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE INDEX buttons_location_sort_idx ON buttons (location_id, sort_order);

CREATE TRIGGER buttons_set_updated_at
  BEFORE UPDATE ON buttons
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
npm test
```

Expected: 24 passed (9 Phase 0 + 2 harness + 5 ghl-tokens + 8 buttons).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql test/db/buttons.test.ts
git commit -m "feat(db): add buttons table with color + label constraints

Adds the buttons table scoped to location_id with a uuid PK,
check constraints (#RRGGBB color, ≤50 char label), an index
on (location_id, sort_order) for ordered reads, and the
updated_at trigger."
```

---

## Task 4: activity_log table + indexes + constraint

**Files:**
- Modify: `supabase/migrations/0001_init.sql` (append)
- Create: `test/db/activity-log.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/db/activity-log.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

describe('activity_log table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  async function insertSuccessRow() {
    await db!.exec(`
      INSERT INTO activity_log (
        location_id, contact_id, contact_name, button_label,
        workflow_id, workflow_name,
        triggered_by_user_id, triggered_by_user_name, status
      )
      VALUES (
        'loc_1', 'con_1', 'Jane Doe', 'Hot Lead',
        'wf_1', 'Nurture',
        'usr_1', 'Tim', 'success'
      )
    `)
  }

  it('exists with the expected columns', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'activity_log'
      ORDER BY ordinal_position
    `)
    expect(rows.map((r) => r.column_name)).toEqual([
      'id',
      'location_id',
      'contact_id',
      'contact_name',
      'button_label',
      'workflow_id',
      'workflow_name',
      'triggered_by_user_id',
      'triggered_by_user_name',
      'status',
      'error_message',
      'triggered_at',
    ])
  })

  it('accepts a successful enrollment row', async () => {
    db = await createTestDb()
    await insertSuccessRow()
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM activity_log`,
    )
    expect(rows[0].count).toBe('1')
  })

  it('accepts an error row with an error_message', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO activity_log (
        location_id, contact_id, button_label, workflow_id, workflow_name,
        triggered_by_user_id, triggered_by_user_name, status, error_message
      )
      VALUES (
        'loc_1', 'con_1', 'Hot Lead', 'wf_1', 'Nurture',
        'usr_1', 'Tim', 'error', 'GHL returned 502'
      )
    `)
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM activity_log`,
    )
    expect(rows[0].count).toBe('1')
  })

  it('allows a null contact_name', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO activity_log (
        location_id, contact_id, button_label, workflow_id, workflow_name,
        triggered_by_user_id, triggered_by_user_name, status
      )
      VALUES (
        'loc_1', 'con_1', 'Hot Lead', 'wf_1', 'Nurture',
        'usr_1', 'Tim', 'success'
      )
    `)
    const { rows } = await db.query<{ contact_name: string | null }>(
      `SELECT contact_name FROM activity_log`,
    )
    expect(rows[0].contact_name).toBeNull()
  })

  it('rejects a status that is not success or error', async () => {
    db = await createTestDb()
    await expect(
      db.exec(`
        INSERT INTO activity_log (
          location_id, contact_id, button_label, workflow_id, workflow_name,
          triggered_by_user_id, triggered_by_user_name, status
        )
        VALUES (
          'loc_1', 'con_1', 'Hot Lead', 'wf_1', 'Nurture',
          'usr_1', 'Tim', 'pending'
        )
      `),
    ).rejects.toThrow()
  })

  it('defaults triggered_at to now()', async () => {
    db = await createTestDb()
    await insertSuccessRow()
    const { rows } = await db.query<{ triggered_at: string }>(
      `SELECT triggered_at FROM activity_log`,
    )
    const ageMs = Date.now() - new Date(rows[0].triggered_at).getTime()
    expect(ageMs).toBeLessThan(5000)
    expect(ageMs).toBeGreaterThanOrEqual(0)
  })

  it('has an index on (location_id, contact_id, triggered_at DESC)', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'activity_log'
    `)
    const defs = rows.map((r) => r.indexdef).join('\n')
    expect(defs).toMatch(/\(location_id,\s*contact_id,\s*triggered_at DESC\)/)
  })

  it('has an index on (location_id, triggered_at DESC) for admin history reads', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'activity_log'
    `)
    const defs = rows.map((r) => r.indexdef).join('\n')
    expect(defs).toMatch(/\(location_id,\s*triggered_at DESC\)/)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
npm test
```

Expected: the 8 new `activity_log` tests FAIL with "relation \"activity_log\" does not exist". All prior tests pass.

- [ ] **Step 3: Append to the migration**

APPEND to the END of `supabase/migrations/0001_init.sql`:

```sql

-- Enrollment activity log. Append-only.
CREATE TABLE activity_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id            text NOT NULL,
  contact_id             text NOT NULL,
  contact_name           text,
  button_label           text NOT NULL,
  workflow_id            text NOT NULL,
  workflow_name          text NOT NULL,
  triggered_by_user_id   text NOT NULL,
  triggered_by_user_name text NOT NULL,
  status                 text NOT NULL,
  error_message          text,
  triggered_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_log_status_valid CHECK (status IN ('success', 'error'))
);

CREATE INDEX activity_log_widget_idx
  ON activity_log (location_id, contact_id, triggered_at DESC);

CREATE INDEX activity_log_admin_idx
  ON activity_log (location_id, triggered_at DESC);
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
npm test
```

Expected: 32 passed (24 prior + 8 activity_log).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql test/db/activity-log.test.ts
git commit -m "feat(db): add activity_log table with success/error constraint

Append-only enrollment log. Captures who triggered which button
on which contact and whether the GHL enrollment succeeded. Two
indexes for the widget's per-contact tail query and the admin's
per-location history scan."
```

---

## Task 5: rate_limits table

**Files:**
- Modify: `supabase/migrations/0001_init.sql` (append)
- Create: `test/db/rate-limits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/db/rate-limits.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

describe('rate_limits table', () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  it('exists with the expected columns', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'rate_limits'
      ORDER BY ordinal_position
    `)
    expect(rows.map((r) => r.column_name)).toEqual([
      'location_id',
      'user_id',
      'window_start',
      'count',
    ])
  })

  it('uses (location_id, user_id, window_start) as the primary key', async () => {
    db = await createTestDb()
    const { rows } = await db.query<{ column_name: string }>(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        USING (constraint_schema, constraint_name)
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'rate_limits'
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `)
    expect(rows.map((r) => r.column_name)).toEqual([
      'location_id',
      'user_id',
      'window_start',
    ])
  })

  it('defaults count to 1', async () => {
    db = await createTestDb()
    await db.exec(`
      INSERT INTO rate_limits (location_id, user_id, window_start)
      VALUES ('loc_1', 'usr_1', now())
    `)
    const { rows } = await db.query<{ count: number }>(
      `SELECT count FROM rate_limits`,
    )
    expect(rows[0].count).toBe(1)
  })

  it('rejects a duplicate (location_id, user_id, window_start) insert', async () => {
    db = await createTestDb()
    const window = "date_trunc('minute', now())"
    await db.exec(`
      INSERT INTO rate_limits (location_id, user_id, window_start)
      VALUES ('loc_1', 'usr_1', ${window})
    `)
    await expect(
      db.exec(`
        INSERT INTO rate_limits (location_id, user_id, window_start)
        VALUES ('loc_1', 'usr_1', ${window})
      `),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
npm test
```

Expected: the 4 new `rate_limits` tests FAIL with "relation \"rate_limits\" does not exist".

- [ ] **Step 3: Append to the migration**

APPEND to the END of `supabase/migrations/0001_init.sql`:

```sql

-- Per-user-per-location rate limit buckets, one row per minute.
CREATE TABLE rate_limits (
  location_id  text NOT NULL,
  user_id      text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 1,
  PRIMARY KEY (location_id, user_id, window_start)
);
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
npm test
```

Expected: 36 passed (32 prior + 4 rate_limits).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql test/db/rate-limits.test.ts
git commit -m "feat(db): add rate_limits table for per-user enrollment buckets

Composite PK on (location_id, user_id, window_start). Each row
is one minute's worth of enroll attempts for one user. The
rate_limit_check() function in the next task drives upserts
against this table."
```

---

## Task 6: rate_limit_check() function

**Files:**
- Modify: `supabase/migrations/0001_init.sql` (append)
- Create: `test/db/rate-limit-check.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/db/rate-limit-check.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from './setup'

describe('rate_limit_check() function', () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | null = null

  afterEach(async () => {
    if (db) {
      await db.close()
      db = null
    }
  })

  async function check(
    locationId: string,
    userId: string,
    max: number,
  ): Promise<boolean> {
    const { rows } = await db!.query<{ allowed: boolean }>(
      `SELECT rate_limit_check($1, $2, $3) AS allowed`,
      [locationId, userId, max],
    )
    return rows[0].allowed
  }

  it('returns true on the first call within an empty window', async () => {
    db = await createTestDb()
    expect(await check('loc_1', 'usr_1', 10)).toBe(true)
  })

  it('returns true on the 10th call when max=10', async () => {
    db = await createTestDb()
    for (let i = 0; i < 9; i++) {
      await check('loc_1', 'usr_1', 10)
    }
    expect(await check('loc_1', 'usr_1', 10)).toBe(true)
  })

  it('returns false on the 11th call when max=10', async () => {
    db = await createTestDb()
    for (let i = 0; i < 10; i++) {
      await check('loc_1', 'usr_1', 10)
    }
    expect(await check('loc_1', 'usr_1', 10)).toBe(false)
  })

  it('keeps separate buckets per user_id', async () => {
    db = await createTestDb()
    for (let i = 0; i < 10; i++) {
      await check('loc_1', 'usr_1', 10)
    }
    expect(await check('loc_1', 'usr_2', 10)).toBe(true)
  })

  it('keeps separate buckets per location_id', async () => {
    db = await createTestDb()
    for (let i = 0; i < 10; i++) {
      await check('loc_1', 'usr_1', 10)
    }
    expect(await check('loc_2', 'usr_1', 10)).toBe(true)
  })

  it('ignores rows from a prior minute window', async () => {
    db = await createTestDb()
    // Simulate a fully-saturated bucket from two minutes ago.
    await db.exec(`
      INSERT INTO rate_limits (location_id, user_id, window_start, count)
      VALUES ('loc_1', 'usr_1', date_trunc('minute', now()) - interval '2 minutes', 999)
    `)
    expect(await check('loc_1', 'usr_1', 10)).toBe(true)
  })

  it('increments the count column on successive calls', async () => {
    db = await createTestDb()
    await check('loc_1', 'usr_1', 10)
    await check('loc_1', 'usr_1', 10)
    await check('loc_1', 'usr_1', 10)
    const { rows } = await db.query<{ count: number }>(`
      SELECT count FROM rate_limits
      WHERE location_id = 'loc_1' AND user_id = 'usr_1'
        AND window_start = date_trunc('minute', now())
    `)
    expect(rows[0].count).toBe(3)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
npm test
```

Expected: the 7 new tests FAIL with `function rate_limit_check(text, text, integer) does not exist` or similar.

- [ ] **Step 3: Append to the migration**

APPEND to the END of `supabase/migrations/0001_init.sql`:

```sql

-- Atomic upsert + read for rate limiting. Returns true if the call is allowed
-- (i.e., the new count is <= max). The same call also increments the bucket,
-- so a single SELECT rate_limit_check(...) does both the spend and the check.
CREATE OR REPLACE FUNCTION rate_limit_check(
  p_location_id  text,
  p_user_id      text,
  p_max_per_min  integer
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  current_window timestamptz := date_trunc('minute', now());
  new_count      integer;
BEGIN
  INSERT INTO rate_limits (location_id, user_id, window_start, count)
  VALUES (p_location_id, p_user_id, current_window, 1)
  ON CONFLICT (location_id, user_id, window_start)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO new_count;

  RETURN new_count <= p_max_per_min;
END;
$$;
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
npm test
```

Expected: 43 passed (36 prior + 7 rate-limit-check).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql test/db/rate-limit-check.test.ts
git commit -m "feat(db): add rate_limit_check() function for /api/enroll

Atomic increment-and-check against the rate_limits table.
Returns true if the call is allowed. Per-(location_id, user_id)
bucket scoped to the current minute. Used by Phase 5's
/api/enroll route handler."
```

---

## Task 7: Final verification + phase-1-complete tag

**Files:**
- Delete: `test/db/harness.test.ts` (the verification test from Task 1 has served its purpose; the migration tests now exercise the harness)
- No other code changes; this task is verification + tagging + documenting the apply-to-Supabase procedure.

- [ ] **Step 1: Remove the temporary harness verification test**

The harness is now exercised by every `test/db/*.test.ts` file via `createTestDb()`. The standalone `harness.test.ts` is no longer needed.

```bash
git rm test/db/harness.test.ts
```

- [ ] **Step 2: Full test run**

Run:
```bash
npm test
```

Expected output:
```
 Test Files  8 passed (8)
      Tests  41 passed (41)
```

Breakdown:
- 3 Phase 0 sample test files (sum, Greeting, fetcher) → 9 tests
- 5 Phase 1 DB test files (ghl-tokens, buttons, activity-log, rate-limits, rate-limit-check) → 32 tests
- Total: 8 files, 41 tests. Zero failures, zero skips.

If the numbers don't match, STOP and investigate.

- [ ] **Step 3: Lint check**

Run:
```bash
npm run lint
```

Expected: clean.

- [ ] **Step 4: Build check**

Run:
```bash
npm run build
```

Expected: build succeeds. None of the new files under `test/db/` or `supabase/migrations/` should affect the Next.js bundle.

- [ ] **Step 5: Verify the migration file is well-formed**

Run:
```bash
node -e "console.log(require('node:fs').readFileSync('supabase/migrations/0001_init.sql', 'utf8').length, 'bytes')"
```

Expected: a number around 2000–3500. The file should not be empty and should not be enormous.

- [ ] **Step 6: Commit the cleanup**

```bash
git add -A
git commit -m "test: remove temporary Phase 1 harness verification test

The harness is now exercised by every test/db/*.test.ts via
createTestDb(). The standalone harness.test.ts has served its
purpose and is removed to keep the test surface minimal."
```

- [ ] **Step 7: Tag Phase 1 complete**

```bash
git tag phase-1-complete
```

- [ ] **Step 8: Document the apply-to-Supabase procedure (no code change — read and verify)**

This step does NOT modify any file. It documents the two-path apply procedure the user can run AFTER reviewing the phase. Print this to the report so the user has it on hand.

**Path A: Supabase CLI (recommended if a CLI is installed and a project is linked)**

```bash
supabase db push
# or, more conservatively:
supabase migration up --linked
```

**Path B: Supabase MCP (if no CLI is set up — applies to the remote project directly)**

Read the contents of `supabase/migrations/0001_init.sql` and invoke the `apply_migration` MCP tool with `name: "0001_init"` and `query: <file contents>`. Verify with `list_tables` and `get_advisors` after.

**Either path:** apply is a one-way operation against the user's actual database. **Do not apply automatically — wait for the user's explicit say-so**, and confirm the target project_id matches what they expect before invoking `apply_migration`.

---

## Verification checklist for the executor

Before marking Phase 1 complete, all of these must be true:

- [ ] `npm test` exits 0 with 41 tests across 8 files
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `supabase/migrations/0001_init.sql` exists at the repo root, contains the four tables + `set_updated_at()` + `rate_limit_check()` + triggers + indexes
- [ ] `test/db/setup.ts` exports `createPgLite` and `createTestDb`
- [ ] `test/db/{ghl-tokens,buttons,activity-log,rate-limits,rate-limit-check}.test.ts` all exist
- [ ] `test/db/harness.test.ts` has been removed
- [ ] `package.json` devDependencies includes `@electric-sql/pglite`
- [ ] Tag `phase-1-complete` exists
- [ ] `git status` is clean
- [ ] No file under `app/` has been modified
- [ ] No file under `test/examples/` has been modified
- [ ] The migration has NOT been applied to the user's remote Supabase project (that's a separate user-gated step)

If any check fails, the phase is NOT done.

---

## What's NOT in Phase 1 (deferred to later phases)

- **Applying the migration to remote Supabase.** Task 7 Step 8 documents the procedure; the user runs it manually.
- **A Supabase client wrapper for application code.** That comes in Phase 3 (`lib/supabase.ts`).
- **A Supabase test fixture for route-handler tests.** Phase 2+ will introduce a separate harness that points the service-role client at a test Supabase project (or, optionally, at PGlite via a connection-string adapter — to be decided in Phase 2).
- **Encryption-at-rest for access_token / refresh_token.** Deferred to v2 (spec §14).
- **RLS policies.** Off for v1 (spec §6).
- **Activity log retention / pruning.** Deferred to v2 (spec §14).
