import { describe, it, expect } from 'vitest'
import { pointInRect, scaleRect, windowsAbsolute } from '../geometry'

describe('pointInRect', () => {
  const second = { x: 1920, y: 0, width: 2560, height: 1440 }

  it('lleva la posición normalizada a la pantalla elegida', () => {
    expect(pointInRect(0, 0, second)).toEqual({ x: 1920, y: 0 })
    expect(pointInRect(0.5, 0.5, second)).toEqual({ x: 3200, y: 720 })
  })

  it('el borde derecho e inferior caen en el último píxel, no en la pantalla de al lado', () => {
    expect(pointInRect(1, 1, second)).toEqual({ x: 1920 + 2559, y: 1439 })
  })

  it('pantallas a la izquierda o encima de la principal (coordenadas negativas)', () => {
    const left = { x: -1280, y: -200, width: 1280, height: 1024 }
    expect(pointInRect(0, 0, left)).toEqual({ x: -1280, y: -200 })
    expect(pointInRect(1, 1, left)).toEqual({ x: -1, y: 823 })
  })
})

describe('scaleRect (X11: DIP × escala)', () => {
  it('dos pantallas 4K al 200 %', () => {
    expect(scaleRect({ x: 1920, y: 0, width: 1920, height: 1080 }, 2)).toEqual({
      x: 3840,
      y: 0,
      width: 3840,
      height: 2160
    })
  })

  it('al 150 %', () => {
    expect(scaleRect({ x: 0, y: 0, width: 1280, height: 720 }, 1.5)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })
})

describe('windowsAbsolute (SendInput, 0–65535)', () => {
  // Cómo lo convierte Windows de vuelta a píxel
  const toPixel = (value: number, origin: number, size: number): number =>
    origin + Math.floor((value * size) / 65536)

  it('cada píxel vuelve exactamente a sí mismo', () => {
    for (const [origin, size] of [
      [0, 1920],
      [0, 1280],
      [-1920, 5760],
      [0, 3840 + 2880]
    ]) {
      for (let pixel = origin; pixel < origin + size; pixel++) {
        const value = windowsAbsolute(pixel, origin, size)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(65535)
        expect(toPixel(value, origin, size)).toBe(pixel)
      }
    }
  })

  it('fuera del escritorio virtual se queda en el borde', () => {
    expect(windowsAbsolute(-10, 0, 1920)).toBe(0)
    expect(toPixel(windowsAbsolute(5000, 0, 1920), 0, 1920)).toBe(1919)
  })
})
