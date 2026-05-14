import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { withSso } from '@/lib/auth'
import { logQuerySchema } from '@/lib/validation'

interface ActivityRow {
  id: string
  contact_id: string
  contact_name: string | null
  button_label: string
  workflow_id: string
  workflow_name: string
  triggered_by_user_id: string
  triggered_by_user_name: string
  status: string
  error_message: string | null
  triggered_at: string
  soa_sent_at: string | null
}

function entryToJson(r: ActivityRow) {
  return {
    id: r.id,
    contactId: r.contact_id,
    contactName: r.contact_name,
    buttonLabel: r.button_label,
    workflowId: r.workflow_id,
    workflowName: r.workflow_name,
    triggeredByUserId: r.triggered_by_user_id,
    triggeredByUserName: r.triggered_by_user_name,
    status: r.status,
    errorMessage: r.error_message,
    triggeredAt: r.triggered_at,
    soaSentAt: r.soa_sent_at,
  }
}

const SELECT_COLS =
  `id, contact_id, contact_name, button_label, workflow_id, workflow_name,
   triggered_by_user_id, triggered_by_user_name, status, error_message,
   triggered_at, soa_sent_at`

export const GET = withSso(async (req: NextRequest, sso) => {
  const url = new URL(req.url)
  const raw = Object.fromEntries(url.searchParams.entries())
  const parsed = logQuerySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const q = parsed.data
  const db = getDb()

  if (q.contactId) {
    const { rows } = await db.query<ActivityRow>(
      `SELECT ${SELECT_COLS} FROM activity_log
       WHERE location_id = $1 AND contact_id = $2
       ORDER BY triggered_at DESC
       LIMIT 5`,
      [sso.locationId, q.contactId],
    )
    // lastSoaSentAt is read separately so the widget surfaces an SOA
    // date even when the most-recent SOA-bearing enrollment is older
    // than the 5-row entries window.
    const { rows: soaRows } = await db.query<{ last_soa_sent_at: string | null }>(
      `SELECT max(soa_sent_at) AS last_soa_sent_at FROM activity_log
       WHERE location_id = $1 AND contact_id = $2 AND soa_sent_at IS NOT NULL`,
      [sso.locationId, q.contactId],
    )
    return Response.json({
      entries: rows.map(entryToJson),
      lastSoaSentAt: soaRows[0]?.last_soa_sent_at ?? null,
    })
  }

  const { rows } = await db.query<ActivityRow>(
    `SELECT ${SELECT_COLS} FROM activity_log
     WHERE location_id = $1
     ORDER BY triggered_at DESC
     LIMIT $2 OFFSET $3`,
    [sso.locationId, q.limit, q.offset],
  )
  const { rows: countRows } = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM activity_log WHERE location_id = $1`,
    [sso.locationId],
  )
  return Response.json({
    entries: rows.map(entryToJson),
    total: parseInt(countRows[0].total, 10),
    limit: q.limit,
    offset: q.offset,
  })
})
