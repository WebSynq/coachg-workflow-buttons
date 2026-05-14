import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { withSso, withAdminSso } from '@/lib/auth'
import { buttonCreateSchema } from '@/lib/validation'

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

export const GET = withSso(async (_req: NextRequest, sso) => {
  const { rows } = await getDb().query<ButtonRow>(
    `SELECT id, label, color, workflow_id, workflow_name, sort_order, sends_soa
     FROM buttons
     WHERE location_id = $1
     ORDER BY sort_order ASC`,
    [sso.locationId],
  )
  return Response.json({ buttons: rows.map(rowToJson) })
})

export const POST = withAdminSso(async (req: NextRequest, sso) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const parsed = buttonCreateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const input = parsed.data
  const { rows } = await getDb().query<ButtonRow>(
    `INSERT INTO buttons (location_id, label, color, workflow_id, workflow_name, sort_order, sends_soa)
     SELECT $1, $2, $3, $4, $5, COALESCE((SELECT MAX(sort_order) + 1 FROM buttons WHERE location_id = $1), 0), $6
     RETURNING id, label, color, workflow_id, workflow_name, sort_order, sends_soa`,
    [
      sso.locationId,
      input.label,
      input.color,
      input.workflowId,
      input.workflowName,
      input.sendsSoa,
    ],
  )
  return Response.json({ button: rowToJson(rows[0]) }, { status: 201 })
})
