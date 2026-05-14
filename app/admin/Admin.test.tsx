// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import jwt from 'jsonwebtoken'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/msw-server'
import { Admin } from './Admin'

function adminToken() {
  return jwt.sign(
    { userId: 'u1', companyId: 'c1', locationId: 'l1', role: 'admin' },
    'irrelevant-test-secret',
    { algorithm: 'HS256' },
  )
}

function userToken() {
  return jwt.sign(
    { userId: 'u1', companyId: 'c1', locationId: 'l1', role: 'user' },
    'irrelevant-test-secret',
    { algorithm: 'HS256' },
  )
}

function sendSso(token: string) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { key: token } }))
  })
}

function buttonRow(over: Partial<{ id: string; label: string; sortOrder: number; workflowId: string; workflowName: string; color: string }> = {}) {
  return {
    id: over.id ?? 'b1',
    label: over.label ?? 'Send SOA',
    color: over.color ?? '#FF0000',
    workflowId: over.workflowId ?? 'wf-1',
    workflowName: over.workflowName ?? 'SOA Workflow',
    sortOrder: over.sortOrder ?? 0,
    sendsSoa: true,
  }
}

const defaultWorkflows = {
  workflows: [
    { id: 'wf-1', name: 'SOA Workflow' },
    { id: 'wf-2', name: 'Welcome Workflow' },
  ],
}

const defaultLog = {
  entries: [],
  total: 0,
  limit: 20,
  offset: 0,
}

