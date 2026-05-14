// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmModal } from './ConfirmModal'

describe('ConfirmModal', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <ConfirmModal
        open={false}
        contactName="Jane"
        workflowName="SOA"
        busy={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders "Enroll {contactName} in {workflowName}?" when open', () => {
    render(
      <ConfirmModal
        open
        contactName="Jane"
        workflowName="SOA Workflow"
        busy={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/Enroll/i)
    expect(dialog).toHaveTextContent('Jane')
    expect(dialog).toHaveTextContent('SOA Workflow')
  })

  it('calls onCancel when the Cancel button is clicked', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <ConfirmModal
        open
        contactName="Jane"
        workflowName="W"
        busy={false}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    )
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onConfirm when the Confirm button is clicked', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <ConfirmModal
        open
        contactName="Jane"
        workflowName="W"
        busy={false}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables the Confirm button while busy', () => {
    render(
      <ConfirmModal
        open
        contactName="Jane"
        workflowName="W"
        busy
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    // Confirm button gets a busy label so the click target stays
    // discoverable to assistive tech even when disabled.
    expect(screen.getByRole('button', { name: /enrolling/i })).toBeDisabled()
  })
})
