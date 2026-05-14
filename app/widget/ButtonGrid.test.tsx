// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ButtonGrid } from './ButtonGrid'
import type { Button } from './types'

const sample: Button[] = [
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
    workflowName: 'Welcome Workflow',
    sortOrder: 1,
    sendsSoa: false,
  },
]

describe('ButtonGrid', () => {
  it('renders one <button> per item with the label visible', () => {
    render(<ButtonGrid buttons={sample} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Send SOA' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Welcome' })).toBeInTheDocument()
  })

  it("sets each button's inline backgroundColor to its color", () => {
    render(<ButtonGrid buttons={sample} onClick={() => {}} />)
    const soa = screen.getByRole('button', { name: 'Send SOA' })
    // browsers normalize hex to rgb() at the .style read site
    expect(soa.style.backgroundColor).toBe('rgb(255, 0, 0)')
  })

  it('shows an empty state when there are no buttons', () => {
    render(<ButtonGrid buttons={[]} onClick={() => {}} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/no buttons configured/i)).toBeInTheDocument()
  })

  it('calls onClick with the clicked button object', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<ButtonGrid buttons={sample} onClick={onClick} />)
    await user.click(screen.getByRole('button', { name: 'Welcome' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(sample[1])
  })
})
