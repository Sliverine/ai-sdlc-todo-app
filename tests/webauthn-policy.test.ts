import { describe, expect, it } from 'vitest'
import { isCounterValid } from '../lib/webauthn-policy'

describe('WebAuthn authenticator counter policy', () => {
  it('allows authenticators that always report a zero counter', () => {
    expect(isCounterValid(0, 0)).toBe(true)
    expect(isCounterValid(undefined, undefined)).toBe(true)
  })

  it('accepts a strictly increasing counter', () => {
    expect(isCounterValid(4, 5)).toBe(true)
  })

  it('rejects stale or non-increasing non-zero counters', () => {
    expect(isCounterValid(4, 4)).toBe(false)
    expect(isCounterValid(5, 4)).toBe(false)
    expect(isCounterValid(undefined, 0)).toBe(true)
  })
})
