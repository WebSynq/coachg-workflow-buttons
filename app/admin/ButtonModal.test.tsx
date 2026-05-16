// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ButtonModal } from './ButtonModal'

const workflows = [
  { id: 'wf-1', name: 'SOA Workflow' },
  { id: 'wf-2', name: 'Welcome' },
]

const sampleButton = {
  id: 'b1',
  label: 'Send SOA',
  color: '#FF0000',
  workflowId: 'wf-1',
  workflowName: 'SOA Workflow',
  sortOrder: 0,
  sendsSoa: true,
}

describe('ButtonModal', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <ButtonModal
        open={false}
        mode="create"
        initial={null}
        workflows={workflows}
        busy={false}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the create dialog with empty defaults', () => {
    render(
      <ButtonModal
        open
        mode="create"
        initial={null}
        workflows={workflows}
        busy={false}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('dialog', { name: /add button/i })).toBeInTheDocument()
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Workflow') as HTMLSelectElement).value).toBe('')
  })

  it('pre-fills every field in edit mode from `initial`', () => {
    render(
      <ButtonModal
        open
        mode="edit"
        initial={sampleButton}
        workflows={workflows}
        busy={false}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )
    expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Send SOA')
    expect((screen.getByLabelText('Workflow') as HTMLSelectElement).value).toBe('wf-1')
    expect((screen.getByLabelText(/hex color/i) as HTMLInputElement).value).toBe(
      '#FF0000',
    )
  })

  it('submits the full payload — and looks up workflowName from id', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonModal
        open
        mode="create"
        initial={null}
        workflows={workflows}
        busy={false}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    await user.type(screen.getByLabelText('Label'), 'Pick me')
    await user.selectOptions(screen.getByLabelText('Workflow'), 'wf-2')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSubmit).toHaveBeenCalledWith({
      label: 'Pick me',
      color: '#3B82F6',
      workflowId: 'wf-2',
      workflowName: 'Welcome',
      sendsSoa: true,
    })
  })

  it('blocks submit on empty label and surfaces a validation alert', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonModal
        open
        mode="create"
        initial={null}
        workflows={workflows}
        busy={false}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/required/i)
  })

  it('blocks submit on invalid hex', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonModal
        open
        mode="create"
        initial={null}
        workflows={workflows}
        busy={false}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    await user.type(screen.getByLabelText('Label'), 'X')
    const hex = screen.getByLabelText(/hex color/i)
    await user.clear(hex)
    await user.type(hex, 'nope')
    await user.selectOptions(screen.getByLabelText('Workflow'), 'wf-1')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/hex/i)
  })

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonModal
        open
        mode="create"
        initial={null}
        workflows={workflows}
        busy={false}
        onSubmit={() => {}}
        onClose={onClose}
      />,
    )
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disables the Save button while busy', () => {
    render(
      <ButtonModal
        open
        mode="create"
        initial={null}
        workflows={workflows}
        busy
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })
})
