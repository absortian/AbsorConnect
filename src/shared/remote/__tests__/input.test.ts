import { describe, it, expect } from 'vitest'
import { MAX_TEXT_LENGTH, parseInputEvent } from '../input'

describe('parseInputEvent', () => {
  it('acepta cada tipo con sus campos', () => {
    expect(parseInputEvent({ v: 1, type: 'move', x: 0.25, y: 0.5 })).toEqual({
      type: 'move',
      x: 0.25,
      y: 0.5
    })
    expect(parseInputEvent({ type: 'button', button: 2, down: true })).toEqual({
      type: 'button',
      button: 'right',
      down: true
    })
    expect(parseInputEvent({ type: 'wheel', dx: 0, dy: 3, mode: 1 })).toEqual({
      type: 'wheel',
      dx: 0,
      dy: 3,
      mode: 1
    })
    expect(parseInputEvent({ type: 'key', code: 'Semicolon', down: false })).toEqual({
      type: 'key',
      code: 'Semicolon',
      down: false
    })
    expect(parseInputEvent({ type: 'text', text: '¿Año 2026? €' })).toEqual({
      type: 'text',
      text: '¿Año 2026? €'
    })
    expect(parseInputEvent({ type: 'release-all' })).toEqual({ type: 'release-all' })
  })

  it('recorta la posición a la pantalla y la rueda a un máximo', () => {
    expect(parseInputEvent({ type: 'move', x: -0.5, y: 7 })).toEqual({ type: 'move', x: 0, y: 1 })
    const wheel = parseInputEvent({ type: 'wheel', dx: -1e9, dy: 1e9 })
    expect(wheel).toEqual({ type: 'wheel', dx: -10_000, dy: 10_000, mode: 0 })
  })

  it('descarta tipos desconocidos y campos inválidos', () => {
    const invalid: unknown[] = [
      null,
      'move',
      [],
      { type: 'teleport' },
      { type: 'move', x: Number.NaN, y: 0 },
      { type: 'move', x: '0.5', y: 0 },
      { type: 'button', button: 5, down: true },
      { type: 'button', button: 'left', down: true },
      { type: 'button', button: 0 },
      { type: 'wheel', dx: 0, dy: Infinity },
      { type: 'wheel', dx: 0, dy: 1, mode: 3 },
      { type: 'key', code: '', down: true },
      { type: 'key', code: 'K'.repeat(33), down: true },
      { type: 'key', code: 'KeyA', down: 'yes' },
      { type: 'text', text: 42 },
      { type: 'text', text: 'x'.repeat(MAX_TEXT_LENGTH + 1) }
    ]
    for (const raw of invalid) expect(parseInputEvent(raw), JSON.stringify(raw)).toBeNull()
  })
})
