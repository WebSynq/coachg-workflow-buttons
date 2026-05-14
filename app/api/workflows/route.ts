import { withSso } from '@/lib/auth'
import { getGhlClient } from '@/lib/ghl'

export const GET = withSso(async (_req, sso) => {
  try {
    const client = await getGhlClient(sso.locationId)
    const workflows = await client.workflows.list()
    return Response.json({ workflows })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'GHL error'
    return Response.json({ error: message }, { status: 502 })
  }
})
