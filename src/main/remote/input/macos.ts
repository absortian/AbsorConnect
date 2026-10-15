// Entrada en macOS con eventos de CoreGraphics por koffi (add-remote-desktop D10), publicados en
// `kCGHIDEventTap` en puntos globales (los DIP de Electron):
//   - el ratón se mueve con eventos de "arrastre" mientras hay un botón pulsado (si no, las apps
//     no ven el arrastre), y cada pulsación lleva su número de clic (clicks.ts);
//   - teclas por código virtual (kVK_*) con las marcas de los modificadores pulsados
//     (modifiers.ts);
//   - texto con CGEventKeyboardSetUnicodeString, en trozos de 20 unidades UTF-16.
// Sin el permiso de Accesibilidad, macOS descarta los eventos sin dar ningún error (tarea 4.7).
import koffi, { LibraryHandle } from 'koffi'
import { MouseButton } from '../../../shared/remote/input'
import { macVirtualKey } from '../../../shared/remote/keymap'
import { ClickCounter } from './clicks'
import { InputBackend } from './controller'
import { Point } from './geometry'
import { isModifierCode, macModifierFlags } from './modifiers'
import { chunkUtf16 } from './text'
import { WheelAccumulator } from './wheel'

const kCGHIDEventTap = 0
const kCGMouseEventClickState = 1
const kCGScrollEventUnitPixel = 0
const MAX_UNICODE_PER_EVENT = 20

/** Tipos de evento (`CGEventType`) y botón de CoreGraphics de cada botón. */
const MOUSE_EVENTS: Record<MouseButton, { down: number; up: number; drag: number; cg: number }> = {
  left: { down: 1, up: 2, drag: 6, cg: 0 },
  right: { down: 3, up: 4, drag: 7, cg: 1 },
  middle: { down: 25, up: 26, drag: 27, cg: 2 },
  back: { down: 25, up: 26, drag: 27, cg: 3 },
  forward: { down: 25, up: 26, drag: 27, cg: 4 }
}
const kCGEventMouseMoved = 5

/** Orden en que se elige el tipo de arrastre si hay varios botones pulsados. */
const DRAG_PRIORITY: MouseButton[] = ['left', 'right', 'middle', 'back', 'forward']

type NativeFunction = ReturnType<LibraryHandle['func']>
type Native = Record<
  | 'CGEventCreate'
  | 'CGEventGetLocation'
  | 'CGEventCreateMouseEvent'
  | 'CGEventCreateKeyboardEvent'
  | 'CGEventKeyboardSetUnicodeString'
  | 'CGEventCreateScrollWheelEvent'
  | 'CGEventSetIntegerValueField'
  | 'CGEventSetFlags'
  | 'CGEventPost'
  | 'CFRelease',
  NativeFunction
>

let native: Native | null = null

// koffi registra los tipos por nombre en todo el proceso: se cargan una sola vez
function loadNative(): Native {
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  koffi.struct('CGPoint', { x: 'double', y: 'double' })
  return {
    CGEventCreate: cg.func('void *CGEventCreate(void *source)'),
    CGEventGetLocation: cg.func('CGPoint CGEventGetLocation(void *event)'),
    CGEventCreateMouseEvent: cg.func(
      'void *CGEventCreateMouseEvent(void *source, uint32_t type, CGPoint position, uint32_t button)'
    ),
    CGEventCreateKeyboardEvent: cg.func(
      'void *CGEventCreateKeyboardEvent(void *source, uint16_t keycode, bool keyDown)'
    ),
    CGEventKeyboardSetUnicodeString: cg.func(
      'void CGEventKeyboardSetUnicodeString(void *event, unsigned long length, const uint16_t *text)'
    ),
    CGEventCreateScrollWheelEvent: cg.func(
      'void *CGEventCreateScrollWheelEvent(void *source, uint32_t units, uint32_t wheelCount, int32_t wheel1, ...)'
    ),
    CGEventSetIntegerValueField: cg.func(
      'void CGEventSetIntegerValueField(void *event, uint32_t field, int64_t value)'
    ),
    CGEventSetFlags: cg.func('void CGEventSetFlags(void *event, uint64_t flags)'),
    CGEventPost: cg.func('void CGEventPost(uint32_t tap, void *event)'),
    CFRelease: cf.func('void CFRelease(void *cf)')
  }
}

export function createMacBackend(): InputBackend {
  native ??= loadNative()
  const m = native
  const buttons = new Set<MouseButton>()
  const modifiers = new Set<string>()
  const clicks = new ClickCounter()
  const vertical = new WheelAccumulator(1)
  const horizontal = new WheelAccumulator(1)
  let position: Point | null = null

  function post(event: unknown): void {
    if (!event) return
    m.CGEventSetFlags(event, macModifierFlags(modifiers))
    m.CGEventPost(kCGHIDEventTap, event)
    m.CFRelease(event)
  }

  function currentPosition(): Point {
    if (position) return position
    const event = m.CGEventCreate(null)
    const location = m.CGEventGetLocation(event) as Point
    m.CFRelease(event)
    return location
  }

  return {
    move(point) {
      position = point
      const dragging = DRAG_PRIORITY.find((button) => buttons.has(button))
      const type = dragging ? MOUSE_EVENTS[dragging].drag : kCGEventMouseMoved
      const cgButton = dragging ? MOUSE_EVENTS[dragging].cg : 0
      post(m.CGEventCreateMouseEvent(null, type, point, cgButton))
    },

    button(button, down) {
      const point = currentPosition()
      const spec = MOUSE_EVENTS[button]
      const count = down ? clicks.press(button, point, Date.now()) : clicks.current(button)
      if (down) buttons.add(button)
      else buttons.delete(button)
      const event = m.CGEventCreateMouseEvent(null, down ? spec.down : spec.up, point, spec.cg)
      if (event) m.CGEventSetIntegerValueField(event, kCGMouseEventClickState, count)
      post(event)
    },

    wheel(dx, dy) {
      // En CoreGraphics el desplazamiento positivo va hacia arriba y hacia la izquierda
      const v = vertical.add(dy)
      const h = horizontal.add(dx)
      if (v === 0 && h === 0) return
      post(m.CGEventCreateScrollWheelEvent(null, kCGScrollEventUnitPixel, 2, -v, 'int32_t', -h))
    },

    key(code, down) {
      const keycode = macVirtualKey(code)
      if (keycode === undefined) return false
      if (isModifierCode(code)) {
        if (down) modifiers.add(code)
        else modifiers.delete(code)
      }
      post(m.CGEventCreateKeyboardEvent(null, keycode, down))
      return true
    },

    async text(text) {
      for (const chunk of chunkUtf16(text, MAX_UNICODE_PER_EVENT)) {
        const units = new Uint16Array(chunk.length)
        for (let i = 0; i < chunk.length; i++) units[i] = chunk.charCodeAt(i)
        for (const down of [true, false]) {
          const event = m.CGEventCreateKeyboardEvent(null, 0, down)
          if (!event) continue
          m.CGEventKeyboardSetUnicodeString(event, units.length, units)
          // Sin modificadores: con Cmd pulsado, el texto se tomaría por un atajo
          m.CGEventSetFlags(event, 0)
          m.CGEventPost(kCGHIDEventTap, event)
          m.CFRelease(event)
        }
      }
    },

    dispose() {
      // Nada que liberar: cada evento se libera al publicarlo
    }
  }
}