describe('<Admin />', () => {
  beforeEach(() => {
    server.use(
      http.get('*/api/buttons', () => HttpResponse.json({ buttons: [] })),
      http.get('*/api/workflows', () => HttpResponse.json(defaultWorkflows)),
      http.get('*/api/log', () => HttpResponse.json(defaultLog)),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the Insufficient permissions gate for a non-admin token', async () => {
    render(<Admin />)
    sendSso(userToken())
    await screen.findByText(/insufficient permissions/i)
    expect(screen.queryByRole('button', { name: /add button/i })).not.toBeInTheDocument()
  })

  it('admin sees the Add Button affordance + existing rows + Activity tab', async () => {
    server.use(
      http.get('*/api/buttons', () =>
        HttpResponse.json({
          buttons: [
            buttonRow({ id: 'b1', label: 'Send SOA', sortOrder: 0 }),
            buttonRow({ id: 'b2', label: 'Welcome', sortOrder: 1, color: '#22C55E', workflowId: 'wf-2', workflowName: 'Welcome Workflow' }),
          ],
        }),
      ),
    )

    render(<Admin />)
    sendSso(adminToken())

    await screen.findByRole('button', { name: /add button/i })
    expect(screen.getByText('Send SOA')).toBeInTheDocument()
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Buttons' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Activity Log' })).toBeInTheDocument()
  })

  it('opening Add Button → filling the form → Save posts to /api/buttons with the right body and refreshes the list', async () => {
    const user = userEvent.setup()
    let postBody: unknown = null
    let getCount = 0

    server.use(
      http.get('*/api/buttons', () => {
        getCount++
        // first GET: empty; subsequent GETs: returns the newly-created row
        if (getCount === 1) return HttpResponse.json({ buttons: [] })
        return HttpResponse.json({
          buttons: [buttonRow({ id: 'created', label: 'New Button' })],
        })
      }),
      http.post('*/api/buttons', async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json(
          { button: buttonRow({ id: 'created', label: 'New Button' }) },
          { status: 201 },
        )
      }),
    )

    render(<Admin />)
    sendSso(adminToken())

    await user.click(await screen.findByRole('button', { name: /add button/i }))
    await user.type(screen.getByLabelText(/label/i), 'New Button')
    // pick the second preset
    await user.click(screen.getAllByTestId('preset-swatch')[1])
    await user.selectOptions(screen.getByLabelText(/workflow/i), 'wf-1')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(postBody).toMatchObject({
        label: 'New Button',
        workflowId: 'wf-1',
        workflowName: 'SOA Workflow',
        sendsSoa: true,
      })
    })
    // List refetched
    await screen.findByText('New Button')
  })

  it('Delete row → confirm dialog → DELETE called', async () => {
    const user = userEvent.setup()
    let deleted: string | null = null
    let getCount = 0

    server.use(
      http.get('*/api/buttons', () => {
        getCount++
        if (getCount === 1) {
          return HttpResponse.json({ buttons: [buttonRow({ id: 'b1', label: 'Send SOA' })] })
        }
        return HttpResponse.json({ buttons: [] })
      }),
      http.delete('*/api/buttons/:id', ({ params }) => {
        deleted = params.id as string
        return new HttpResponse(null, { status: 204 })
      }),
    )

    render(<Admin />)
    sendSso(adminToken())

    await screen.findByText('Send SOA')
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    // confirm dialog appears
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(deleted).toBe('b1')
    })
  })

  it('reorder — clicking Up on row 2 posts the swapped order to /api/buttons/reorder', async () => {
    const user = userEvent.setup()
    let reorderBody: { items: Array<{ id: string; sortOrder: number }> } | null = null

    server.use(
      http.get('*/api/buttons', () =>
        HttpResponse.json({
          buttons: [
            buttonRow({ id: 'b1', label: 'First', sortOrder: 0 }),
            buttonRow({ id: 'b2', label: 'Second', sortOrder: 1 }),
            buttonRow({ id: 'b3', label: 'Third', sortOrder: 2 }),
          ],
        }),
      ),
      http.post('*/api/buttons/reorder', async ({ request }) => {
        reorderBody = (await request.json()) as { items: Array<{ id: string; sortOrder: number }> }
        return HttpResponse.json({ ok: true })
      }),
    )

    render(<Admin />)
    sendSso(adminToken())

    await screen.findByText('Second')
    const rows = screen.getAllByRole('row')
    await user.click(within(rows[1]).getByRole('button', { name: /move up/i }))

    await waitFor(() => {
      // After the swap: [Second, First, Third] — server gets the new sort_order values
      expect(reorderBody).toBeTruthy()
    })
    expect(reorderBody!.items).toEqual([
      { id: 'b2', sortOrder: 0 },
      { id: 'b1', sortOrder: 1 },
      { id: 'b3', sortOrder: 2 },
    ])
  })

  it('Activity Log tab → Next page advances the offset and refetches', async () => {
    const user = userEvent.setup()
    const seenOffsets: string[] = []

    server.use(
      http.get('*/api/log', ({ request }) => {
        const url = new URL(request.url)
        seenOffsets.push(url.searchParams.get('offset') ?? '')
        return HttpResponse.json({
          entries: [
            {
              id: 'l1',
              contactId: 'c1',
              contactName: 'Jane',
              buttonLabel: 'Send SOA',
              workflowId: 'wf-1',
              workflowName: 'SOA Workflow',
              triggeredByUserId: 'u1',
              triggeredByUserName: 'u1',
              status: 'success',
              errorMessage: null,
              triggeredAt: '2026-05-12T18:30:00.000Z',
              soaSentAt: '2026-05-12T18:30:00.000Z',
            },
          ],
          total: 45,
          limit: 20,
          offset: url.searchParams.get('offset')
            ? parseInt(url.searchParams.get('offset')!, 10)
            : 0,
        })
      }),
    )

    render(<Admin />)
    sendSso(adminToken())

    await user.click(await screen.findByRole('tab', { name: 'Activity Log' }))
    await screen.findByText(/page 1 of 3/i)
    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      // We called /api/log on initial admin mount (offset omitted) + after tab click + after Next
      expect(seenOffsets).toContain('20')
    })
  })

  it('color picker round-trips: editing a button via the form modal sends the new color to /api/buttons/[id]', async () => {
    const user = userEvent.setup()
    let putBody: { color?: string } | null = null

    server.use(
      http.get('*/api/buttons', () =>
        HttpResponse.json({
          buttons: [
            buttonRow({ id: 'b1', label: 'Send SOA', color: '#FF0000' }),
          ],
        }),
      ),
      http.put('*/api/buttons/:id', async ({ request }) => {
        putBody = (await request.json()) as { color?: string }
        return HttpResponse.json({
          button: buttonRow({ id: 'b1', label: 'Send SOA', color: putBody.color }),
        })
      }),
    )

    render(<Admin />)
    sendSso(adminToken())

    await screen.findByText('Send SOA')
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    // pick a different preset (the 5th — teal)
    await user.click(screen.getAllByTestId('preset-swatch')[4])
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(putBody).toBeTruthy()
    })
    expect(putBody!.color).toBe('#14B8A6')
  })
})
