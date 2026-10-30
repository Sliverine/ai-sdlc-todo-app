import { useCallback, useEffect, useRef, useState } from 'react'

export function useDebounce<T>(input: T, delayMs = 300) {
  const [value, setValue] = useState(input)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    timer.current = setTimeout(() => setValue(input), delayMs)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [input, delayMs])

  const flush = useCallback((next: T) => {
    if (timer.current !== null) clearTimeout(timer.current)
    setValue(next)
  }, [])

  return { value, flush }
}
