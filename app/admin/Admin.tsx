'use client'
import { useMemo, useState } from 'react'
import { useSso } from '../widget/useSso'
import { Toast, type ToastValue } from '../widget/Toast'
import { decodeJwtClaims } from './decodeJwt'
import { ButtonsTab } from './ButtonsTab'
import { ActivityLogTab } from './ActivityLogTab'

type Tab = 'buttons' | 'log'

export function Admin() {
  const token = useSso()
  const [tab, setTab] = useState<Tab>('buttons')
  const [toast, setToast] = useState<ToastValue | null>(null)

  // Client-side role read is for UX only. The server enforces admin role
  // on every mutation via `withAdminSso`. A tampered token won't get past
  // HS256 verification on the server.
  const role = useMemo(
    () => (token ? (decodeJwtClaims(token)?.role ?? null) : null),
    [token],
  )

  function onError(message: string) {
    setToast({ kind: 'error', message })
  }

  if (!token) {
    return <p className="text-sm text-gray-500">Loading…</p>
  }

  if (role !== 'admin') {
    return (
      <p
        data-testid="admin-gate"
        role="alert"
        className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      >
        Insufficient permissions. Admin role required to access this page.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">
          Workflow Buttons — Configuration
        </h1>
      </header>

      <nav role="tablist" className="flex border-b border-gray-200">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'buttons'}
          onClick={() => setTab('buttons')}
          className={
            'px-4 py-2 text-sm transition-colors ' +
            (tab === 'buttons'
              ? 'border-b-2 border-blue-600 font-medium text-blue-700'
              : 'text-gray-600 hover:text-gray-800')
          }
        >
          Buttons
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'log'}
          onClick={() => setTab('log')}
          className={
            'px-4 py-2 text-sm transition-colors ' +
            (tab === 'log'
              ? 'border-b-2 border-blue-600 font-medium text-blue-700'
              : 'text-gray-600 hover:text-gray-800')
          }
        >
          Activity Log
        </button>
      </nav>

      <section role="tabpanel">
        {tab === 'buttons' ? (
          <ButtonsTab token={token} onError={onError} />
        ) : (
          <ActivityLogTab token={token} onError={onError} />
        )}
      </section>

      <Toast toast={toast} />
    </div>
  )
}
