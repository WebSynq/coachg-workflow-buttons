'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '../widget/apiFetch'
import { ButtonModal } from './ButtonModal'
import type { AdminButton, Workflow, ButtonFormData } from './types'

interface ButtonsTabProps {
  token: string
  onError: (msg: string) => void
}

export function ButtonsTab({ token, onError }: ButtonsTabProps) {
  const [buttons, setButtons] = useState<AdminButton[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editing, setEditing] = useState<AdminButton | null>(null)
  const [busy, setBusy] = useState(false)

  // Following the Widget.tsx pattern: async IIFE inside useEffect with a
  // cancellation flag. This keeps setState off the synchronous effect body,
  // satisfies react-hooks/set-state-in-effect, and prevents a stale write
  // if the component unmounts mid-flight.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [b, w] = await Promise.all([
          apiFetch<{ buttons: AdminButton[] }>(token, '/api/buttons'),
          apiFetch<{ workflows: Workflow[] }>(token, '/api/workflows'),
        ])
        if (cancelled) return
        setButtons(b.buttons)
        setWorkflows(w.workflows)
      } catch (e) {
        if (cancelled) return
        onError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, onError, reloadKey])

  function refresh() {
    setReloadKey(k => k + 1)
  }

  function openAdd() {
    setModalMode('create')
    setEditing(null)
    setModalOpen(true)
  }

  function openEdit(b: AdminButton) {
    setModalMode('edit')
    setEditing(b)
    setModalOpen(true)
  }

  async function handleSubmit(data: ButtonFormData) {
    setBusy(true)
    try {
      if (modalMode === 'create') {
        await apiFetch(token, '/api/buttons', {
          method: 'POST',
          body: JSON.stringify(data),
        })
      } else if (editing) {
        await apiFetch(token, `/api/buttons/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        })
      }
      setModalOpen(false)
      refresh()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(b: AdminButton) {
    // window.confirm is good enough — the destructive action is uncommon
    // and the admin path is already gated behind GHL admin role.
    if (!window.confirm(`Delete "${b.label}"?`)) return
    try {
      await apiFetch(token, `/api/buttons/${b.id}`, { method: 'DELETE' })
      refresh()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function move(idx: number, dir: -1 | 1) {
    const target = idx + dir
    if (target < 0 || target >= buttons.length) return
    const reordered = [...buttons]
    ;[reordered[idx], reordered[target]] = [reordered[target], reordered[idx]]
    const items = reordered.map((b, i) => ({ id: b.id, sortOrder: i }))

    // Optimistic — flip local state immediately so the row visibly moves,
    // then send the POST. On failure refetch to restore truth.
    setButtons(reordered.map((b, i) => ({ ...b, sortOrder: i })))
    try {
      await apiFetch(token, '/api/buttons/reorder', {
        method: 'POST',
        body: JSON.stringify({ items }),
      })
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Reorder failed')
      refresh()
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Buttons</h2>
        <button
          type="button"
          onClick={openAdd}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add Button
        </button>
      </div>

      {buttons.length === 0 ? (
        <p className="text-sm text-gray-500">
          No buttons yet. Add one to get started.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-2">Label</th>
              <th className="py-2 pr-2">Color</th>
              <th className="py-2 pr-2">Workflow</th>
              <th className="py-2 pr-2">SOA</th>
              <th className="py-2 pr-2">Order</th>
              <th className="py-2 pr-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-900">
            {buttons.map((b, idx) => (
              <tr key={b.id}>
                <td className="py-2 pr-2 font-medium">{b.label}</td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  <span
                    aria-label={`Color ${b.color}`}
                    className="inline-block h-5 w-5 rounded-full border border-gray-200 align-middle"
                    style={{ backgroundColor: b.color }}
                  />
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    {b.color}
                  </span>
                </td>
                <td className="py-2 pr-2">{b.workflowName}</td>
                <td className="py-2 pr-2">
                  {b.sendsSoa ? (
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                      Yes
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500">No</span>
                  )}
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  <button
                    type="button"
                    aria-label={`Move ${b.label} up`}
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="px-1 text-gray-700 disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${b.label} down`}
                    onClick={() => move(idx, 1)}
                    disabled={idx === buttons.length - 1}
                    className="px-1 text-gray-700 disabled:opacity-30"
                  >
                    ▼
                  </button>
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => openEdit(b)}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(b)}
                    className="ml-1 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ButtonModal
        open={modalOpen}
        mode={modalMode}
        initial={editing}
        workflows={workflows}
        busy={busy}
        onSubmit={handleSubmit}
        onClose={() => setModalOpen(false)}
      />
    </div>
  )
}
