import { describe, it, expect } from 'vitest'
import { freeKeycodes, ScratchKeycodes, SCRATCH_REUSE_MS } from '../scratchKeys'
import { chunkUtf16, keysymForCodePoint, splitText } from '../text'

describe('splitText', () => {
  it('el texto del móvil sale tal cual', () => {
    expect(splitText('¿Año 2026? €')).toEqual([{ kind: 'text', text: '¿Año 2026? €' }])
  })

  it('saltos de línea (\\n, \\r\\n, \\r) y tabuladores son teclas', () => {
    expect(splitText('a\r\nb\tc\rd\n')).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'key', code: 'Enter' },
      { kind: 'text', text: 'b' },
      { kind: 'key', code: 'Tab' },
      { kind: 'text', text: 'c' },
      { kind: 'key', code: 'Enter' },
      { kind: 'text', text: 'd' },
      { kind: 'key', code: 'Enter' }
    ])
  })

  it('descarta otros caracteres de control', () => {
    expect(splitText('a\u0000b\u0007\u007fc\u0085')).toEqual([{ kind: 'text', text: 'abc' }])
  })
})

describe('chunkUtf16 (macOS)', () => {
  it('no parte un emoji (par sustituto) entre dos eventos', () => {
    const text = 'abc😀def'
    const chunks = chunkUtf16(text, 4)
    expect(chunks.join('')).toBe(text)
    expect(chunks).toEqual(['abc', '😀de', 'f'])
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(4)
  })
})

describe('keysymForCodePoint (X11)', () => {
  it('Latin-1 conserva su valor y el resto usa el rango Unicode', () => {
    expect(keysymForCodePoint('A'.codePointAt(0)!)).toBe(0x41)
    expect(keysymForCodePoint('ñ'.codePointAt(0)!)).toBe(0xf1)
    expect(keysymForCodePoint('¿'.codePointAt(0)!)).toBe(0xbf)
    expect(keysymForCodePoint('€'.codePointAt(0)!)).toBe(0x10020ac)
    expect(keysymForCodePoint('😀'.codePointAt(0)!)).toBe(0x101f600)
  })
})

describe('keycodes libres de X11', () => {
  it('freeKeycodes: los que no tienen ningún keysym, sin el 8', () => {
    // Keycodes 8–12 con 2 keysyms cada uno: 8 y 10 vacíos, 12 vacío
    const mapping = [0, 0, 0x61, 0x41, 0, 0, 0x62, 0, 0, 0]
    expect(freeKeycodes(mapping, 2, 8)).toEqual([10, 12])
    expect(freeKeycodes(mapping, 2, 8, 1)).toEqual([10])
  })

  it('reutiliza el keycode de un carácter repetido sin reasignarlo', () => {
    const pool = new ScratchKeycodes([93, 97])
    expect(pool.acquire(0x61, 0)).toEqual({ keycode: 93, remap: true })
    expect(pool.acquire(0x62, 1)).toEqual({ keycode: 97, remap: true })
    expect(pool.acquire(0x61, 2)).toEqual({ keycode: 93, remap: false })
  })

  it('no reasigna un keycode a otro carácter hasta pasado el tiempo de reutilización', () => {
    const pool = new ScratchKeycodes([93, 97])
    pool.acquire(0x61, 0)
    pool.acquire(0x62, 100)
    // El más antiguo es el 93 (usado en 0): hay que esperar hasta 0 + SCRATCH_REUSE_MS
    expect(pool.acquire(0x63, 200)).toEqual({ waitMs: SCRATCH_REUSE_MS - 200 })
    expect(pool.acquire(0x63, SCRATCH_REUSE_MS)).toEqual({ keycode: 93, remap: true })
  })

  it('release devuelve los keycodes usados y los deja libres', () => {
    const pool = new ScratchKeycodes([93, 97, 103])
    pool.acquire(0x61, 0)
    pool.acquire(0x62, 0)
    expect(pool.release()).toEqual([93, 97])
    expect(pool.release()).toEqual([])
    expect(pool.acquire(0x61, 1)).toEqual({ keycode: 93, remap: true })
  })
})
