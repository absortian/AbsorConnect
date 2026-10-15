// Eventos de entrada del protocolo v1 (add-remote-desktop D9): canal `pointer` (`move`) y canal
// `input` (el resto). Los comparten el visor, la app móvil y el PC controlado. El PC los vuelve a
// validar en el proceso principal con `parseInputEvent()`: el renderer `host` no es de fiar.
//
//   - `move {x, y}`: posición normalizada (0–1) sobre la pantalla elegida.
//   - `button {button, down}`: `button` es el número de `MouseEvent.button` (0 izquierdo,
//     1 central, 2 derecho, 3 atrás, 4 adelante). El doble clic son dos pulsaciones seguidas.
//   - `wheel {dx, dy, mode}`: como `WheelEvent` (`dy > 0` baja; `mode` es `deltaMode`).
//   - `key {code, down}`: `KeyboardEvent.code`, es decir, la posición física (keymap.ts).
//   - `text {text}`: texto tal cual (teclado del móvil); los saltos de línea y tabuladores se
//     escriben como Intro y Tab.
//   - `release-all`: soltar todas las teclas y botones (el visor pierde el foco).

export type MouseButton = 'left' | 'middle' | 'right' | 'back' | 'forward'

/** `WheelEvent.deltaMode`: píxeles, líneas o páginas. */
export type WheelMode = 0 | 1 | 2

export type InputEvent =
  | { type: 'move'; x: number; y: number }
  | { type: 'button'; button: MouseButton; down: boolean }
  | { type: 'wheel'; dx: number; dy: number; mode: WheelMode }
  | { type: 'key'; code: string; down: boolean }
  | { type: 'text'; text: string }
  | { type: 'release-all' }

/** Botones por su número de `MouseEvent.button`. */
export const MOUSE_BUTTONS: readonly MouseButton[] = ['left', 'middle', 'right', 'back', 'forward']

/** Texto máximo por mensaje `text`: el teclado del móvil envía poco cada vez. */
export const MAX_TEXT_LENGTH = 4096

/** Desplazamiento máximo por mensaje `wheel`, en las unidades de `mode`. */
const MAX_WHEEL_DELTA = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Valida un mensaje de entrada recibido. Devuelve null si el tipo es desconocido o algún campo no
 * es válido (D9: los tipos desconocidos se ignoran). Las posiciones se recortan a 0–1.
 */
export function parseInputEvent(raw: unknown): InputEvent | null {
  if (!isRecord(raw)) return null
  switch (raw.type) {
    case 'move':
      if (!finite(raw.x) || !finite(raw.y)) return null
      return { type: 'move', x: clamp(raw.x, 0, 1), y: clamp(raw.y, 0, 1) }
    case 'button': {
      const button = typeof raw.button === 'number' ? MOUSE_BUTTONS[raw.button] : undefined
      if (button === undefined || typeof raw.down !== 'boolean') return null
      return { type: 'button', button, down: raw.down }
    }
    case 'wheel': {
      if (!finite(raw.dx) || !finite(raw.dy)) return null
      const mode = raw.mode ?? 0
      if (mode !== 0 && mode !== 1 && mode !== 2) return null
      return {
        type: 'wheel',
        dx: clamp(raw.dx, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA),
        dy: clamp(raw.dy, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA),
        mode
      }
    }
    case 'key':
      if (typeof raw.code !== 'string' || raw.code.length === 0 || raw.code.length > 32) return null
      if (typeof raw.down !== 'boolean') return null
      return { type: 'key', code: raw.code, down: raw.down }
    case 'text':
      if (typeof raw.text !== 'string' || raw.text.length > MAX_TEXT_LENGTH) return null
      return { type: 'text', text: raw.text }
    case 'release-all':
      return { type: 'release-all' }
    default:
      return null
  }
}
