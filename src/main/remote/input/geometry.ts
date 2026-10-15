// Conversión de las posiciones normalizadas del protocolo (0–1 sobre la pantalla elegida) a las
// coordenadas que espera cada sistema (add-remote-desktop D10):
//   - Windows: píxeles físicos del escritorio virtual (Electron da el rectángulo físico de cada
//     pantalla con `screen.dipToScreenRect`, también con escalas distintas por monitor);
//   - Linux X11: píxeles físicos (DIP × escala, la misma para todas las pantallas);
//   - macOS: puntos globales, que son los mismos DIP de Electron.

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Punto nativo para una posición normalizada dentro del rectángulo nativo de la pantalla. Se
 * queda siempre dentro de la pantalla: 1 cae en el último píxel, no en la pantalla de al lado.
 */
export function pointInRect(nx: number, ny: number, rect: Rect): Point {
  return {
    x: clamp(rect.x + clamp(nx, 0, 1) * rect.width, rect.x, rect.x + rect.width - 1),
    y: clamp(rect.y + clamp(ny, 0, 1) * rect.height, rect.y, rect.y + rect.height - 1)
  }
}

/** Rectángulo físico (X11) a partir de los DIP y la escala de Electron. */
export function scaleRect(rect: Rect, scaleFactor: number): Rect {
  return {
    x: Math.round(rect.x * scaleFactor),
    y: Math.round(rect.y * scaleFactor),
    width: Math.round(rect.width * scaleFactor),
    height: Math.round(rect.height * scaleFactor)
  }
}

/**
 * Coordenada absoluta de SendInput (0–65535 sobre el escritorio virtual) para un píxel físico.
 * Windows la convierte en píxel como `floor(valor × tamaño / 65536)`, así que se redondea hacia
 * arriba para que el resultado sea exactamente ese píxel (con `/ (tamaño − 1)` se queda uno antes).
 */
export function windowsAbsolute(pixel: number, origin: number, size: number): number {
  const offset = clamp(Math.round(pixel) - origin, 0, size - 1)
  return Math.min(65535, Math.ceil((offset * 65536) / size))
}
