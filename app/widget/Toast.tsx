'use client'

export interface ToastValue {
  kind: 'success' | 'error'
  message: string
}

interface ToastProps {
  toast: ToastValue | null
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null
  const colorClass =
    toast.kind === 'success'
      ? 'bg-green-100 text-green-900 border-green-300'
      : 'bg-red-100 text-red-900 border-red-300'
  return (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-50 rounded-md border px-4 py-2 text-sm shadow-md ${colorClass}`}
    >
      {toast.message}
    </div>
  )
}
