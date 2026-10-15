// Entrada en Windows con SendInput (user32.dll) por koffi (add-remote-desktop D10):
//   - ratón absoluto sobre el escritorio virtual (MOUSEEVENTF_VIRTUALDESK), en píxeles físicos;
//   - teclas por scancode (KEYEVENTF_SCANCODE), así que manda la distribución del PC;
//   - texto con KEYEVENTF_UNICODE, una pulsación por unidad UTF-16.
// UIPI impide actuar sobre ventanas elevadas (administrador), y SendInput no avisa del bloqueo.
import koffi, { LibraryHandle } from 'koffi'
import { MouseButton } from '../../../shared/remote/input'
import { windowsScancode } from '../../../shared/remote/keymap'
import { InputBackend } from './controller'
import { windowsAbsolute } from './geometry'
import { WHEEL_NOTCH_PX, WheelAccumulator } from './wheel'

const INPUT_MOUSE = 0
const INPUT_KEYBOARD = 1

const MOUSEEVENTF_MOVE = 0x0001
const MOUSEEVENTF_WHEEL = 0x0800
const MOUSEEVENTF_HWHEEL = 0x1000
const MOUSEEVENTF_VIRTUALDESK = 0x4000
const MOUSEEVENTF_ABSOLUTE = 0x8000

/** Marcas de pulsar y soltar, y `mouseData` (XBUTTON1/2 para atrás y adelante). */
const BUTTON_FLAGS: Record<MouseButton, { down: number; up: number; data: number }> = {
  left: { down: 0x0002, up: 0x0004, data: 0 },
  right: { down: 0x0008, up: 0x0010, data: 0 },
  middle: { down: 0x0020, up: 0x0040, data: 0 },
  back: { down: 0x0080, up: 0x0100, data: 1 },
  forward: { down: 0x0080, up: 0x0100, data: 2 }
}

const KEYEVENTF_EXTENDEDKEY = 0x0001
const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004
const KEYEVENTF_SCANCODE = 0x0008

/** Unidades de rueda de Windows por clic. */
const WHEEL_DELTA = 120

/** Pausa no tiene scancode propio (0x45 es Bloq Num): va por su tecla virtual. */
const VK_PAUSE = 0x13

const SM_XVIRTUALSCREEN = 76
const SM_YVIRTUALSCREEN = 77
const SM_CXVIRTUALSCREEN = 78
const SM_CYVIRTUALSCREEN = 79

interface MouseInput {
  dx?: number
  dy?: number
  mouseData?: number
  dwFlags: number
}

interface KeyboardInput {
  wVk?: number
  wScan?: number
  dwFlags: number
}

interface Native {
  inputSize: number
  SendInput: ReturnType<LibraryHandle['func']>
  GetSystemMetrics: ReturnType<LibraryHandle['func']>
}

let native: Native | null = null

// koffi registra los tipos por nombre en todo el proceso: se cargan una sola vez
function loadNative(): Native {
  const user32 = koffi.load('user32.dll')
  const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
    dx: 'long',
    dy: 'long',
    // DWORD con signo en la rueda (hacia abajo es negativo): mismo tamaño que uint32
    mouseData: 'int32',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr'
  })
  const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
    wVk: 'uint16',
    wScan: 'uint16',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uintptr'
  })
  const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', {
    uMsg: 'uint32',
    wParamL: 'uint16',
    wParamH: 'uint16'
  })
  const INPUT = koffi.struct('INPUT', {
    type: 'uint32',
    u: koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT })
  })
  return {
    inputSize: koffi.sizeof(INPUT),
    SendInput: user32.func(
      'uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)'
    ),
    GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int nIndex)')
  }
}

function mouse(mi: MouseInput): object {
  return {
    type: INPUT_MOUSE,
    u: { mi: { dx: 0, dy: 0, mouseData: 0, time: 0, dwExtraInfo: 0, ...mi } }
  }
}

function keyboard(ki: KeyboardInput): object {
  return { type: INPUT_KEYBOARD, u: { ki: { wVk: 0, wScan: 0, time: 0, dwExtraInfo: 0, ...ki } } }
}

export function createWindowsBackend(): InputBackend {
  native ??= loadNative()
  const w = native
  const vertical = new WheelAccumulator(WHEEL_NOTCH_PX / WHEEL_DELTA)
  const horizontal = new WheelAccumulator(WHEEL_NOTCH_PX / WHEEL_DELTA)

  function send(inputs: object[]): void {
    if (inputs.length > 0) w.SendInput(inputs.length, inputs, w.inputSize)
  }

  return {
    move(point) {
      const vx = w.GetSystemMetrics(SM_XVIRTUALSCREEN)
      const vy = w.GetSystemMetrics(SM_YVIRTUALSCREEN)
      const vw = w.GetSystemMetrics(SM_CXVIRTUALSCREEN)
      const vh = w.GetSystemMetrics(SM_CYVIRTUALSCREEN)
      send([
        mouse({
          dx: windowsAbsolute(point.x, vx, vw),
          dy: windowsAbsolute(point.y, vy, vh),
          dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK
        })
      ])
    },

    button(button, down) {
      const flags = BUTTON_FLAGS[button]
      send([mouse({ mouseData: flags.data, dwFlags: down ? flags.down : flags.up })])
    },

    wheel(dx, dy) {
      // En Windows la rueda hacia delante (subir) es positiva; la horizontal, a la derecha
      const v = vertical.add(dy)
      const h = horizontal.add(dx)
      const inputs: object[] = []
      if (v !== 0) inputs.push(mouse({ mouseData: -v, dwFlags: MOUSEEVENTF_WHEEL }))
      if (h !== 0) inputs.push(mouse({ mouseData: h, dwFlags: MOUSEEVENTF_HWHEEL }))
      send(inputs)
    },

    key(code, down) {
      const up = down ? 0 : KEYEVENTF_KEYUP
      if (code === 'Pause') {
        send([keyboard({ wVk: VK_PAUSE, dwFlags: up })])
        return true
      }
      const scan = windowsScancode(code)
      if (!scan) return false
      const extended = scan.extended ? KEYEVENTF_EXTENDEDKEY : 0
      send([keyboard({ wScan: scan.scancode, dwFlags: KEYEVENTF_SCANCODE | extended | up })])
      return true
    },

    async text(text) {
      const inputs: object[] = []
      for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i)
        inputs.push(keyboard({ wScan: unit, dwFlags: KEYEVENTF_UNICODE }))
        inputs.push(keyboard({ wScan: unit, dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP }))
      }
      send(inputs)
    },

    dispose() {
      // Nada que liberar: user32.dll sigue cargada para la próxima sesión
    }
  }
}
