'use client'
import { useState } from 'react'
import type { Button } from '../widget/types'

export const COLOR_PRESETS = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#14B8A6',
  '#3B82F6',
  '#6366F1',
  '#A855F7',
  '#EC4899',
  '#6B7280',
] as const

export interface ButtonFormPayload {
  label: string
  color: string
  workflowId: string
  workflowName: string
  sendsSoa: boolean
}

interface WorkflowOption {
  id: string
  name: string
}

interface ButtonFormModalProps {
  open: boolean
  initial: Button | null
  workflows: WorkflowOption[]
  busy: boolean
  onSave: (payload: ButtonFormPayload) => void
  onCancel: () => void
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

export function ButtonFormModal({
  open,
  initial,
  workflows,
  busy,
  onSave,
  onCancel,
}: ButtonFormModalProps) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [color, setColor] = useState(initial?.color ?? COLOR_PRESETS[0])
  const [workflowId, setWorkflowId] = useState(initial?.workflowId ?? '')
  const [sendsSoa, setSendsSoa] = useState(initial?.sendsSoa ?? true)

  if (!open) return null

  const labelOk = label.trim().length > 0 && label.length <= 50
  const colorOk = HEX_RE.test(color)
  const workflowOk = workflowId.length > 0 && workflows.some(w => w.id === workflowId)
  const canSave = labelOk && colorOk && workflowOk && !busy

  function handleSave() {
    const wf = workflows.find(w => w.id === workflowId)
    if (!wf || !canSave) return
    onSave({
      label: label.trim(),
      color,
      workflowId: wf.id,
      workflowName: wf.name,
      sendsSoa,
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl space-y-4">
        <h2 className="text-base font-semibold text-gray-900">
          {initial ? 'Edit Button' : 'Add Button'}
        </h2>

        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Label</span>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            maxLength={50}
            className="block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>

        <div>
          <span className="block text-xs font-medium text-gray-700 mb-1">Color</span>
          <div className="flex gap-2 flex-wrap mb-2">
            {COLOR_PRESETS.map(c => (
              <button
                key={c}
                type="button"
                data-testid="preset-swatch"
                onClick={() => setColor(c)}
                aria-label={`Set color ${c}`}
                style={{ backgroundColor: c }}
                className={`h-7 w-7 rounded border ${
                  color === c ? 'ring-2 ring-offset-1 ring-blue-500' : 'border-gray-300'
                }`}
              />
            ))}
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Hex</span>
            <input
              type="text"
              value={color}
              onChange={e => setColor(e.target.value)}
              className="block w-32 rounded-md border border-gray-300 px-2 py-1 text-sm font-mono"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Workflow</span>
          <select
            value={workflowId}
            onChange={e => setWorkflowId(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="">— Choose a workflow —</option>
            {workflows.map(w => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={sendsSoa}
            onChange={e => setSendsSoa(e.target.checked)}
          />
          <span className="text-sm text-gray-700">
            Sends SOA (stamps activity log with SOA-sent date on success)
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
