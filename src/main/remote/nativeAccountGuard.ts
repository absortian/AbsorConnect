// La salida de cuenta corta por IPC local aunque la API haya dejado de responder.
import type { LocalAgentSnapshot, LocalAgentStopResult } from '../../shared/remote/localAgent'
import { isDeviceId } from '../../shared/remote/agentDevice'
export class NativeAccountGuard {
  private pending: Promise<LocalAgentStopResult> | null = null
  private pendingId: string | null = null
  constructor(
    private readonly deps: {
      snapshot(): LocalAgentSnapshot
      stop(id: string): Promise<LocalAgentStopResult>
      reserved(stopped: boolean): void
    }
  ) {}
  cut(deviceId?: string): Promise<LocalAgentStopResult> {
    const state = this.deps.snapshot()
    if (state.ownership === 'legacy')
      return Promise.resolve({ ok: false, code: 'local_agent_unverified' })
    const id = state.deviceId
    if (!isDeviceId(id) || (deviceId !== undefined && deviceId !== id))
      return Promise.resolve({ ok: false, code: 'local_agent_unverified' })
    if (this.pending)
      return this.pendingId === id
        ? this.pending
        : Promise.resolve({ ok: false, code: 'local_agent_busy' })
    this.pendingId = id
    this.deps.reserved(false)
    this.pending = this.deps
      .stop(id)
      .then((result) => {
        if (result.ok) {
          if (this.deps.snapshot().deviceId !== id)
            return { ok: false as const, code: 'local_agent_unverified' as const }
          this.deps.reserved(true)
        }
        return result
      })
      .catch(() => ({ ok: false as const, code: 'local_agent_stop_unconfirmed' as const }))
      .finally(() => {
        this.pending = null
        this.pendingId = null
      })
    return this.pending
  }
}
