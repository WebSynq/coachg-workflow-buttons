'use client'
import { useEffect, useState } from 'react'
import { useSso } from './useSso'
import { apiFetch } from './apiFetch'
import { ButtonGrid } from './ButtonGrid'
import { ConfirmModal } from './ConfirmModal'
import { ActivityPanel } from './ActivityPanel'
import { Toast, type ToastValue } from './Toast'
import type { Button, LogEntry, WidgetData } from './types'

interface WidgetProps {
  contactId: string
  contactName: string
}

function formatSoaDate(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().slice(0, 10)
}

export function Widget({ contactId, contactName }: WidgetProps) {
  const token = useSso()
  const [data, setData] = useState<WidgetData | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [pending, setPending] = useState<Button | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<ToastValue | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const [b, l] = await Promise.all([
          apiFetch<{ buttons: Button[] }>(token, '/api/buttons'),
          apiFetch<{ entries: LogEntry[]; lastSoaSentAt: string | null }>(
            token,
            `/api/log?contactId=${encodeURIComponent(contactId)}`,
          ),
        ])
        if (cancelled) return
        setData({
          buttons: b.buttons,
          entries: l.entries,
          lastSoaSentAt: l.lastSoaSentAt,
        })
      } catch (e) {
        if (cancelled) return
        setLoadErr(e instanceof Error ? e.message : 'load failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, contactId])

  async function confirmEnroll() {
    if (!token || !pending || !data) return
    setBusy(true)
    try {
      const res = await fetch('/api/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GHL-SSO': token },
        body: JSON.stringify({
          buttonId: pending.id,
          contactId,
          contactName,
        }),
      })
      const payload = (await res.json()) as { ok: boolean; entry: LogEntry }
      // The server returns an entry on both success AND failure
      // (the failure path still writes an activity_log row).
      setData(d =>
        d
          ? {
              buttons: d.buttons,
              entries: [payload.entry, ...d.entries].slice(0, 5),
              lastSoaSentAt: payload.entry.soaSentAt ?? d.lastSoaSentAt,
            }
          : d,
      )
      setToast({
        kind: payload.ok ? 'success' : 'error',
        message: payload.ok
          ? `Enrolled in ${pending.workflowName}`
          : `Enrollment failed: ${payload.entry?.errorMessage ?? 'unknown error'}`,
      })
    } catch (e) {
      setToast({
        kind: 'error',
        message: e instanceof Error ? e.message : 'request failed',
      })
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  if (!token || (!data && !loadErr)) {
    return <p className="text-sm text-gray-500">Loading…</p>
  }
  if (loadErr) {
    return <p className="text-sm text-red-600">Failed to load: {loadErr}</p>
  }
  // data is non-null here
  return (
    <div className="space-y-4">
      <ButtonGrid buttons={data!.buttons} onClick={setPending} />
      <p className="text-xs text-gray-600">
        SOA last sent: <span className="font-medium">{formatSoaDate(data!.lastSoaSentAt)}</span>
      </p>
      <section>
        <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-1">
          Recent activity
        </h2>
        <ActivityPanel entries={data!.entries} />
      </section>
      <ConfirmModal
        open={pending !== null}
        contactName={contactName}
        workflowName={pending?.workflowName ?? ''}
        busy={busy}
        onConfirm={confirmEnroll}
        onCancel={() => setPending(null)}
      />
      <Toast toast={toast} />
    </div>
  )
}
