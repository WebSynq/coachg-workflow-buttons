'use client'
import { useState } from 'react'
import { ColorPicker } from './ColorPicker'
import type { AdminButton, Workflow, ButtonFormData } from './types'

interface ButtonModalProps {
  open: boolean
  mode: 'create' | 'edit'
  initial: AdminButton | null
  workflows: Workflow[]
  busy: boolean
  onSubmit: (data: ButtonFormData) => void
  onClose: () => void
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/
const DEFAULT_COLOR = '#3B82F6'

/**
 * Outer wrapper short-circuits when `open` is false so that
 * `ButtonModalContents` only mounts (and runs its `useState` initializers
 * with fresh prop values) when the modal actually opens. That sidesteps
 * the need for a sync setState-in-effect to reset/prefill form state.
 */
export function ButtonModal(props: ButtonModalProps) {
  if (!props.open) return null
  return <ButtonModalContents {...props} />
}

function ButtonModalContents({
  mode,
  initial,
  workflows,
  busy,
  onSubmit,
  onClose,
}: ButtonModalProps) {
  const isEdit = mode === 'edit' && initial !== null
  const [label, setLabel] = useState(isEdit ? initial!.label : '')
  const [color, setColor] = useState(isEdit ? initial!.color : DEFAULT_COLOR)
  const [workflowId, setWorkflowId] = useState(isEdit ? initial!.workflowId : '')
  const [sendsSoa, setSendsSoa] = useState(isEdit ? initial!.sendsSoa : true)
  const [err, setErr] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = label.trim()
    if (!trimmed) {
      setErr('Label is required')
      return
    }
    if (trimmed.length > 50) {
      setErr('Label must be 50 characters or less')
      return
    }
    if (!HEX_RE.test(color)) {
      setErr('Color must be a 6-digit hex like #FF0000')
      return
    }
    if (!workflowId) {
      setErr('Pick a workflow')
      return
    }
    const wf = workflows.find(w => w.id === workflowId)
    if (!wf) {
      setErr('Pick a workflow')
      return
    }
    onSubmit({
      label: trimmed,
      color: color.toUpperCase(),
      workflowId,
      workflowName: wf.name,
      sendsSoa,
    })
  }

  const heading = mode === 'create' ? 'Add button' : 'Edit button'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 text-gray-900 shadow-xl"
      >
        <h2 className="text-lg font-semibold">{heading}</h2>

        <label className="block">
          <span className="text-xs text-gray-700">Label (max 50 chars)</span>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            maxLength={50}
            aria-label="Label"
            className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          />
        </label>

        <div>
          <span className="text-xs text-gray-700">Color</span>
          <div className="mt-1">
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>

        <label className="block">
          <span className="text-xs text-gray-700">Workflow</span>
          <select
            value={workflowId}
            onChange={e => setWorkflowId(e.target.value)}
            aria-label="Workflow"
            className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">— Select a workflow —</option>
            {workflows.map(w => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={sendsSoa}
            onChange={e => setSendsSoa(e.target.checked)}
          />
          This button sends the SOA (record SOA timestamp on every click)
        </label>

        {err && (
          <p role="alert" className="text-xs text-red-600">
            {err}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
