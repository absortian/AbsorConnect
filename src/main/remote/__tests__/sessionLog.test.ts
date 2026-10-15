import { describe, it, expect } from 'vitest'
import { appendLog, MAX_LOG_ENTRIES } from '../sessionLog'

describe('sessionLog', () => {
  it('añade al principio', () => {
    const log = appendLog(appendLog([], { at: 1, type: 'session-start' }), {
      at: 2,
      type: 'session-end'
    })
    expect(log.map((e) => e.at)).toEqual([2, 1])
  })

  it('conserva como mucho 50 eventos', () => {
    let log: ReturnType<typeof appendLog> = []
    for (let i = 0; i < 60; i++) log = appendLog(log, { at: i, type: 'auth-failed' })
    expect(log.length).toBe(MAX_LOG_ENTRIES)
    expect(log[0].at).toBe(59)
    expect(log[log.length - 1].at).toBe(10)
  })
})
