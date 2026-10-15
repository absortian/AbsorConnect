// Rueda del ratón: el protocolo lleva los deltas de `WheelEvent` (píxeles, líneas o páginas) y
// cada sistema quiere otra unidad: X11 solo entiende clics de rueda (botones 4–7), Windows
// unidades de 1/120 de clic y macOS píxeles. Se pasa todo a píxeles y se acumula el resto, para
// que un trackpad que manda deltas pequeños acabe desplazando lo mismo.
import { WheelMode } from '../../../shared/remote/input'

/** Píxeles que equivalen a un clic de rueda (lo que suele mandar Chromium por clic). */
export const WHEEL_NOTCH_PX = 100

const LINE_PX = WHEEL_NOTCH_PX / 3
const PAGE_PX = WHEEL_NOTCH_PX * 8

export function wheelPixels(delta: number, mode: WheelMode): number {
  return mode === 1 ? delta * LINE_PX : mode === 2 ? delta * PAGE_PX : delta
}

/** Convierte píxeles en pasos enteros de `stepPx`, guardando lo que sobra para el siguiente. */
export class WheelAccumulator {
  private rest = 0

  constructor(private readonly stepPx: number) {}

  add(pixels: number): number {
    this.rest += pixels
    const steps = Math.trunc(this.rest / this.stepPx)
    this.rest -= steps * this.stepPx
    return steps
  }

  reset(): void {
    this.rest = 0
  }
}
