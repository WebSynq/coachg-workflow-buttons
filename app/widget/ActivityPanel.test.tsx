// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityPanel } from './ActivityPanel'
import type { LogEntry } from './types'

const baseRow: Omit<LogEntry, 'id' | 'status' | 'errorMessage' | 'buttonLabel'> = {
  contactId: 'c1',
  contactName: 'Jane',
  workflowId: 'wf1',
  workflowName: 'WF',
  triggeredByUserId: 'u1',
  triggeredByUserName: 'u1',
  triggeredAt: '2026-05-12T18:30:00.000Z',
  soaSentAt: null,
}

const successEntry: LogEntry = {
  ...baseRow,
  id: 'l1',
  status: 'success',
  errorMessage: null,
  buttonLabel: 'Send SOA',
}

const errorEntry: LogEntry = {
  ...baseRow,
  id: 'l2',
  status: 'error',
  errorMessage: 'workflow disabled',
  buttonLabel: 'Welcome',
}

describe('ActivityPanel', () => {
  it('renders "No activity yet" when entries is empty', () => {
    render(<ActivityPanel entries={[]} />)
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument()
  })

  it('renders a success row with the button label and a success indicator', () => {
    render(<ActivityPanel entries={[successEntry]} />)
    expect(screen.getByText('Send SOA')).toBeInTheDocument()
    expect(screen.getByLabelText('success')).toBeInTheDocument()
  })

  it('renders an error row with the button label, error indicator, AND the error message', () => {
    render(<ActivityPanel entries={[errorEntry]} />)
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByLabelText('error')).toBeInTheDocument()
    expect(screen.getByText('workflow disabled')).toBeInTheDocument()
  })

  it('renders entries in the order it is given (caller controls sort)', () => {
    render(<ActivityPanel entries={[errorEntry, successEntry]} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Welcome')
    expect(items[1]).toHaveTextContent('Send SOA')
  })
})
