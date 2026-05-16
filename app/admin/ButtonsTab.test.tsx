// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/msw-server'
import { ButtonsTab } from './ButtonsTab'

const buttons = [
  {
    id: 'b1',
    label: 'Send SOA',
    color: '#FF0000',
    workflowId: 'wf-1',
    workflowName: 'SOA Workflow',
    sortOrder: 0,
    sendsSoa: true,
  },
  {
    id: 'b2',
    label: 'Welcome',
    color: '#00AA00',
    workflowId: 'wf-2',
    workflowName: 'Welcome',
    sortOrder: 1,
    sendsSoa: false,
  },
]

const workflows = [
  { id: 'wf-1', name: 'SOA Workflow' },
  { id: 'wf-2', name: 'Welcome' },
  { id: 'wf-3', name: 'Follow-up' },
]

describe('<ButtonsTab />', () => {
  beforeEach(() => {
    server.use(
      http.get('*/api/buttons', () => HttpResponse.json({ buttons })),
      http.get('*/api/workflows', () => HttpResponse.json({ workflows })),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads and renders existing buttons in order', async () => {
    render(<ButtonsTab token="t" onError={() => {}} />)
    await screen.findByText('Send SOA')
    // Both the label and workflowName fixtures use the string "Welcome",
    // so there should be two matches across the row.
    expect(screen.getAllByText('Welcome')).toHaveLength(2)
    expect(screen.getByText('SOA Workflow')).toBeInTheDocument()
  })

  it('opens the Add modal and POSTs /api/buttons with the correct payload', async () => {
    const user = userEvent.setup()
    let body: unknown = null
    let seenAuth: string | null = null
    server.use(
      http.post('*/api/buttons', async ({ request }) => {
        seenAuth = request.headers.get('X-GHL-SSO')
        body = await request.json()
        return HttpResponse.json(
          {
            button: {
              id: 'b3',
              ...(body as object),
              sortOrder: 2,
            },
          },
          { status: 201 },
        )
      }),
    )

    render(<ButtonsTab token="t-jwt" onError={() => {}} />)
    await screen.findByText('Send SOA')
    await user.click(screen.getByRole('button', { name: /add button/i }))
    await user.type(screen.getByLabelText('Label'), 'Follow-up Btn')
    await user.selectOptions(screen.getByLabelText('Workflow'), 'wf-3')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(body).toEqual({
        label: 'Follow-up Btn',
        color: '#3B82F6',
        workflowId: 'wf-3',
        workflowName: 'Follow-up',
        sendsSoa: true,
      })
    })
    expect(seenAuth).toBe('t-jwt')
  })

  it('reorder up: clicking ▲ on row 2 POSTs /api/buttons/reorder with swapped sortOrders', async () => {
    const user = userEvent.setup()
    let body: unknown = null
    server.use(
      http.post('*/api/buttons/reorder', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )

    render(<ButtonsTab token="t" onError={() => {}} />)
    await screen.findByText('Send SOA')
    await user.click(screen.getByRole('button', { name: /move welcome up/i }))

    await waitFor(() => {
      expect(body).toEqual({
        items: [
          { id: 'b2', sortOrder: 0 },
          { id: 'b1', sortOrder: 1 },
        ],
      })
    })
  })

  it('deletes a button after window.confirm() returns true', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let deletedId: string | null = null
    server.use(
      http.delete('*/api/buttons/:id', ({ params }) => {
        deletedId = params.id as string
        return new HttpResponse(null, { status: 204 })
      }),
    )

    render(<ButtonsTab token="t" onError={() => {}} />)
    await screen.findByText('Send SOA')
    const deleteBtns = screen.getAllByRole('button', { name: /^delete$/i })
    await user.click(deleteBtns[0])
    await waitFor(() => expect(deletedId).toBe('b1'))
  })

  it('skips DELETE when confirm() returns false', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const calls: string[] = []
    server.use(
      http.delete('*/api/buttons/:id', ({ params }) => {
        calls.push(params.id as string)
        return new HttpResponse(null, { status: 204 })
      }),
    )

    render(<ButtonsTab token="t" onError={() => {}} />)
    await screen.findByText('Send SOA')
    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0])
    // give any rogue request a beat to fire — none should
    await new Promise(r => setTimeout(r, 50))
    expect(calls).toHaveLength(0)
  })

  it('shows an empty state when there are zero buttons', async () => {
    server.use(http.get('*/api/buttons', () => HttpResponse.json({ buttons: [] })))
    render(<ButtonsTab token="t" onError={() => {}} />)
    expect(await screen.findByText(/no buttons yet/i)).toBeInTheDocument()
  })
})
