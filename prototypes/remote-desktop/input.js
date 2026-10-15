// Movimiento del ratón con koffi en cada sistema (base de D10). Coordenadas de entrada en DIP de Electron.
const { screen } = require('electron')
const fs = require('fs')
const path = require('path')
const koffi = require('koffi')

function koffiInfo() {
  // koffi no exporta su package.json: se lee junto al fichero que resuelve require
  const resolved = require.resolve('koffi')
  const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(resolved), 'package.json'), 'utf-8'))
  return { version: pkg.version, resolved }
}

let impl = null
// Diagnóstico: puntos físicos enviados y lectura directa del puntero (solo X11)
const sentPhysical = []
let queryPointer = () => null

function linux() {
  const x11 = koffi.load('libX11.so.6')
  const xtst = koffi.load('libXtst.so.6')
  const XOpenDisplay = x11.func('void *XOpenDisplay(const char *name)')
  const XSync = x11.func('int XSync(void *display, int discard)')
  const XTestFakeMotionEvent = xtst.func('int XTestFakeMotionEvent(void *display, int screen, int x, int y, unsigned long delay)')
  const XDefaultRootWindow = x11.func('unsigned long XDefaultRootWindow(void *display)')
  const XQueryPointer = x11.func(
    'int XQueryPointer(void *d, unsigned long w, _Out_ unsigned long *root, _Out_ unsigned long *child, _Out_ int *rx, _Out_ int *ry, _Out_ int *wx, _Out_ int *wy, _Out_ unsigned int *mask)'
  )
  const display = XOpenDisplay(null)
  if (!display) throw new Error('XOpenDisplay failed (¿sesión sin X11?)')
  queryPointer = () => {
    const out = [[0], [0], [0], [0], [0], [0], [0]]
    XQueryPointer(display, XDefaultRootWindow(display), ...out)
    return { x: out[2][0], y: out[3][0] }
  }
  return (point) => {
    // X11 trabaja en píxeles físicos
    const physical = screen.dipToScreenPoint ? screen.dipToScreenPoint(point) : point
    sentPhysical.push(physical)
    XTestFakeMotionEvent(display, -1, Math.round(physical.x), Math.round(physical.y), 0)
    XSync(display, 0)
  }
}

function windows() {
  const user32 = koffi.load('user32.dll')
  const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
    dx: 'long',
    dy: 'long',
    mouseData: 'uint32',
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
  const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' })
  const INPUT = koffi.struct('INPUT', {
    type: 'uint32',
    u: koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT })
  })
  const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)')
  const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)')
  const SM_XVIRTUALSCREEN = 76
  const SM_YVIRTUALSCREEN = 77
  const SM_CXVIRTUALSCREEN = 78
  const SM_CYVIRTUALSCREEN = 79
  const MOUSEEVENTF_MOVE = 0x0001
  const MOUSEEVENTF_ABSOLUTE = 0x8000
  const MOUSEEVENTF_VIRTUALDESK = 0x4000
  return (point) => {
    // SendInput absoluto: 0–65535 sobre todo el escritorio virtual, en píxeles físicos
    const physical = screen.dipToScreenPoint(point)
    const vx = GetSystemMetrics(SM_XVIRTUALSCREEN)
    const vy = GetSystemMetrics(SM_YVIRTUALSCREEN)
    const vw = GetSystemMetrics(SM_CXVIRTUALSCREEN)
    const vh = GetSystemMetrics(SM_CYVIRTUALSCREEN)
    const input = {
      type: 0,
      u: {
        mi: {
          dx: Math.round(((physical.x - vx) * 65535) / (vw - 1)),
          dy: Math.round(((physical.y - vy) * 65535) / (vh - 1)),
          mouseData: 0,
          dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
          time: 0,
          dwExtraInfo: 0
        }
      }
    }
    const sent = SendInput(1, [input], koffi.sizeof(INPUT))
    if (sent !== 1) throw new Error(`SendInput sent ${sent} (sizeof INPUT ${koffi.sizeof(INPUT)})`)
  }
}

function macos() {
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  const CGPoint = koffi.struct('CGPoint', { x: 'double', y: 'double' })
  const CGEventCreateMouseEvent = cg.func('void *CGEventCreateMouseEvent(void *source, uint32 mouseType, CGPoint position, uint32 button)')
  const CGEventPost = cg.func('void CGEventPost(uint32 tap, void *event)')
  const CFRelease = cf.func('void CFRelease(void *object)')
  const kCGEventMouseMoved = 5
  const kCGHIDEventTap = 0
  return (point) => {
    // En macOS los DIP de Electron son los puntos globales de CoreGraphics
    const event = CGEventCreateMouseEvent(null, kCGEventMouseMoved, { x: point.x, y: point.y }, 0)
    CGEventPost(kCGHIDEventTap, event)
    CFRelease(event)
  }
}

function moveMouse(point) {
  if (!impl) impl = process.platform === 'win32' ? windows() : process.platform === 'darwin' ? macos() : linux()
  impl(point)
}

module.exports = { koffiInfo, moveMouse, sentPhysical, queryPointer: () => queryPointer() }
