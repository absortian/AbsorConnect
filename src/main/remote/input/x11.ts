// Entrada en Linux X11 con XTest (libXtst + libX11) por koffi (add-remote-desktop D10):
//   - ratón en píxeles físicos de la ventana raíz, botones 1–3 y 8–9, rueda con los botones 4–7;
//   - teclas por posición física (keycode = evdev + 8), con la repetición automática de X
//     desactivada mientras se pulsan: la repetición la manda el controlador, y si la red retrasa el
//     soltar no se escriben cientos de letras;
//   - texto con keycodes libres reasignados a cada carácter (scratchKeys.ts).
import koffi, { LibraryHandle } from 'koffi'
import { MouseButton } from '../../../shared/remote/input'
import { x11Keycode } from '../../../shared/remote/keymap'
import { InputBackend } from './controller'
import { isModifierCode } from './modifiers'
import { freeKeycodes, ScratchKeycodes } from './scratchKeys'
import { keysymForCodePoint } from './text'
import { WHEEL_NOTCH_PX, WheelAccumulator } from './wheel'

const X_BUTTONS: Record<MouseButton, number> = { left: 1, middle: 2, right: 3, back: 8, forward: 9 }
const WHEEL_UP = 4
const WHEEL_DOWN = 5
const WHEEL_LEFT = 6
const WHEEL_RIGHT = 7
/** Clics de rueda como mucho por mensaje, por si llega un delta enorme. */
const MAX_WHEEL_CLICKS = 50

const KB_KEY = 1 << 6
const KB_AUTO_REPEAT_MODE = 1 << 7
const AUTO_REPEAT_MODE_OFF = 0
const AUTO_REPEAT_MODE_DEFAULT = 2
/** Las teclas de bloqueo no repiten: no se toca su repetición. */
const LOCK_CODES = new Set(['CapsLock', 'NumLock', 'ScrollLock'])

/** Tiempo sin escribir tras el que los keycodes reasignados vuelven a estar vacíos. */
const SCRATCH_IDLE_RESTORE_MS = 2000
/** Espera entre reasignar keycodes y pulsarlos, para que las apps tengan el mapa nuevo. */
const SCRATCH_SETTLE_MS = 50
/**
 * Pausa entre caracteres del texto. Con IBus (y otros métodos de entrada asíncronos), las
 * pulsaciones seguidas se desordenan: medido con "¿Año 2026? €" en Chromium, el "€" se adelanta
 * en 5 de 8 intentos sin pausa y en ninguno con 1 ms. xdotool usa 12 ms por lo mismo.
 */
const TEXT_KEY_GAP_MS = 5

type NativeFunction = ReturnType<LibraryHandle['func']>
type Native = Record<
  | 'XOpenDisplay'
  | 'XCloseDisplay'
  | 'XFlush'
  | 'XSync'
  | 'XFree'
  | 'XDisplayKeycodes'
  | 'XGetKeyboardMapping'
  | 'XChangeKeyboardMapping'
  | 'XChangeKeyboardControl'
  | 'XTestFakeMotionEvent'
  | 'XTestFakeButtonEvent'
  | 'XTestFakeKeyEvent',
  NativeFunction
>

let native: Native | null = null

