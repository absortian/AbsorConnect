import { describe, it, expect } from 'vitest'
import { parseControllerMessage } from '../protocol'

describe('parseControllerMessage', () => {
  it('acepta auth, select-display y bye, como texto JSON o ya parseados', () => {
    expect(parseControllerMessage('{"v":1,"type":"auth","proof":"abc="}')).toEqual({
      v: 1,
      type: 'auth',
      proof: 'abc='
    })
    expect(parseControllerMessage({ v: 1, type: 'select-display', id: '2' })).toEqual({
      v: 1,
      type: 'select-display',
      id: '2'
    })
    expect(parseControllerMessage({ type: 'bye' })).toEqual({ v: 1, type: 'bye', reason: 'closed' })
  })

  it('descarta tipos desconocidos, JSON roto y campos que no valen', () => {
    for (const raw of [
      'no es json',
      '[]',
      null,
      { type: 'hello' },
      { type: 'auth' },
      { type: 'auth', proof: 42 },
      { type: 'auth', proof: 'x'.repeat(257) },
      { type: 'select-display', id: 3 }
    ]) {
      expect(parseControllerMessage(raw), JSON.stringify(raw)).toBeNull()
    }
  })

  it('recorta el motivo de bye', () => {
    const bye = parseControllerMessage({ type: 'bye', reason: 'x'.repeat(100) })
    expect(bye?.type === 'bye' && bye.reason.length).toBe(64)
  })
})
