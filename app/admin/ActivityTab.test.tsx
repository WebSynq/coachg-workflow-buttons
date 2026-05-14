// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivityTab } from './ActivityTab'
import type { LogEntry } from '../widget/types'

const baseRow: Omit<LogEntry, 'id' | 'status' | 'errorMessage' | 'buttonLabel' | 'contactName'> = {
  contactId: 'c1',
  workflowId: 'wf1',
  workflowName: 'SOA Workflow',
  triggeredByUserId: 'u1',
  triggeredByUserName: 'u1',
  triggeredAt: '2026-05-12T18:30:00.000Z',
  soaSentAt: null,
}

const entries: LogEntry[] = [
  {
    ...baseRow,
    id: 'l1',
    status: 'success',
    errorMessage: null,
    buttonLabel: 'Send SOA',
    contactName: 'Jane Doe',
  },
  {
    ...baseRow,
    id: 'l2',
    status: 'error',
    errorMessage: 'workflow disabled',
    buttonLabel: 'Welcome',
    contactName: null,
  },
]

const noop = () => {}

describe('ActivityTab', () => {
  it('renders success and error rows with the right indicators + button/contact/workflow text', () => {
    render(
      <ActivityTab
        entries={entries}
        total={42}
        limit={20}
        offset={0}
        onPageChange={noop}
      />,
    )
    expect(screen.getByText('Send SOA')).toBeInTheDocument()
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('workflow disabled')).toBeInTheDocument()
    expect(screen.getByLabelText('success')).toBeInTheDocument()
    expect(screen.getByLabelText('error')).toBeInTheDocument()
  })

  it('shows "page X of Y" derived from total/limit', () => {
    render(
      <ActivityTab
        entries={entries}
        total={45}
        limit={20}
        offset={20}
        onPageChange={noop}
      />,
    )
    // offset=20, limit=20 → page 2; total 45 → ceil(45/20) = 3
    expect(screen.getByText(/Page 2 of 3/i)).toBeInTheDocument()
  })

  it('disables Previous on page 1', () => {
    render(
      <ActivityTab
        entries={entries}
        total={45}
        limit={20}
        offset={0}
        onPageChange={noop}
      />,
    )
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('disables Next on the last page', () => {
    render(
      <ActivityTab
        entries={entries}
        total={45}
        limit={20}
        offset={40}
        onPageChange={noop}
      />,
    )
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /previous/i })).not.toBeDisabled()
  })

  it('Next calls onPageChange(offset+limit); Previous calls onPageChange(offset-limit)', async () => {
    const onPageChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ActivityTab
        entries={entries}
        total={45}
        limit={20}
        offset={20}
        onPageChange={onPageChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(onPageChange).toHaveBeenLastCalledWith(40)
    await user.click(screen.getByRole('button', { name: /previous/i }))
    expect(onPageChange).toHaveBeenLastCalledWith(0)
  })

  it('renders empty state when entries is empty', () => {
    render(
      <ActivityTab entries={[]} total={0} limit={20} offset={0} onPageChange={noop} />,
    )
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument()
  })
})
