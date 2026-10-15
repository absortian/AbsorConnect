import { describe, it, expect } from 'vitest'
import {
  clearFailures,
  isLocked,
  LOCK_MS,
  lockRemainingSeconds,
  MAX_FAILURES,
  registerFailure
} from '../lockout'

const t0 = 1_000_000_000_000

describe('lockout', () => {
  it('bloquea al quinto fallo seguido en la ventana', () => {
    let state = { failures: [] as number[], lockedUntil: null as number | null }
    for (let i = 0; i < MAX_FAILURES - 1; i++) state = registerFailure(state, t0 + i * 1000)
    expect(isLocked(state, t0 + 4000)).toBe(false)
    state = registerFailure(state, t0 + 4000)
    expect(isLocked(state, t0 + 4000)).toBe(true)
  })

  it('el bloqueo dura 15 minutos', () => {
    let state = { failures: [], lockedUntil: null }
    for (let i = 0; i < MAX_FAILURES; i++) state = registerFailure(state, t0)
    expect(isLocked(state, t0 + LOCK_MS - 1)).toBe(true)
    expect(isLocked(state, t0 + LOCK_MS)).toBe(false)
    expect(lockRemainingSeconds(state, t0)).toBe(LOCK_MS / 1000)
  })

  it('los fallos fuera de la ventana de 15 min no cuentan', () => {
    let state = { failures: [], lockedUntil: null }
    // cuatro fallos muy antiguos
    for (let i = 0; i < 4; i++) state = registerFailure(state, t0)
    // uno nuevo 20 min después: los antiguos ya no cuentan, no debe bloquear
    state = registerFailure(state, t0 + 20 * 60_000)
    expect(isLocked(state, t0 + 20 * 60_000)).toBe(false)
    expect(state.failures.length).toBe(1)
  })

  it('un acceso correcto reinicia fallos y bloqueo', () => {
    const cleared = clearFailures()
    expect(cleared.failures).toEqual([])
    expect(cleared.lockedUntil).toBeNull()
  })
})
