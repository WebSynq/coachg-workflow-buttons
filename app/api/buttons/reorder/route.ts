import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { withAdminSso } from '@/lib/auth'
import { buttonReorderSchema } from '@/lib/validation'

export const POST = withAdminSso(async (req: NextRequest, sso) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const parsed = buttonReorderSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const items = parsed.data.items

  // Validate every id belongs to the verified tenant BEFORE any UPDATE runs.
  // If any id is foreign (cross-tenant) or unknown, abort with 400 and don't
  // mutate anything. This replaces a per-row UPDATE-in-tx pattern that
  // wouldn't be atomic through the postgres connection pool.
  const ids = items.map(i => i.id)
  const db = getDb()
  const { rows: validRows } = await db.query<{ id: string }>(
    `SELECT id FROM buttons WHERE id = ANY($1::uuid[]) AND location_id = $2`,
    [ids, sso.locationId],
  )
  if (validRows.length !== items.length) {
    return Response.json({ error: 'invalid id' }, { status: 400 })
  }

  // Single-statement UPDATE: atomic by definition, no transaction needed.
  const valuesParts: string[] = []
  const params: unknown[] = []
  let p = 1
  for (const item of items) {
    valuesParts.push(`($${p++}::uuid, $${p++}::int)`)
    params.push(item.id, item.sortOrder)
  }
  params.push(sso.locationId)
  await db.query(
    `UPDATE buttons SET sort_order = src.sort_order
     FROM (VALUES ${valuesParts.join(', ')}) AS src(id, sort_order)
     WHERE buttons.id = src.id AND buttons.location_id = $${p}`,
    params,
  )

  return Response.json({ ok: true })
})