// koffi registra los tipos por nombre en todo el proceso: se cargan una sola vez
function loadNative(): Native {
  const x11 = koffi.load('libX11.so.6')
  const xtst = koffi.load('libXtst.so.6')
  koffi.struct('XKeyboardControl', {
    key_click_percent: 'int',
    bell_percent: 'int',
    bell_pitch: 'int',
    bell_duration: 'int',
    led: 'int',
    led_mode: 'int',
    key: 'int',
    auto_repeat_mode: 'int'
  })
  return {
    XOpenDisplay: x11.func('void *XOpenDisplay(const char *name)'),
    XCloseDisplay: x11.func('int XCloseDisplay(void *display)'),
    XFlush: x11.func('int XFlush(void *display)'),
    XSync: x11.func('int XSync(void *display, int discard)'),
    XFree: x11.func('int XFree(void *data)'),
    XDisplayKeycodes: x11.func(
      'int XDisplayKeycodes(void *display, _Out_ int *minKeycode, _Out_ int *maxKeycode)'
    ),
    XGetKeyboardMapping: x11.func(
      'void *XGetKeyboardMapping(void *display, uint8_t first, int count, _Out_ int *perKeycode)'
    ),
    XChangeKeyboardMapping: x11.func(
      'int XChangeKeyboardMapping(void *display, int first, int perKeycode, unsigned long *keysyms, int count)'
    ),
    XChangeKeyboardControl: x11.func(
      'int XChangeKeyboardControl(void *display, unsigned long mask, XKeyboardControl *values)'
    ),
    XTestFakeMotionEvent: xtst.func(
      'int XTestFakeMotionEvent(void *display, int screen, int x, int y, unsigned long delay)'
    ),
    XTestFakeButtonEvent: xtst.func(
      'int XTestFakeButtonEvent(void *display, unsigned int button, int press, unsigned long delay)'
    ),
    XTestFakeKeyEvent: xtst.func(
      'int XTestFakeKeyEvent(void *display, unsigned int keycode, int press, unsigned long delay)'
    )
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createX11Backend(): InputBackend {
  native ??= loadNative()
  const x = native
  const display = x.XOpenDisplay(null)
  if (!display) throw new Error('XOpenDisplay failed (no X11 session)')

  // Un keycode fuera de este rango es un error de X, y el gestor de errores por defecto de Xlib
  // termina el proceso: se comprueba antes de cada tecla
  const min = [0]
  const max = [0]
  x.XDisplayKeycodes(display, min, max)
  const [minKeycode, maxKeycode] = [min[0], max[0]]

  const scratch = new ScratchKeycodes(findFreeKeycodes())
  const pressed = new Set<number>()
  const vertical = new WheelAccumulator(WHEEL_NOTCH_PX)
  const horizontal = new WheelAccumulator(WHEEL_NOTCH_PX)
  let restoreTimer: NodeJS.Timeout | null = null

  function findFreeKeycodes(): number[] {
    const count = maxKeycode - minKeycode + 1
    const perKeycode = [0]
    const mapping = x.XGetKeyboardMapping(display, minKeycode, count, perKeycode)
    if (!mapping) return []
    try {
      // koffi devuelve un BigUint64Array: se pasa a números para compararlos con 0
      const raw = koffi.decode(mapping, 'unsigned long', count * perKeycode[0]) as ArrayLike<bigint>
      return freeKeycodes(Array.from(raw, Number), perKeycode[0], minKeycode)
    } finally {
      x.XFree(mapping)
    }
  }

  function setAutoRepeat(keycode: number, mode: number): void {
    const values = {
      key_click_percent: 0,
      bell_percent: 0,
      bell_pitch: 0,
      bell_duration: 0,
      led: 0,
      led_mode: 0,
      key: keycode,
      auto_repeat_mode: mode
    }
    x.XChangeKeyboardControl(display, KB_KEY | KB_AUTO_REPEAT_MODE, values)
  }

  function remap(keycode: number, keysym: number): void {
    // El mismo keysym sin y con Mayúsculas: el carácter sale igual con Mayús o Bloq Mayús
    x.XChangeKeyboardMapping(display, keycode, 2, [keysym, keysym], 1)
    x.XSync(display, 0)
  }

  function restoreScratch(): void {
    if (restoreTimer) clearTimeout(restoreTimer)
    restoreTimer = null
    for (const keycode of scratch.release()) remap(keycode, 0)
  }

  function clickWheel(button: number, clicks: number): void {
    for (let i = 0; i < Math.min(clicks, MAX_WHEEL_CLICKS); i++) {
      x.XTestFakeButtonEvent(display, button, 1, 0)
      x.XTestFakeButtonEvent(display, button, 0, 0)
    }
  }

  return {
    move(point) {
      x.XTestFakeMotionEvent(display, -1, Math.round(point.x), Math.round(point.y), 0)
      x.XFlush(display)
    },

    button(button, down) {
      x.XTestFakeButtonEvent(display, X_BUTTONS[button], down ? 1 : 0, 0)
      x.XFlush(display)
    },

    wheel(dx, dy) {
      const v = vertical.add(dy)
      const h = horizontal.add(dx)
      clickWheel(v > 0 ? WHEEL_DOWN : WHEEL_UP, Math.abs(v))
      clickWheel(h > 0 ? WHEEL_RIGHT : WHEEL_LEFT, Math.abs(h))
      x.XFlush(display)
    },

    key(code, down) {
      const keycode = x11Keycode(code)
      if (keycode === undefined || keycode < minKeycode || keycode > maxKeycode) return false
      if (down) {
        if (pressed.has(keycode)) {
          // Repetición del controlador: un modificador no repite, y una tecla normal se suelta
          // antes para que X la cuente como otra pulsación
          if (isModifierCode(code)) return true
          x.XTestFakeKeyEvent(display, keycode, 0, 0)
        } else if (!LOCK_CODES.has(code)) {
          setAutoRepeat(keycode, AUTO_REPEAT_MODE_OFF)
        }
        pressed.add(keycode)
        x.XTestFakeKeyEvent(display, keycode, 1, 0)
      } else {
        x.XTestFakeKeyEvent(display, keycode, 0, 0)
        if (pressed.delete(keycode) && !LOCK_CODES.has(code)) {
          setAutoRepeat(keycode, AUTO_REPEAT_MODE_DEFAULT)
        }
      }
      x.XFlush(display)
      return true
    },

    async text(text) {
      if (scratch.size === 0) throw new Error('No free X11 keycode to type text')
      if (restoreTimer) clearTimeout(restoreTimer)
      const keysyms = Array.from(text, (char) => keysymForCodePoint(char.codePointAt(0) ?? 0))
      let next = 0
      while (next < keysyms.length) {
        // Se reasignan de una vez los keycodes de todos los caracteres que caben, y se espera a
        // que las apps lean el mapa nuevo antes de pulsar (Chromium lo pide de forma asíncrona y
        // sin esta espera pierde el primer carácter)
        const batch: number[] = []
        let remapped = false
        let waitMs = 0
        for (; next < keysyms.length; next++) {
          const plan = scratch.acquire(keysyms[next], Date.now())
          if ('waitMs' in plan) {
            waitMs = plan.waitMs
            break
          }
          if (plan.remap) {
            x.XChangeKeyboardMapping(display, plan.keycode, 2, [keysyms[next], keysyms[next]], 1)
            remapped = true
          }
          batch.push(plan.keycode)
        }
        if (remapped) {
          x.XSync(display, 0)
          await sleep(SCRATCH_SETTLE_MS)
        }
        for (const keycode of batch) {
          x.XTestFakeKeyEvent(display, keycode, 1, 0)
          x.XTestFakeKeyEvent(display, keycode, 0, 0)
          x.XFlush(display)
          await sleep(TEXT_KEY_GAP_MS)
        }
        if (waitMs > 0) await sleep(waitMs)
      }
      restoreTimer = setTimeout(restoreScratch, SCRATCH_IDLE_RESTORE_MS)
      restoreTimer.unref()
    },

    dispose() {
      restoreScratch()
      x.XCloseDisplay(display)
    }
  }
}
