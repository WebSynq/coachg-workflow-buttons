// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/msw-server'
import { Widget } from './Widget'

const TOKEN = 'jwt.fake.token'

function sendSso(token = TOKEN) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { key: token } }))
  })
}

const buttonsResponse = {
  buttons: [
    {
      id: 'btn-soa',
      label: 'Send SOA',
      color: '#FF0000',
      workflowId: 'wf-soa',
      workflowName: 'SOA Workflow',
      sortOrder: 0,
      sendsSoa: true,
    },
    {
      id: 'btn-welcome',
      label: 'Welcome',
      color: '#00AA00',
      workflowId: 'wf-welcome',
      workflowName: 'Welcome Workflow',
      sortOrder: 1,
      sendsSoa: false,
    },
  ],
}

function logResponse(overrides: Partial<{ lastSoaSentAt: string | null; entries: unknown[] }> = {}) {
  return {
    entries: [],
    lastSoaSentAt: null,
    ...overrides,
  }
}

describe('<Widget />', () => {
  beforeEach(() => {
    // Default handlers: any SSO header is fine; assert on it per-test.
    server.use(
      http.get('*/api/buttons', () => HttpResponse.json(buttonsResponse)),
      http.get('*/api/log', () => HttpResponse.json(logResponse())),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the loading state before the SSO token arrives', () => {
    render(<Widget contactId="ctc-1" contactName="Jane" />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('fetches /api/buttons and /api/log with the SSO header once the token arrives, and renders the buttons + activity', async () => {
    const seenButtonsAuth: Array<string | null> = []
    const seenLogAuth: Array<string | null> = []
    server.use(
      http.get('*/api/buttons', ({ request }) => {
        seenButtonsAuth.push(request.headers.get('X-GHL-SSO'))
        return HttpResponse.json(buttonsResponse)
      }),
      http.get('*/api/log', ({ request }) => {
        seenLogAuth.push(request.headers.get('X-GHL-SSO'))
        const url = new URL(request.url)
        expect(url.searchParams.get('contactId')).toBe('ctc-1')
        return HttpResponse.json(logResponse())
      }),
    )

    render(<Widget contactId="ctc-1" contactName="Jane" />)
    sendSso()

    await screen.findByRole('button', { name: 'Send SOA' })
    expect(screen.getByRole('button', { name: 'Welcome' })).toBeInTheDocument()
    expect(seenButtonsAuth).toEqual([TOKEN])
    expect(seenLogAuth).toEqual([TOKEN])
  })

  it('renders "SOA last sent: never" when lastSoaSentAt is null', async () => {
    render(<Widget contactId="ctc-1" contactName="Jane" />)
    sendSso()
    // The "never" text lives in a child <span>, so we assert against the
    // ancestor <p> via textContent rather than against a single element.
    const soaLine = await screen.findByText(/SOA last sent:/i)
    expect(soaLine).toHaveTextContent(/SOA last sent: never/i)
  })

  it('renders a formatted "SOA last sent" date when present', async () => {
    server.use(
      http.get('*/api/log', () =>
        HttpResponse.json(logResponse({ lastSoaSentAt: '2026-05-10T15:00:00.000Z' })),
      ),
    )
    render(<Widget contactId="ctc-1" contactName="Jane" />)
    sendSso()
    await waitFor(() => {
      const soaLine = screen.getByText(/SOA last sent:/i)
      expect(soaLine).toHaveTextContent(/2026-05-10/)
    })
  })

  it('clicking a button opens a confirm modal with "Enroll {contactName} in {workflowName}?"', async () => {
    const user = userEvent.setup()
    render(<Widget contactId="ctc-1" contactName="Jane" />)
    sendSso()
    const btn = await screen.findByRole('button', { name: 'Send SOA' })

    await user.click(btn)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Enroll/i)
    expect(dialog).toHaveTextContent('Jane')
    expect(dialog).toHaveTextContent('SOA Workflow')
  })

  it('cancelling the modal does NOT call /api/enroll', async () => {
    const user = userEvent.setup()
    const enrollCalls: unknown[] = []
    server.use(
      http.post('*/api/enroll', async ({ request }) => {
        enrollCalls.push(await request.json())
        return HttpResponse.json({ ok: true })
      }),
    )

    render(<Widget contactId="ctc-1" contactName="Jane" />)
    sendSso()
    await user.click(await screen.findByRole('button', { name: 'Send SOA' }))
    await user.click(await screen.findByRole('button', { name: /cancel/i }))

    expect(enrollCalls).toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('confirming POSTs to /api/enroll with the SSO header + body, then prepends the entry to the activity panel', async () => {
    const user = userEvent.setup()
    let enrollAuth: string | null = null
    let enrollBody: unknown = null
    const newEntry = {
      id: 'log-new',
      contactId: 'ctc-1',
      contactName: 'Jane',
      buttonLabel: 'Send SOA',
      workflowId: 'wf-soa',
      workflowName: 'SOA Workflow',
      triggeredByUserId: 'u1',
      triggeredByUserName: 'u1',
      status: 'success' as const,
      errorMessage: null,
      triggeredAt: '2026-05-12T18:30:00.000Z',
      soaSentAt: '2026-05-12T18:30:00.000Z',
    }
    server.use(
      http.post('*/api/enroll', async ({ request }) => {
        enrollAuth = request.headers.get('X-GHL-SSO')
        enrollBody = await request.json()
        return HttpResponse.json({ ok: true, entry: newEntry })
      }),
    )

    render(<Widget contactId="ctc-1" contactName="Jane" />)
    sendSso()
    await user.click(await screen.findByRole('button', { name: 'Send SOA' }))
    await user.click(await screen.findByRole('button', { name: /confirm/i }))

    await waitFor(() => {
      expect(screen.getByText(/enrolled in SOA Workflow/i)).toBeInTheDocument()
    })
    expect(enrollAuth).toBe(TOKEN)
    expect(enrollBody).toEqual({
      buttonId: 'btn-soa',
      contactId: 'ctc-1',
      contactName: 'Jane',
    })

    // Activity row prepended
    const items = await screen.findAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Send SOA')
    expect(screen.getByLabelText('success')).toBeInTheDocument()
  })

  it('on 502 (GHL failure) shows a red toast AND prepends the error row from the response', async () => {
    const user = userEvent.setup()
    const errorEntry = {
      id: 'log-err',
      contactId: 'ctc-1',
      contactName: 'Jane',
      buttonLabel: 'Send SOA',
      workflowId: 'wf-soa',
      workflowName: 'SOA Workflow',
      triggeredByUserId: 'u1',
      triggeredByUserName: 'u1',
      status: 'error' as const,
      errorMessage: 'workflow disabled',
      triggeredAt: '2026-05-12T18:31:00.000Z',
      soaSentAt: null,
    }
    server.use(
      http.post('*/api/enroll', () =>
        HttpResponse.json({ ok: false, entry: errorEntry }, { status: 502 }),
      ),
    )

    render(<Widget contactId="ctc-1" contactName="Jane" />)
    sendSso()
    await user.click(await screen.findByRole('button', { name: 'Send SOA' }))
    await user.click(await screen.findByRole('button', { name: /confirm/i }))

    await screen.findByLabelText('error')
    // "workflow disabled" appears in both the activity row and the toast
    // — assert that at least one renders, then drill into the toast.
    const matches = screen.getAllByText(/workflow disabled/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    const toast = screen.getByRole('status')
    expect(toast.className).toMatch(/red/)
    expect(toast).toHaveTextContent(/workflow disabled/i)
  })
})
