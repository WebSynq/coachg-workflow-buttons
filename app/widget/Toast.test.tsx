// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Toast } from './Toast'

describe('Toast', () => {
  it('renders nothing when toast is null', () => {
    const { container } = render(<Toast toast={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the message text when present', () => {
    render(<Toast toast={{ kind: 'success', message: 'Enrolled!' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Enrolled!')
  })

  it('uses success styling for kind=success', () => {
    render(<Toast toast={{ kind: 'success', message: 'good' }} />)
    const el = screen.getByRole('status')
    expect(el.className).toMatch(/green/)
  })

  it('uses error styling for kind=error', () => {
    render(<Toast toast={{ kind: 'error', message: 'bad' }} />)
    const el = screen.getByRole('status')
    expect(el.className).toMatch(/red/)
  })
})
