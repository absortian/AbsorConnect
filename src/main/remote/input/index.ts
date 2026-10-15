// Inyección de entrada del PC controlado (add-remote-desktop D10). Cada sistema tiene su backend
// con koffi; se carga al empezar una sesión, no al arrancar la app, para que un fallo de la
// biblioteca nativa solo afecte al control remoto.
import { Display, screen } from 'electron'
import { InputBackend, InputController } from './controller'
import { Rect, scaleRect } from './geometry'

export { InputController } from './controller'

export async function createInputBackend(): Promise<InputBackend> {
  switch (process.platform) {
    case 'win32':
      return (await import('./windows')).createWindowsBackend()
    case 'darwin':
      return (await import('./macos')).createMacBackend()
    case 'linux':
      return (await import('./x11')).createX11Backend()
    default:
      throw new Error(`Remote input is not supported on ${process.platform}`)
  }
}

export async function createInputController(): Promise<InputController> {
  return new InputController(await createInputBackend())
}

/** Rectángulo de la pantalla en las coordenadas que usa la entrada de cada sistema (geometry.ts). */
export function nativeDisplayRect(display: Display): Rect {
  if (process.platform === 'win32') return screen.dipToScreenRect(null, display.bounds)
  if (process.platform === 'linux') return scaleRect(display.bounds, display.scaleFactor)
  return display.bounds
}
