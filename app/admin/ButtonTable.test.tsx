// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ButtonTable } from './ButtonTable'
import type { Button } from '../widget/types'

const rows: Button[] = [
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
  {
    id: 'b3',
    label: 'Thank You',
    color: '#0000FF',
    workflowId: 'wf-3',
    workflowName: 'Thank You Workflow',
    sortOrder: 2,
    sendsSoa: false,
  },
]

const noop = () => {}

describe('ButtonTable', () => {
  it('renders the empty state when there are no buttons', () => {
    render(
      <ButtonTable buttons={[]} onReorder={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(screen.queryByRole('row')).not.toBeInTheDocument()
    expect(screen.getByText(/no buttons yet/i)).toBeInTheDocument()
  })

  it('renders a row per button with label, workflow name, and color swatch', () => {
    render(
      <ButtonTable buttons={rows} onReorder={noop} onEdit={noop} onDelete={noop} />,
    )
    expect(screen.getByText('Send SOA')).toBeInTheDocument()
    expect(screen.getByText('SOA Workflow')).toBeInTheDocument()
    // Each row has a color swatch with role="presentation"
    const swatches = screen.getAllByTestId('color-swatch')
    expect(swatches).toHaveLength(3)
    expect(swatches[0].style.backgroundColor).toBe('rgb(255, 0, 0)')
  })

  it('disables the Up arrow on the first row and the Down arrow on the last', () => {
    render(
      <ButtonTable buttons={rows} onReorder={noop} onEdit={noop} onDelete={noop} />,
    )
    const allRows = screen.getAllByRole('row')
    // first row's up arrow disabled
    expect(within(allRows[0]).getByRole('button', { name: /move up/i })).toBeDisabled()
    expect(within(allRows[0]).getByRole('button', { name: /move down/i })).not.toBeDisabled()
    // last row's down arrow disabled
    expect(within(allRows[2]).getByRole('button', { name: /move up/i })).not.toBeDisabled()
    expect(within(allRows[2]).getByRole('button', { name: /move down/i })).toBeDisabled()
  })

  it('clicking Up on row 1 calls onReorder with rows[1] swapped above rows[0]', async () => {
    const onReorder = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonTable buttons={rows} onReorder={onReorder} onEdit={noop} onDelete={noop} />,
    )
    const allRows = screen.getAllByRole('row')
    await user.click(within(allRows[1]).getByRole('button', { name: /move up/i }))
    expect(onReorder).toHaveBeenCalledTimes(1)
    expect(onReorder.mock.calls[0][0]).toEqual([rows[1], rows[0], rows[2]])
  })

  it('clicking Down on row 0 calls onReorder with rows[0] swapped below rows[1]', async () => {
    const onReorder = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonTable buttons={rows} onReorder={onReorder} onEdit={noop} onDelete={noop} />,
    )
    const allRows = screen.getAllByRole('row')
    await user.click(within(allRows[0]).getByRole('button', { name: /move down/i }))
    expect(onReorder.mock.calls[0][0]).toEqual([rows[1], rows[0], rows[2]])
  })

  it('Edit calls onEdit with the row object', async () => {
    const onEdit = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonTable buttons={rows} onReorder={noop} onEdit={onEdit} onDelete={noop} />,
    )
    const targetRow = screen.getAllByRole('row')[1]
    await user.click(within(targetRow).getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(rows[1])
  })

  it('Delete calls onDelete with the row object', async () => {
    const onDelete = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonTable buttons={rows} onReorder={noop} onEdit={noop} onDelete={onDelete} />,
    )
    const targetRow = screen.getAllByRole('row')[2]
    await user.click(within(targetRow).getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith(rows[2])
  })
})
