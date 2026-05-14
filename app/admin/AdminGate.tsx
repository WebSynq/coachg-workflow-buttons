'use client'
import type { ReactNode } from 'react'

interface AdminGateProps {
  role: string | null
  children: ReactNode
}

export function AdminGate({ role, children }: AdminGateProps) {
  if (role !== 'admin') {
    return (
      <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-md p-4">
        Insufficient permissions. Ask an account admin to grant you access to this
        configuration page.
      </p>
    )
  }
  return <>{children}</>
}
