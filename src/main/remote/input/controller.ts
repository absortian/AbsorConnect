// Aplica los eventos de entrada de una sesión remota sobre la pantalla elegida (add-remote-desktop
// D9/D10). Lleva la cuenta de las teclas y botones pulsados para soltarlos todos al terminar la
// sesión o cuando el visor pierde el foco (`release-all`): sin esto se quedarían "pegados".
import { InputEvent, MouseButton } from '../../../shared/remote/input'
import { pointInRect, Point, Rect } from './geometry'
import { splitText } from './text'
import { wheelPixels } from './wheel'

/** Operaciones nativas de cada sistema (windows.ts, macos.ts, x11.ts), ya en coordenadas nativas. */
export interface InputBackend {
  move(point: Point): void
  button(button: MouseButton, down: boolean): void
  /** Píxeles con el sentido de `WheelEvent`: `dy > 0` baja y `dx > 0` va a la derecha. */
  wheel(dx: number, dy: number): void
  /** Tecla por `KeyboardEvent.code`; false si no existe en este sistema. */
  key(code: string, down: boolean): boolean
  /** Caracteres imprimibles, sin Intro ni Tab (van como teclas). */
  text(text: string): Promise<void>
  dispose(): void
}

export class InputController {
  private readonly keys = new Set<string>()
  private readonly buttons = new Set<MouseButton>()
  private rect: Rect | null = null
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private readonly backend: InputBackend) {}

  /** Rectángulo nativo de la pantalla elegida (`nativeDisplayRect`): ahí caen las posiciones. */
  setDisplayRect(rect: Rect): void {
    this.rect = rect
  }

  /**
   * Aplica un evento ya validado (`parseInputEvent`). Los eventos van en fila: escribir texto
   * puede esperar en X11 (scratchKeys.ts) y lo que llegue después no debe adelantarse.
   */
  apply(event: InputEvent): Promise<void> {
    return this.enqueue(() => this.applyNow(event))
  }

  /** Suelta todas las teclas y botones pulsados. */
  releaseAll(): Promise<void> {
    return this.enqueue(async () => this.releaseNow())
  }

  /** Suelta todo y libera el backend. Después no se aplica nada más. */
  async dispose(): Promise<void> {
    await this.releaseAll()
    this.disposed = true
    this.backend.dispose()
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(() => (this.disposed ? undefined : task()))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applyNow(event: InputEvent): Promise<void> {
    switch (event.type) {
      case 'move':
        if (this.rect) this.backend.move(pointInRect(event.x, event.y, this.rect))
        return
      case 'button':
        if (event.down) {
          this.buttons.add(event.button)
        } else if (!this.buttons.delete(event.button)) {
          return
        }
        this.backend.button(event.button, event.down)
        return
      case 'wheel':
        this.backend.wheel(wheelPixels(event.dx, event.mode), wheelPixels(event.dy, event.mode))
        return
      case 'key':
        // Soltar una tecla que no consta como pulsada (p. ej. tras `release-all`) no hace nada
        if (!event.down && !this.keys.has(event.code)) return
        if (!this.backend.key(event.code, event.down)) return
        if (event.down) this.keys.add(event.code)
        else this.keys.delete(event.code)
        return
      case 'text':
        for (const segment of splitText(event.text)) {
          if (segment.kind === 'text') {
            await this.backend.text(segment.text)
          } else {
            this.backend.key(segment.code, true)
            this.backend.key(segment.code, false)
          }
        }
        return
      case 'release-all':
        this.releaseNow()
        return
    }
  }

  private releaseNow(): void {
    for (const code of this.keys) this.backend.key(code, false)
    for (const button of this.buttons) this.backend.button(button, false)
    this.keys.clear()
    this.buttons.clear()
  }
}
