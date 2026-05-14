// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AdminGate } from './AdminGate'

describe('AdminGate', () => {
  it('renders children when role is admin', () => {
    render(
      <AdminGate role="admin">
        <p>admin only content</p>
      </AdminGate>,
    )
    expect(screen.getByText('admin only content')).toBeInTheDocument()
    expect(screen.queryByText(/insufficient permissions/i)).not.toBeInTheDocument()
  })

  it('renders the "Insufficient permissions" message when role is not admin', () => {
    render(
      <AdminGate role="user">
        <p>admin only content</p>
      </AdminGate>,
    )
    expect(screen.getByText(/insufficient permissions/i)).toBeInTheDocument()
    expect(screen.queryByText('admin only content')).not.toBeInTheDocument()
  })

  it('renders the gate when role is null (no token yet)', () => {
    render(
      <AdminGate role={null}>
        <p>admin only content</p>
      </AdminGate>,
    )
    expect(screen.getByText(/insufficient permissions/i)).toBeInTheDocument()
  })
})
