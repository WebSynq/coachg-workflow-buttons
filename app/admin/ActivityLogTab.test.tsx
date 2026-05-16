// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/msw-server'
import { ActivityLogTab } from './ActivityLogTab'
import type { LogEntry } from '../widget/types'

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'log-1',
    contactId: 'ctc-1',
    contactName: 'Jane',
    buttonLabel: 'Send SOA',
    workflowId: 'wf-1',
    workflowName: 'SOA Workflow',
    triggeredByUserId: 'u1',
    triggeredByUserName: 'Agent A',
    status: 'success',
    errorMessage: null,
    triggeredAt: '2026-05-12T18:30:00.000Z',
    soaSentAt: '2026-05-12T18:30:00.000Z',
    ...overrides,
  }
}

describe('<ActivityLogTab />', () => {
  it('renders both success and error rows with their icons', async () => {
    server.use(
      http.get('*/api/log', () =>
        HttpResponse.json({
          entries: [
            entry(),
            entry({
              id: 'log-2',
              status: 'error',
              errorMessage: 'workflow disabled',
              soaSentAt: null,
            }),
          ],
          total: 2,
          limit: 20,
          offset: 0,
        }),
      ),
    )
    render(<ActivityLogTab token="t" onError={() => {}} />)
    await screen.findByLabelText('success')
    expect(screen.getByLabelText('error')).toBeInTheDocument()
    expect(screen.getByText(/workflow disabled/i)).toBeInTheDocument()
  })

  it('shows the "SOA Sent" badge when soaSentAt is present, hides it otherwise', async () => {
    server.use(
      http.get('*/api/log', () =>
        HttpResponse.json({
          entries: [entry(), entry({ id: 'log-2', soaSentAt: null })],
          total: 2,
          limit: 20,
          offset: 0,
        }),
      ),
    )
    render(<ActivityLogTab token="t" onError={() => {}} />)
    await screen.findAllByLabelText('success')
    const badges = screen.getAllByText(/SOA Sent/i)
    // Exactly one badge — the row with soaSentAt null does not render one.
    expect(badges).toHaveLength(1)
  })

  it('Next button advances offset and refetches', async () => {
    const seen: number[] = []
    server.use(
      http.get('*/api/log', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? '0')
        seen.push(offset)
        return HttpResponse.json({
          entries: [entry({ id: `log-${offset}` })],
          total: 100,
          limit: 20,
          offset,
        })
      }),
    )
    const user = userEvent.setup()
    render(<ActivityLogTab token="t" onError={() => {}} />)
    await waitFor(() => expect(seen).toContain(0))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(seen).toContain(20))
  })

  it('disables Prev on the first page and Next on the last page', async () => {
    server.use(
      http.get('*/api/log', () =>
        HttpResponse.json({
          entries: [entry()],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      ),
    )
    render(<ActivityLogTab token="t" onError={() => {}} />)
    await screen.findByLabelText('success')
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('shows the empty state when there are zero entries', async () => {
    server.use(
      http.get('*/api/log', () =>
        HttpResponse.json({ entries: [], total: 0, limit: 20, offset: 0 }),
      ),
    )
    render(<ActivityLogTab token="t" onError={() => {}} />)
    expect(await screen.findByText(/no activity yet/i)).toBeInTheDocument()
  })
})
