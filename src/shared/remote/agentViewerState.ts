// Política del controlador; el host sigue obligado a aplicar sus propios gates.
import { parseAgentHostMessage, type AgentCapabilities, type AgentContext } from './agentProtocol'

export interface AgentViewerStatus {
  enabled: boolean
  sequence: number
  state: AgentContext
  imageAvailable: boolean
  inputAllowed: boolean
  sensitiveAllowed: boolean
}

/** Una instancia por PeerConnection autenticada. Ningún estado sobrevive al reconectar. */
export class AgentViewerState {
  private enabled = false
  private capabilities: AgentCapabilities | null = null
  private sensitiveTainted = false
  private context: { sequence: number; state: AgentContext; imageAvailable: boolean } | null = null

  announce(version: unknown, supported: unknown): boolean {
    if (this.enabled || version !== 1 || supported !== true) return false
    this.enabled = true
    return true
  }

  accept(raw: string): boolean {
    if (!this.enabled) return false
    const message = parseAgentHostMessage(raw)
    if (message?.type === 'agent-capabilities') {
      if (JSON.stringify(this.capabilities) === JSON.stringify(message.capabilities)) return false
      this.capabilities = message.capabilities
      return true
    }
    if (message?.type !== 'agent-context' || message.sequence <= (this.context?.sequence ?? 0))
      return false
    // v1 no etiqueta cada trozo de contenido con el contexto: solo una conexión nueva
    // puede reactivar funciones sensibles tras un cambio, evitando colas del usuario anterior.
    if (this.context || message.state !== 'user_desktop') this.sensitiveTainted = true
    this.context = message
    return true
  }

  get status(): AgentViewerStatus {
    const imageAvailable = !!(this.capabilities && this.context?.imageAvailable)
    const state = this.context?.state ?? 'unavailable'
    return {
      enabled: this.enabled,
      sequence: this.context?.sequence ?? 0,
      state,
      imageAvailable: !this.enabled || imageAvailable,
      inputAllowed:
        !this.enabled ||
        (imageAvailable &&
          (state === 'user_desktop' ||
            (['login', 'locked'].includes(state) && this.capabilities?.login === true) ||
            (state === 'secure_prompt' && this.capabilities?.administration === true))),
      sensitiveAllowed:
        !this.enabled || (imageAvailable && state === 'user_desktop' && !this.sensitiveTainted)
    }
  }
}
