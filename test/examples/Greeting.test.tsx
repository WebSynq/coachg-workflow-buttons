// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Greeting } from './Greeting'

afterEach(() => {
  cleanup()
})

describe('Greeting', () => {
  it('renders the name passed in', () => {
    render(<Greeting name="Tim" />)
    expect(screen.getByText('Hello, Tim!')).toBeInTheDocument()
  })

  it('falls back to "world" when no name is given', () => {
    render(<Greeting />)
    expect(screen.getByText('Hello, world!')).toBeInTheDocument()
  })

  it('renders inside a heading', () => {
    render(<Greeting name="Tim" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Tim!')
  })
})
