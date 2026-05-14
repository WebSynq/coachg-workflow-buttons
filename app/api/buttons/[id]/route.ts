import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { withAdminSso } from '@/lib/auth'
import { buttonUpdateSchema } from '@/lib/validation'

interface ButtonRow {
  id: string
  label: string
  color: string
  workflow_id: string
  workflow_name: string
  sort_order: number
  sends_soa: boolean
}

function rowToJson(r: ButtonRow) {
  return {
    id: r.id,
    label: r.label,
    color: r.color,
    workflowId: r.workflow_id,
    workflowName: r.workflow_name,
    sortOrder: r.sort_order,
    sendsSoa: r.sends_soa,
  }
}

type RouteCtx = { params: Promise<{ id: string }> }

export const PUT = withAdminSso<[RouteCtx]>(async (req: NextRequest, sso, ctx) => {
  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const parsed = buttonUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const input = parsed.data

  const { rows } = await getDb().query<ButtonRow>(
    `UPDATE buttons
       SET label = $3, color = $4, workflow_id = $5, workflow_name = $6, sends_soa = $7
     WHERE id = $1 AND location_id = $2
     RETURNING id, label, color, workflow_id, workflow_name, sort_order, sends_soa`,
    [
      id,
      sso.locationId,
      input.label,
      input.color,
      input.workflowId,
      input.workflowName,
      input.sendsSoa,
    ],
  )
  if (rows.length === 0) return new Response('Not found', { status: 404 })
  return Response.json({ button: rowToJson(rows[0]) })
})

export const DELETE = withAdminSso<[RouteCtx]>(async (_req: NextRequest, sso, ctx) => {
  const { id } = await ctx.params
  const { rows } = await getDb().query<{ id: string }>(
    `DELETE FROM buttons WHERE id = $1 AND location_id = $2 RETURNING id`,
    [id, sso.locationId],
  )
  if (rows.length === 0) return new Response('Not found', { status: 404 })
  return new Response(null, { status: 204 })
})
