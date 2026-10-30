// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useDebounce } from '@/lib/hooks/useDebounce'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('waits 300ms and cancels intermediate values', () => {
  vi.useFakeTimers()
  const { result, rerender, unmount } = renderHook(({ value }) => useDebounce(value), { initialProps: { value: '' } })
  rerender({ value: 'a' })
  act(() => vi.advanceTimersByTime(299))
  expect(result.current.value).toBe('')
  rerender({ value: 'ab' })
  act(() => vi.advanceTimersByTime(299))
  expect(result.current.value).toBe('')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.value).toBe('ab')
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('flushes immediately and cancels a stale pending search', () => {
  vi.useFakeTimers()
  const { result, rerender } = renderHook(({ value }) => useDebounce(value), { initialProps: { value: '' } })
  rerender({ value: 'stale' })
  act(() => result.current.flush('preset'))
  expect(result.current.value).toBe('preset')
  rerender({ value: 'preset' })
  act(() => vi.advanceTimersByTime(300))
  expect(result.current.value).toBe('preset')
  act(() => result.current.flush(''))
  rerender({ value: '' })
  expect(result.current.value).toBe('')
})
