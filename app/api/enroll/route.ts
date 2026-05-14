import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { withSso } from '@/lib/auth'
import { enrollSchema } from '@/lib/validation'
import { checkRateLimit } from '@/lib/rate-limit'
import { getGhlClient } from '@/lib/ghl'

interface ButtonRow {
  workflow_id: string
  workflow_name: string
  label: string
  sends_soa: boolean
}

interface ActivityRow {
  id: string
  location_id: string
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

export const POST = withSso(async (req: NextRequest, sso) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const parsed = enrollSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'validation', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const input = parsed.data

  const allowed = await checkRateLimit(sso.locationId, sso.userId)
  if (!allowed) return Response.json({ error: 'rate_limit' }, { status: 429 })

  const db = getDb()
  const { rows: btnRows } = await db.query<ButtonRow>(
    `SELECT workflow_id, workflow_name, label, sends_soa
     FROM buttons WHERE id = $1 AND location_id = $2`,
    [input.buttonId, sso.locationId],
  )
  if (btnRows.length === 0) {
    return Response.json({ error: 'button not found' }, { status: 404 })
  }
  const btn = btnRows[0]

  let status: 'success' | 'error' = 'success'
  let errorMessage: string | null = null
  try {
    const client = await getGhlClient(sso.locationId)
    await client.contact.enroll(btn.workflow_id, input.contactId)
  } catch (e) {
    status = 'error'
    errorMessage = e instanceof Error ? e.message : 'GHL error'
  }

  // Compliance paper trail: only stamp soa_sent_at when the workflow
  // succeeded AND the button is marked as SOA-bearing. Delivery
  // confirmation (webhook from GHL after the actual PDF send) is
  // deferred to v2 — for v1 the 200 from the enroll endpoint is the
  // strongest evidence we have.
  const soaSentAt =
    status === 'success' && btn.sends_soa ? new Date().toISOString() : null

  const { rows: logRows } = await db.query<ActivityRow>(
    `INSERT INTO activity_log
       (location_id, contact_id, contact_name, button_label, workflow_id, workflow_name,
        triggered_by_user_id, triggered_by_user_name, status, error_message, soa_sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      sso.locationId,
      input.contactId,
      input.contactName ?? null,
      btn.label,
      btn.workflow_id,
      btn.workflow_name,
      sso.userId,
      // GHL SSO payload (verifySso shape) does not promise a human name
      // yet; record the userId so the row is still queryable. Revisit
      // when the SSO contract gains a `name` field.
      sso.userId,
      status,
      errorMessage,
      soaSentAt,
    ],
  )

  return Response.json(
    { ok: status === 'success', entry: entryToJson(logRows[0]) },
    { status: status === 'success' ? 200 : 502 },
  )
})
