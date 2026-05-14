'use client'

interface ConfirmModalProps {
  open: boolean
  contactName: string
  workflowName: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  contactName,
  workflowName,
  busy,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <p className="text-base text-gray-900">
          Enroll <span className="font-semibold">{contactName}</span> in{' '}
          <span className="font-semibold">{workflowName}</span>?
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Enrolling…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
