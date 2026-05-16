'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '../widget/apiFetch'
import type { LogEntry } from '../widget/types'

interface ActivityLogTabProps {
  token: string
  onError: (msg: string) => void
}

interface LogResponse {
  entries: LogEntry[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 20

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function ActivityLogTab({ token, onError }: ActivityLogTabProps) {
  const [data, setData] = useState<LogResponse | null>(null)
  const [offset, setOffset] = useState(0)

  // Same async-IIFE-in-effect pattern as Widget.tsx, so we never call
  // setState synchronously inside the effect body. `data === null` is the
  // initial-loading sentinel; subsequent page changes keep prior data
  // visible until the next request resolves (light, jitter-free pagination).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch<LogResponse>(
          token,
          `/api/log?limit=${PAGE_SIZE}&offset=${offset}`,
        )
        if (cancelled) return
        setData(res)
      } catch (e) {
        if (cancelled) return
        onError(e instanceof Error ? e.message : 'Failed to load log')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, offset, onError])

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>

  const hasNext = offset + PAGE_SIZE < data.total
  const hasPrev = offset > 0

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Activity Log</h2>

      {data.entries.length === 0 ? (
        <p className="text-sm text-gray-500">No activity yet.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-2">When</th>
              <th className="py-2 pr-2">Contact</th>
              <th className="py-2 pr-2">Button</th>
              <th className="py-2 pr-2">By</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2">SOA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-900">
            {data.entries.map(entry => (
              <tr key={entry.id}>
                <td className="py-2 pr-2 whitespace-nowrap text-xs text-gray-600">
                  {formatTime(entry.triggeredAt)}
                </td>
                <td className="py-2 pr-2">{entry.contactName ?? entry.contactId}</td>
                <td className="py-2 pr-2">{entry.buttonLabel}</td>
                <td className="py-2 pr-2 text-gray-700">
                  {entry.triggeredByUserName}
                </td>
                <td className="py-2 pr-2">
                  {entry.status === 'success' ? (
                    <span
                      aria-label="success"
                      className="font-bold text-green-600"
                    >
                      ✓
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <span
                        aria-label="error"
                        className="font-bold text-red-600"
                      >
                        ✗
                      </span>
                      {entry.errorMessage && (
                        <span className="text-xs text-red-600">
                          {entry.errorMessage}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  {entry.soaSentAt ? (
                    <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                      SOA Sent
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>
          {data.total === 0
            ? '0 entries'
            : `${offset + 1}–${Math.min(offset + data.entries.length, data.total)} of ${data.total}`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 disabled:opacity-30"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => setOffset(o => o + PAGE_SIZE)}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
