export function isCounterValid(
  storedCounter: number | undefined,
  newCounter: number | undefined,
): boolean {
  const stored = storedCounter ?? 0
  const received = newCounter ?? 0
  return (stored === 0 && received === 0) || received > stored
}
