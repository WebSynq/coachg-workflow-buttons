// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ButtonFormModal, COLOR_PRESETS } from './ButtonFormModal'
import type { Button } from '../widget/types'

const workflows = [
  { id: 'wf-1', name: 'SOA Workflow' },
  { id: 'wf-2', name: 'Welcome Workflow' },
]

const existing: Button = {
  id: 'b1',
  label: 'Send SOA',
  color: '#FF0000',
  workflowId: 'wf-1',
  workflowName: 'SOA Workflow',
  sortOrder: 0,
  sendsSoa: true,
}

const noop = () => {}

describe('ButtonFormModal', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <ButtonFormModal
        open={false}
        initial={null}
        workflows={workflows}
        busy={false}
        onSave={noop}
        onCancel={noop}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('in create mode: inputs are blank, sendsSoa checked, workflows populate the dropdown', () => {
    render(
      <ButtonFormModal
        open
        initial={null}
        workflows={workflows}
        busy={false}
        onSave={noop}
        onCancel={noop}
      />,
    )
    expect(screen.getByLabelText(/label/i)).toHaveValue('')
    expect(screen.getByLabelText(/sends soa/i)).toBeChecked()
    // workflow dropdown has both options
    expect(screen.getByRole('option', { name: 'SOA Workflow' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Welcome Workflow' })).toBeInTheDocument()
  })

  it('in edit mode: pre-fills label, color, workflowId, sendsSoa from initial', () => {
    render(
      <ButtonFormModal
        open
        initial={existing}
        workflows={workflows}
        busy={false}
        onSave={noop}
        onCancel={noop}
      />,
    )
    expect(screen.getByLabelText(/label/i)).toHaveValue('Send SOA')
    expect(screen.getByLabelText(/hex/i)).toHaveValue('#FF0000')
    expect(screen.getByLabelText(/sends soa/i)).toBeChecked()
    expect((screen.getByLabelText(/workflow/i) as HTMLSelectElement).value).toBe('wf-1')
  })

  it('clicking a preset swatch updates the hex input', async () => {
    const user = userEvent.setup()
    render(
      <ButtonFormModal
        open
        initial={null}
        workflows={workflows}
        busy={false}
        onSave={noop}
        onCancel={noop}
      />,
    )
    const swatches = screen.getAllByTestId('preset-swatch')
    expect(swatches).toHaveLength(COLOR_PRESETS.length)
    // Click the 4th preset (green)
    await user.click(swatches[3])
    expect(screen.getByLabelText(/hex/i)).toHaveValue(COLOR_PRESETS[3])
  })

  it('color picker round-trip: picking a preset then Save sends the new color', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonFormModal
        open
        initial={existing}
        workflows={workflows}
        busy={false}
        onSave={onSave}
        onCancel={noop}
      />,
    )
    // pick a non-existing color (the 6th preset)
    const newColor = COLOR_PRESETS[5]
    const swatches = screen.getAllByTestId('preset-swatch')
    await user.click(swatches[5])
    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toEqual({
      label: 'Send SOA',
      color: newColor,
      workflowId: 'wf-1',
      workflowName: 'SOA Workflow',
      sendsSoa: true,
    })
  })

  it('rejects an invalid hex — Save disabled until valid', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonFormModal
        open
        initial={null}
        workflows={workflows}
        busy={false}
        onSave={onSave}
        onCancel={noop}
      />,
    )
    await user.type(screen.getByLabelText(/label/i), 'My Button')
    await user.clear(screen.getByLabelText(/hex/i))
    await user.type(screen.getByLabelText(/hex/i), 'not-a-color')
    // workflowId must be set too — pick one
    await user.selectOptions(screen.getByLabelText(/workflow/i), 'wf-1')

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('Cancel calls onCancel; Save (valid input) calls onSave with the form payload', async () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <ButtonFormModal
        open
        initial={null}
        workflows={workflows}
        busy={false}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )
    await user.type(screen.getByLabelText(/label/i), 'My Button')
    await user.click(screen.getAllByTestId('preset-swatch')[0])
    await user.selectOptions(screen.getByLabelText(/workflow/i), 'wf-2')

    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toEqual({
      label: 'My Button',
      color: COLOR_PRESETS[0],
      workflowId: 'wf-2',
      workflowName: 'Welcome Workflow',
      sendsSoa: true,
    })

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
