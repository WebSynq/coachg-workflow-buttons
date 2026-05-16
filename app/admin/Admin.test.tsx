// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/msw-server'
import { Admin } from './Admin'

function b64url(obj: object): string {
  return btoa(JSON.stringify(obj))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function makeJwt(payload: object): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`
}

function sendSso(token: string) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { key: token } }))
  })
}

describe('<Admin />', () => {
  beforeEach(() => {
    server.use(
      http.get('*/api/buttons', () => HttpResponse.json({ buttons: [] })),
      http.get('*/api/workflows', () => HttpResponse.json({ workflows: [] })),
      http.get('*/api/log', () =>
        HttpResponse.json({ entries: [], total: 0, limit: 20, offset: 0 }),
      ),
    )
  })

  it('shows the loading state before the SSO token arrives', () => {
    render(<Admin />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders the gate (and NOT the admin UI) when the decoded role is not admin', async () => {
    render(<Admin />)
    sendSso(makeJwt({ role: 'user', userId: 'u1', locationId: 'loc-1' }))
    expect(await screen.findByTestId('admin-gate')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('renders the gate when the role claim is missing entirely', async () => {
    render(<Admin />)
    sendSso(makeJwt({ userId: 'u1', locationId: 'loc-1' }))
    expect(await screen.findByTestId('admin-gate')).toBeInTheDocument()
  })

  it('renders the full UI with two tabs for admin role', async () => {
    render(<Admin />)
    sendSso(makeJwt({ role: 'admin', userId: 'u1', locationId: 'loc-1' }))
    expect(
      await screen.findByRole('tab', { name: /^buttons$/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: /activity log/i }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('admin-gate')).not.toBeInTheDocument()
  })

  it('switches tabs when Activity Log is clicked', async () => {
    const user = userEvent.setup()
    render(<Admin />)
    sendSso(makeJwt({ role: 'admin', userId: 'u1', locationId: 'loc-1' }))
    await screen.findByRole('tab', { name: /^buttons$/i })
    await user.click(screen.getByRole('tab', { name: /activity log/i }))
    expect(
      screen.getByRole('tab', { name: /activity log/i }),
    ).toHaveAttribute('aria-selected', 'true')
  })
})
