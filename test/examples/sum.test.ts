import { describe, expect, it } from 'vitest'
import { sum } from './sum'

describe('sum', () => {
  it('adds two positive numbers', () => {
    expect(sum(2, 3)).toBe(5)
  })

  it('treats negative numbers correctly', () => {
    expect(sum(-1, 4)).toBe(3)
  })

  it('returns zero for two zeros', () => {
    expect(sum(0, 0)).toBe(0)
  })
})
