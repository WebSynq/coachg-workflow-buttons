'use client'
import type { Button } from '../widget/types'

interface ButtonTableProps {
  buttons: Button[]
  onReorder: (next: Button[]) => void
  onEdit: (button: Button) => void
  onDelete: (button: Button) => void
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = arr.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

export function ButtonTable({ buttons, onReorder, onEdit, onDelete }: ButtonTableProps) {
  if (buttons.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">
        No buttons yet. Click &quot;Add Button&quot; to create one.
      </p>
    )
  }

  return (
    <table className="w-full text-sm">
      <tbody>
        {buttons.map((b, idx) => {
          const isFirst = idx === 0
          const isLast = idx === buttons.length - 1
          return (
            <tr key={b.id} className="border-b border-gray-200">
              <td className="py-2 pr-2 w-8">
                <span
                  data-testid="color-swatch"
                  className="inline-block h-5 w-5 rounded border border-gray-300"
                  style={{ backgroundColor: b.color }}
                />
              </td>
              <td className="py-2 pr-2 font-medium text-gray-900">{b.label}</td>
              <td className="py-2 pr-2 text-gray-600">{b.workflowName}</td>
              <td className="py-2 pr-2 w-32 text-right">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={isFirst}
                  onClick={() => onReorder(swap(buttons, idx, idx - 1))}
                  className="px-2 py-1 text-gray-600 hover:text-gray-900 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={isLast}
                  onClick={() => onReorder(swap(buttons, idx, idx + 1))}
                  className="px-2 py-1 text-gray-600 hover:text-gray-900 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="Edit"
                  onClick={() => onEdit(b)}
                  className="px-2 py-1 text-blue-700 hover:text-blue-900"
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  onClick={() => onDelete(b)}
                  className="px-2 py-1 text-red-700 hover:text-red-900"
                >
                  Delete
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
