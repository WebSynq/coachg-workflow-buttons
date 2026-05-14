'use client'
import type { LogEntry } from './types'

interface ActivityPanelProps {
  entries: LogEntry[]
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function ActivityPanel({ entries }: ActivityPanelProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500 py-4">No activity yet.</p>
  }

  return (
    <ul className="divide-y divide-gray-200 text-sm">
      {entries.map(entry => (
        <li key={entry.id} className="py-2 flex items-start gap-2">
          <span
            aria-label={entry.status}
            className={
              entry.status === 'success'
                ? 'text-green-600 font-bold leading-5'
                : 'text-red-600 font-bold leading-5'
            }
          >
            {entry.status === 'success' ? '✓' : '✗'}
          </span>
          <div className="flex-1">
            <div className="text-gray-900">{entry.buttonLabel}</div>
            {entry.errorMessage && (
              <div className="text-xs text-red-600">{entry.errorMessage}</div>
            )}
            <div className="text-xs text-gray-500">{formatTime(entry.triggeredAt)}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}
