'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSso } from '../widget/useSso'
import { apiFetch } from '../widget/apiFetch'
import { Toast, type ToastValue } from '../widget/Toast'
import type { Button, LogEntry } from '../widget/types'
import { decodeSsoForDisplay } from '@/lib/client-sso'
import { AdminGate } from './AdminGate'
import { Tabs } from './Tabs'
import { ButtonTable } from './ButtonTable'
import { ButtonFormModal, type ButtonFormPayload } from './ButtonFormModal'
import { ActivityTab } from './ActivityTab'

type TabKey = 'buttons' | 'activity'

interface WorkflowOption {
  id: string
  name: string
}

interface LogPage {
  entries: LogEntry[]
  total: number
  limit: number
  offset: number
}

const TABS = [
  { key: 'buttons', label: 'Buttons' },
  { key: 'activity', label: 'Activity Log' },
] as const

const PAGE_SIZE = 20

export function Admin() {
  const token = useSso()
  const role = useMemo(() => (token ? decodeSsoForDisplay(token)?.role ?? null : null), [token])
  const isAdmin = role === 'admin'

  const [buttons, setButtons] = useState<Button[] | null>(null)
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([])
  const [log, setLog] = useState<LogPage | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('buttons')
  const [editing, setEditing] = useState<Button | null | undefined>(undefined)
  // undefined = closed; null = create; Button = edit
  const [deletingTarget, setDeletingTarget] = useState<Button | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<ToastValue | null>(null)

  const refetchButtons = useCallback(async () => {
    if (!token) return
    const res = await apiFetch<{ buttons: Button[] }>(token, '/api/buttons')
    setButtons(res.buttons)
  }, [token])

  const refetchLog = useCallback(
    async (offset: number) => {
      if (!token) return
      const res = await apiFetch<LogPage>(
        token,
        `/api/log?limit=${PAGE_SIZE}&offset=${offset}`,
      )
      setLog(res)
    },
    [token],
  )

  useEffect(() => {
    if (!token || !isAdmin) return
    let cancelled = false
    ;(async () => {
      try {
        const [b, w, l] = await Promise.all([
          apiFetch<{ buttons: Button[] }>(token, '/api/buttons'),
          apiFetch<{ workflows: WorkflowOption[] }>(token, '/api/workflows'),
          apiFetch<LogPage>(token, `/api/log?limit=${PAGE_SIZE}&offset=0`),
        ])
        if (cancelled) return
        setButtons(b.buttons)
        setWorkflows(w.workflows)
        setLog(l)
      } catch (e) {
        if (cancelled) return
        setToast({
          kind: 'error',
          message: e instanceof Error ? e.message : 'load failed',
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, isAdmin])

  async function handleSave(payload: ButtonFormPayload) {
    if (!token) return
    setBusy(true)
    try {
      if (editing) {
        // edit mode
        await apiFetch(token, `/api/buttons/${encodeURIComponent(editing.id)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
        setToast({ kind: 'success', message: 'Button updated' })
      } else {
        await apiFetch(token, '/api/buttons', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setToast({ kind: 'success', message: 'Button created' })
      }
      setEditing(undefined)
      await refetchButtons()
    } catch (e) {
      setToast({
        kind: 'error',
        message: e instanceof Error ? e.message : 'save failed',
      })
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!token || !deletingTarget) return
    setBusy(true)
    try {
      await apiFetch(token, `/api/buttons/${encodeURIComponent(deletingTarget.id)}`, {
        method: 'DELETE',
      })
      setToast({ kind: 'success', message: 'Button deleted' })
      setDeletingTarget(null)
      await refetchButtons()
    } catch (e) {
      setToast({
        kind: 'error',
        message: e instanceof Error ? e.message : 'delete failed',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleReorder(next: Button[]) {
    if (!token) return
    // Optimistic UI — set the order locally first so arrows feel responsive.
    setButtons(next)
    const items = next.map((b, idx) => ({ id: b.id, sortOrder: idx }))
    try {
      await apiFetch(token, '/api/buttons/reorder', {
        method: 'POST',
        body: JSON.stringify({ items }),
      })
      // No refetch — the server applied the same order we just rendered.
    } catch (e) {
      setToast({
        kind: 'error',
        message: e instanceof Error ? e.message : 'reorder failed',
      })
      await refetchButtons()
    }
  }

  async function handleTabChange(key: TabKey) {
    setActiveTab(key)
    // Reset to page 1 and refetch when switching to the log tab so the
    // operator sees the freshest data.
    if (key === 'activity' && token && isAdmin) {
      await refetchLog(0)
    }
  }

  if (!token) {
    return <p className="text-sm text-gray-500">Loading…</p>
  }

  return (
    <AdminGate role={role}>
      <div className="space-y-4">
        <Tabs<TabKey> tabs={TABS} active={activeTab} onSelect={handleTabChange} />

        {activeTab === 'buttons' && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Add Button
            </button>
            {buttons === null ? (
              <p className="text-sm text-gray-500">Loading buttons…</p>
            ) : (
              <ButtonTable
                buttons={buttons}
                onReorder={handleReorder}
                onEdit={btn => setEditing(btn)}
                onDelete={btn => setDeletingTarget(btn)}
              />
            )}
          </div>
        )}

        {activeTab === 'activity' &&
          (log === null ? (
            <p className="text-sm text-gray-500">Loading activity…</p>
          ) : (
            <ActivityTab
              entries={log.entries}
              total={log.total}
              limit={log.limit}
              offset={log.offset}
              onPageChange={offset => {
                void refetchLog(offset)
              }}
            />
          ))}

        <ButtonFormModal
          // `key` forces a remount when the editing target changes, so
          // ButtonFormModal's `useState(initial?…)` initialisers re-read
          // the new props instead of keeping the stale first-mount state.
          key={editing === undefined ? 'closed' : editing === null ? 'create' : editing.id}
          open={editing !== undefined}
          initial={editing ?? null}
          workflows={workflows}
          busy={busy}
          onSave={handleSave}
          onCancel={() => setEditing(undefined)}
        />

        {deletingTarget && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
              <p className="text-base text-gray-900">
                Delete <span className="font-semibold">{deletingTarget.label}</span>?
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeletingTarget(null)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={busy}
                  className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        <Toast toast={toast} />
      </div>
    </AdminGate>
  )
}
