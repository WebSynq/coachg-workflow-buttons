// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColorPicker, COLOR_PRESETS } from './ColorPicker'

describe('ColorPicker', () => {
  it('renders exactly 10 preset swatches', () => {
    render(<ColorPicker value="#000000" onChange={() => {}} />)
    expect(COLOR_PRESETS).toHaveLength(10)
    for (const hex of COLOR_PRESETS) {
      expect(screen.getByRole('radio', { name: `Select ${hex}` })).toBeInTheDocument()
    }
  })

  it('marks the matching preset as aria-checked', () => {
    render(<ColorPicker value={COLOR_PRESETS[5]} onChange={() => {}} />)
    const selected = screen.getByRole('radio', { name: `Select ${COLOR_PRESETS[5]}` })
    expect(selected).toHaveAttribute('aria-checked', 'true')
  })

  it('emits the clicked preset hex via onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ColorPicker value="#000000" onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: `Select ${COLOR_PRESETS[2]}` }))
    expect(onChange).toHaveBeenCalledWith(COLOR_PRESETS[2])
  })

  // The spec's round-trip requirement: set a hex via the input → read back
  // the same hex from the controlled state. Verified end-to-end here with
  // a small wrapper that owns the state.
  it('round-trips a custom hex through the input', async () => {
    const user = userEvent.setup()
    function Wrapper() {
      const [c, setC] = useState('#000000')
      return (
        <>
          <ColorPicker value={c} onChange={setC} />
          <p data-testid="current">{c}</p>
        </>
      )
    }
    render(<Wrapper />)
    const input = screen.getByLabelText(/hex color/i) as HTMLInputElement
    await user.clear(input)
    await user.type(input, '#ABCDEF')
    expect(screen.getByTestId('current')).toHaveTextContent('#ABCDEF')
  })
})
