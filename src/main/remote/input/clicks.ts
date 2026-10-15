// Número de clic (1 simple, 2 doble, 3 triple…) para macOS: CoreGraphics no detecta el doble clic
// por sí mismo, hay que poner `kCGMouseEventClickState` en cada evento. Windows y X11 lo deducen
// solos de dos pulsaciones seguidas.
import { MouseButton } from '../../../shared/remote/input'
import { Point } from './geometry'

/** Intervalo de doble clic por defecto de macOS y radio en puntos en el que cuenta como el mismo sitio. */
const DOUBLE_CLICK_MS = 500
const DOUBLE_CLICK_RADIUS = 4

export class ClickCounter {
  private last: { button: MouseButton; point: Point; at: number; count: number } | null = null

  constructor(
    private readonly intervalMs = DOUBLE_CLICK_MS,
    private readonly radius = DOUBLE_CLICK_RADIUS
  ) {}

  /** Registra una pulsación y devuelve su número de clic. */
  press(button: MouseButton, point: Point, now: number): number {
    const last = this.last
    const repeated =
      last !== null &&
      last.button === button &&
      now - last.at <= this.intervalMs &&
      Math.abs(point.x - last.point.x) <= this.radius &&
      Math.abs(point.y - last.point.y) <= this.radius
    const count = repeated ? last.count + 1 : 1
    this.last = { button, point, at: now, count }
    return count
  }

  /** Número de clic para soltar el botón: el de su pulsación. */
  current(button: MouseButton): number {
    return this.last?.button === button ? this.last.count : 1
  }
}
