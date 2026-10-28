import type { AgentAction, AgentControllerMessage, AgentHostMessage } from './agentProtocol'

type ResultMessage = Extract<AgentHostMessage, { type: 'host-operation-result' }>
export type HostActionResult =
  | ResultMessage
  | {
      action: AgentAction
      status: 'cancelled' | 'unavailable' | 'timed_out' | 'connection_lost'
    }
export interface HostActionState {
  actions: readonly AgentAction[]
  confirming: boolean
  pending: { id: string; action: AgentAction } | null
  last: HostActionResult | null
  blocked: boolean
}
interface Options {
  active(): boolean
  send(message: AgentControllerMessage): void
  changed(state: HostActionState): void
  id?(): string
}

/** Una instancia por conexión. Nunca reintenta una operación ni reutiliza su ID. */
export class HostActions {
  private actions: AgentAction[] = []
  private revision = 0
  private issued = 0
  private confirming = false
  private blocked = false
  private pending: {
    id: string
    action: AgentAction
    resolve(result: HostActionResult): void
  } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private last: HostActionResult | null = null
  constructor(private readonly options: Options) {}

  get state(): HostActionState {
    return {
      actions: [...this.actions],
      confirming: this.confirming,
      pending: this.pending && { id: this.pending.id, action: this.pending.action },
      last: this.last,
      blocked: this.blocked || this.issued >= 64
    }
  }

  setActions(actions: readonly AgentAction[]): void {
    if (JSON.stringify(this.actions) === JSON.stringify(actions)) return
    this.actions = [...actions]
    this.invalidateConfirmation()
  }

  invalidateConfirmation(): void {
    this.revision++
    this.confirming = false
    this.notify()
  }

  async run(action: AgentAction, confirm: () => Promise<boolean>): Promise<HostActionResult> {
    if (!this.canRun(action)) return { action, status: 'unavailable' }
    const revision = this.revision
    this.confirming = true
    this.notify()
    let accepted = false
    try {
      accepted = await confirm()
    } catch {
      /* Un diálogo fallido no autoriza. */
    }
    if (revision !== this.revision) return { action, status: 'unavailable' }
    this.confirming = false
    if (!accepted) {
      this.last = { action, status: 'cancelled' }
      this.notify()
      return this.last
    }
    if (!this.canRun(action)) {
      this.notify()
      return { action, status: 'unavailable' }
    }
    const id = this.options.id?.() ?? crypto.randomUUID()
    this.issued++
    return new Promise((resolve) => {
      this.pending = { id, action, resolve }
      this.timer = setTimeout(() => {
        // Se desconoce si llegó a ejecutarse: otra orden exige una conexión nueva.
        this.blocked = true
        this.finish({ action, status: 'timed_out' })
      }, 15_000)
      this.notify()
      if (this.pending?.id !== id) return
      if (!this.options.active()) {
        this.blocked = true
        this.finish({ action, status: 'connection_lost' })
        return
      }
      try {
        this.options.send({ v: 1, extension: 1, type: 'host-operation', id, action })
      } catch {
        this.blocked = true
        this.finish({ action, status: 'connection_lost' })
      }
    })
  }

  receive(result: ResultMessage): boolean {
    if (
      !this.pending ||
      !this.options.active() ||
      result.id !== this.pending.id ||
      result.action !== this.pending.action
    )
      return false
    this.finish(result)
    return true
  }

  reset(): void {
    this.revision++
    this.confirming = false
    this.actions = []
    this.blocked = false
    this.issued = 0
    if (this.pending) this.finish({ action: this.pending.action, status: 'connection_lost' })
    this.last = null
    this.notify()
  }

  private canRun(action: AgentAction): boolean {
    return (
      this.options.active() &&
      !this.pending &&
      !this.confirming &&
      !this.blocked &&
      this.issued < 64 &&
      this.actions.includes(action)
    )
  }
  private finish(result: HostActionResult): void {
    const pending = this.pending
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
    this.last = result
    this.notify()
    pending?.resolve(result)
  }
  private notify(): void {
    this.options.changed(this.state)
  }
}
