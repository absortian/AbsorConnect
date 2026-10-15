import { describe, it, expect } from 'vitest'
import { ClickCounter } from '../clicks'
import { isModifierCode, macModifierFlags } from '../modifiers'
import { WHEEL_NOTCH_PX, WheelAccumulator, wheelPixels } from '../wheel'

describe('rueda', () => {
  it('líneas y páginas pasan a píxeles; un clic de rueda son tres líneas', () => {
    expect(wheelPixels(120, 0)).toBe(120)
    expect(wheelPixels(3, 1)).toBeCloseTo(WHEEL_NOTCH_PX)
    expect(wheelPixels(-1, 2)).toBe(-8 * WHEEL_NOTCH_PX)
  })

  it('acumula los deltas pequeños de un trackpad hasta completar un paso', () => {
    const notches = new WheelAccumulator(WHEEL_NOTCH_PX)
    expect(notches.add(40)).toBe(0)
    expect(notches.add(40)).toBe(0)
    expect(notches.add(40)).toBe(1)
    expect(notches.add(-20)).toBe(0) // quedaban 20: vuelve a 0
    expect(notches.add(-250)).toBe(-2)
  })

  it('Windows: un clic de rueda son 120 unidades', () => {
    const units = new WheelAccumulator(WHEEL_NOTCH_PX / 120)
    expect(units.add(WHEEL_NOTCH_PX)).toBe(120)
    expect(units.add(-WHEEL_NOTCH_PX / 2)).toBe(-60)
  })
})

describe('ClickCounter (macOS)', () => {
  it('dos pulsaciones seguidas en el mismo sitio son un doble clic, y tres un triple', () => {
    const clicks = new ClickCounter(500, 4)
    expect(clicks.press('left', { x: 100, y: 100 }, 0)).toBe(1)
    expect(clicks.current('left')).toBe(1)
    expect(clicks.press('left', { x: 102, y: 99 }, 200)).toBe(2)
    expect(clicks.current('left')).toBe(2)
    expect(clicks.press('left', { x: 101, y: 100 }, 400)).toBe(3)
  })

  it('demasiado tarde, lejos o con otro botón vuelve a 1', () => {
    const clicks = new ClickCounter(500, 4)
    clicks.press('left', { x: 0, y: 0 }, 0)
    expect(clicks.press('left', { x: 0, y: 0 }, 600)).toBe(1)
    expect(clicks.press('left', { x: 10, y: 0 }, 700)).toBe(1)
    expect(clicks.press('right', { x: 10, y: 0 }, 800)).toBe(1)
    expect(clicks.current('left')).toBe(1)
  })
})

describe('modificadores (macOS)', () => {
  it('Cmd+Mayús: marcas de Command y Shift; el izquierdo y el derecho dan la misma', () => {
    expect(macModifierFlags(['MetaLeft', 'ShiftRight'])).toBe(0x100000 | 0x20000)
    expect(macModifierFlags(['ControlLeft'])).toBe(macModifierFlags(['ControlRight']))
    expect(macModifierFlags(['AltRight', 'KeyC'])).toBe(0x80000)
    expect(macModifierFlags([])).toBe(0)
  })

  it('distingue los modificadores del resto de teclas', () => {
    expect(isModifierCode('ShiftLeft')).toBe(true)
    expect(isModifierCode('MetaRight')).toBe(true)
    expect(isModifierCode('CapsLock')).toBe(false)
    expect(isModifierCode('KeyA')).toBe(false)
  })
})
