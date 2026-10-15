import { describe, it, expect } from 'vitest'
import { KEY_MAP, macVirtualKey, windowsScancode, x11Keycode } from '../keymap'

describe('keymap — valores por sistema', () => {
  it('letras: KeyA', () => {
    expect(KEY_MAP.KeyA).toEqual({ evdev: 30, win: 30, mac: 0 })
    expect(x11Keycode('KeyA')).toBe(38) // evdev + 8
    expect(windowsScancode('KeyA')).toEqual({ scancode: 30, extended: false })
    expect(macVirtualKey('KeyA')).toBe(0)
  })

  it('Semicolon (la tecla de la Ñ en distribución española)', () => {
    expect(KEY_MAP.Semicolon).toEqual({ evdev: 39, win: 39, mac: 41 })
    expect(x11Keycode('Semicolon')).toBe(47)
    expect(windowsScancode('Semicolon')).toEqual({ scancode: 39, extended: false })
    expect(macVirtualKey('Semicolon')).toBe(41)
  })

  it('flechas: son teclas extendidas en Windows', () => {
    expect(windowsScancode('ArrowUp')).toEqual({ scancode: 72, extended: true })
    expect(windowsScancode('ArrowLeft')?.extended).toBe(true)
    expect(x11Keycode('ArrowUp')).toBe(111) // 103 + 8
    expect(macVirtualKey('ArrowUp')).toBe(126)
  })

  it('teclado numérico: Numpad1 (no extendida)', () => {
    expect(KEY_MAP.Numpad1).toEqual({ evdev: 79, win: 79, mac: 83 })
    expect(windowsScancode('Numpad1')).toEqual({ scancode: 79, extended: false })
    // NumpadEnter sí es extendida en Windows
    expect(windowsScancode('NumpadEnter')?.extended).toBe(true)
  })

  it('modificadores izquierdo y derecho se distinguen', () => {
    expect(windowsScancode('ControlLeft')).toEqual({ scancode: 29, extended: false })
    expect(windowsScancode('ControlRight')).toEqual({ scancode: 29, extended: true })
    expect(macVirtualKey('ControlLeft')).toBe(59)
    expect(macVirtualKey('ControlRight')).toBe(62)
    expect(x11Keycode('ControlLeft')).not.toBe(x11Keycode('ControlRight'))
    expect(macVirtualKey('ShiftLeft')).not.toBe(macVirtualKey('ShiftRight'))
  })

  it('teclas comunes presentes en los tres sistemas', () => {
    for (const code of ['Enter', 'Space', 'Tab', 'Escape', 'Backspace', 'KeyZ', 'Digit1', 'F1']) {
      const entry = KEY_MAP[code]
      expect(entry, code).toBeDefined()
      expect(entry.evdev, code).toBeGreaterThan(0)
      expect(entry.win, code).toBeGreaterThan(0)
      expect(entry.mac, code).toBeGreaterThanOrEqual(0)
    }
  })

  it('un code desconocido no tiene equivalente', () => {
    expect(x11Keycode('NoExiste')).toBeUndefined()
    expect(windowsScancode('NoExiste')).toBeUndefined()
    expect(macVirtualKey('NoExiste')).toBeUndefined()
  })
})
