// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from './Tabs'

const tabs = [
  { key: 'buttons', label: 'Buttons' },
  { key: 'activity', label: 'Activity Log' },
] as const

describe('Tabs', () => {
  it('renders one tab per item', () => {
    render(<Tabs tabs={tabs} active="buttons" onSelect={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Buttons' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Activity Log' })).toBeInTheDocument()
  })

  it('marks the active tab via aria-selected="true"', () => {
    render(<Tabs tabs={tabs} active="activity" onSelect={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Activity Log' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Buttons' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('calls onSelect(key) when a non-active tab is clicked', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<Tabs tabs={tabs} active="buttons" onSelect={onSelect} />)
    await user.click(screen.getByRole('tab', { name: 'Activity Log' }))
    expect(onSelect).toHaveBeenCalledWith('activity')
  })
})
