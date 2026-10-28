import type { ViewerAvailabilityResult } from './viewerBridge'

export type RestartWaitState = 'idle' | 'waiting' | 'ready' | 'expired' | 'cancelled' | 'failed'
interface Options {
  status(): Promise<ViewerAvailabilityResult>
  changed(state: RestartWaitState, code?: string): void
  now?(): number
}
/** Solo consulta presencia del mismo PC; nunca crea ofertas ni autentica por sí misma. */
export class RestartWait {
  private generation = 0
  private started = 0
  private baseline = 0
  private away = false
  private deadline: ReturnType<typeof setTimeout> | null = null
  private next: ReturnType<typeof setTimeout> | null = null
  state: RestartWaitState = 'idle'
  constructor(private readonly options: Options) {}
  start(lastSeenAt: string): void {
    this.stopTimers()
    const generation = ++this.generation
    this.baseline = Date.parse(lastSeenAt)
    this.away = false
    this.started = this.now()
    if (!Number.isFinite(this.baseline)) return this.finish('failed', 'invalid_presence')
    this.state = 'waiting'
    this.options.changed(this.state)
    this.deadline = setTimeout(() => this.finish('expired'), 300_000)
    void this.poll(generation)
  }
  clear(): void {
    this.finish('idle')
  }
  cancel(): void {
    if (this.state === 'waiting') this.finish('cancelled')
  }
  dispose(): void {
    this.generation++
    this.stopTimers()
  }
  private now(): number {
    return this.options.now?.() ?? performance.now()
  }
  private async poll(generation: number): Promise<void> {
    let wait = 2000
    try {
      const status = await this.options.status()
      if (generation !== this.generation || this.state !== 'waiting') return
      const elapsed = this.now() - this.started
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 300_000)
        return this.finish('expired')
      if (!status.ok) {
        if (
          [
            'unauthorized',
            'unauthenticated',
            'session_expired',
            'device_not_found',
            'forbidden'
          ].includes(status.code)
        )
          return this.finish('failed', status.code)
        if (status.retryAfter) wait = Math.min(300_000, Math.max(wait, status.retryAfter * 1000))
      } else {
        if (!status.online || !status.available) this.away = true
        // Un heartbeat posterior evita presentar presencia anterior como un regreso.
        // Señal de disponibilidad: no certifica por sí sola que el SO acabara el reinicio.
        if (
          status.online &&
          status.available &&
          (this.away || Date.parse(status.lastSeenAt) > this.baseline)
        )
          return this.finish('ready')
      }
    } catch {
      /* Fallo transitorio: el plazo independiente sigue corriendo. */
    }
    if (generation === this.generation && this.state === 'waiting')
      this.next = setTimeout(() => {
        void this.poll(generation)
      }, wait)
  }
  private finish(state: RestartWaitState, code?: string): void {
    this.generation++
    this.stopTimers()
    this.state = state
    this.options.changed(state, code)
  }
  private stopTimers(): void {
    if (this.deadline) clearTimeout(this.deadline)
    if (this.next) clearTimeout(this.next)
    this.deadline = this.next = null
  }
}
