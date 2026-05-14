'use client'
import type { LogEntry } from '../widget/types'

interface ActivityTabProps {
  entries: LogEntry[]
  total: number
  limit: number
  offset: number
  onPageChange: (newOffset: number) => void
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function ActivityTab({ entries, total, limit, offset, onPageChange }: ActivityTabProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.floor(offset / limit) + 1
  const onFirstPage = offset === 0
  const onLastPage = offset + limit >= total

  return (
    <div>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">No activity yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200 text-sm">
          {entries.map(entry => (
            <li key={entry.id} className="py-2 flex items-start gap-3">
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
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-gray-900">{entry.buttonLabel}</span>
                  <span className="text-xs text-gray-500">{entry.workflowName}</span>
                </div>
                <div className="text-xs text-gray-600">
                  {entry.contactName ?? '(no contact name)'}
                </div>
                {entry.errorMessage && (
                  <div className="text-xs text-red-600">{entry.errorMessage}</div>
                )}
                <div className="text-xs text-gray-500">{formatTime(entry.triggeredAt)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between pt-3 text-xs text-gray-600">
        <span>
          Page {currentPage} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={onFirstPage}
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={onLastPage}
            onClick={() => onPageChange(offset + limit)}
            className="rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
