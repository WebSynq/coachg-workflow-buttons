// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSso } from './useSso'

describe('useSso', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts REQUEST_USER_DATA to window.parent exactly once on mount', () => {
    const spy = vi.spyOn(window.parent, 'postMessage')
    renderHook(() => useSso())
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ message: 'REQUEST_USER_DATA' }, '*')
  })

  it('returns null before any message arrives', () => {
    const { result } = renderHook(() => useSso())
    expect(result.current).toBeNull()
  })

  it('returns the JWT after a message arrives with a string `key`', () => {
    const { result } = renderHook(() => useSso())
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { key: 'jwt.string.here' } }),
      )
    })
    expect(result.current).toBe('jwt.string.here')
  })

  it('ignores messages that have no `key` field', () => {
    const { result } = renderHook(() => useSso())
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { somethingElse: 'foo' } }),
      )
    })
    expect(result.current).toBeNull()
  })

  it('ignores messages whose `key` is not a string', () => {
    const { result } = renderHook(() => useSso())
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { key: 12345 } }),
      )
    })
    expect(result.current).toBeNull()
  })

  it('ignores messages whose data is not an object (string, null, etc.)', () => {
    const { result } = renderHook(() => useSso())
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: 'foo' }))
      window.dispatchEvent(new MessageEvent('message', { data: null }))
    })
    expect(result.current).toBeNull()
  })

  it('removes the message listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useSso())
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function))
  })
})
