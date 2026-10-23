// Extensión opcional v1. Analizar un mensaje no lo autentica ni autoriza su ejecución.
export const AGENT_CONTROL_LIMIT = 2048
export const AGENT_ACTIONS = ['lock', 'logout', 'restart', 'secure_attention'] as const
export const AGENT_CONTEXTS = [
  'user_desktop',
  'locked',
  'login',
  'secure_prompt',
  'transition',
  'unavailable'
] as const
export const AGENT_ERRORS = [
  'not_supported',
  'not_allowed',
  'busy',
  'cancelled',
  'system_error',
  'session_expired'
] as const
export type AgentAction = (typeof AGENT_ACTIONS)[number]
export type AgentContext = (typeof AGENT_CONTEXTS)[number]
export type AgentError = (typeof AGENT_ERRORS)[number]
export interface AgentCapabilities {
  administration: boolean
  login: boolean
  secureAttention: boolean
  restart: boolean
}
interface Envelope {
  v: 1
  extension: 1
}
export type AgentControllerMessage =
  | (Envelope & { type: 'agent-control-enable' })
  | (Envelope & { type: 'host-operation'; id: string; action: AgentAction })
export type AgentHostMessage =
  | (Envelope & {
      type: 'agent-capabilities'
      agentVersion: string
      capabilities: AgentCapabilities
      actions: AgentAction[]
    })
  | (Envelope & {
      type: 'agent-context'
      sequence: number
      state: AgentContext
      imageAvailable: boolean
    })
  | (Envelope & {
      type: 'host-operation-result'
      id: string
      action: AgentAction
      status: 'accepted'
    })
  | (Envelope & {
      type: 'host-operation-result'
      id: string
      action: AgentAction
      status: 'rejected' | 'failed'
      code: AgentError
    })

const CAPABILITY_KEYS = ['administration', 'login', 'secureAttention', 'restart'] as const
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function keys(data: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    Object.keys(data).length === expected.length &&
    expected.every((key) => Object.hasOwn(data, key))
  )
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.some((candidate) => candidate === value)
}
function decode(raw: string): Record<string, unknown> | null {
  if (
    typeof raw !== 'string' ||
    raw.length > AGENT_CONTROL_LIMIT ||
    new TextEncoder().encode(raw).length > AGENT_CONTROL_LIMIT
  )
    return null
  try {
    const data: unknown = JSON.parse(raw)
    return record(data) && data.v === 1 && data.extension === 1 ? data : null
  } catch {
    return null
  }
}
function operation(
  data: Record<string, unknown>
): data is Record<string, unknown> & { id: string; action: AgentAction } {
  return (
    typeof data.id === 'string' &&
    data.id.length === 36 &&
    ID.test(data.id) &&
    oneOf(data.action, AGENT_ACTIONS)
  )
}

/** Solo enumera operaciones; no admite parámetros, rutas, texto de shell ni programas. */
export function parseAgentControllerMessage(raw: string): AgentControllerMessage | null {
  const data = decode(raw)
  if (!data) return null
  if (data.type === 'agent-control-enable' && keys(data, ['v', 'extension', 'type'])) {
    return { v: 1, extension: 1, type: 'agent-control-enable' }
  }
  if (
    data.type === 'host-operation' &&
    keys(data, ['v', 'extension', 'type', 'id', 'action']) &&
    operation(data)
  ) {
    return { v: 1, extension: 1, type: 'host-operation', id: data.id, action: data.action }
  }
  return null
}

export function parseAgentHostMessage(raw: string): AgentHostMessage | null {
  const data = decode(raw)
  if (!data) return null
  switch (data.type) {
    case 'agent-capabilities': {
      const declared = data.capabilities
      if (
        !keys(data, ['v', 'extension', 'type', 'agentVersion', 'capabilities', 'actions']) ||
        typeof data.agentVersion !== 'string' ||
        data.agentVersion.length < 1 ||
        data.agentVersion.length > 32 ||
        /[^0-9A-Za-z.+-]/.test(data.agentVersion) ||
        !record(declared) ||
        !keys(declared, CAPABILITY_KEYS) ||
        !CAPABILITY_KEYS.every((key) => typeof declared[key] === 'boolean') ||
        !Array.isArray(data.actions) ||
        data.actions.length > AGENT_ACTIONS.length ||
        !data.actions.every((action) => oneOf(action, AGENT_ACTIONS)) ||
        new Set(data.actions).size !== data.actions.length
      )
        return null
      const capabilities: AgentCapabilities = {
        administration: declared.administration as boolean,
        login: declared.login as boolean,
        secureAttention: declared.secureAttention as boolean,
        restart: declared.restart as boolean
      }
      if (
        (data.actions.includes('restart') && !capabilities.restart) ||
        (data.actions.includes('secure_attention') && !capabilities.secureAttention)
      )
        return null
      return {
        v: 1,
        extension: 1,
        type: 'agent-capabilities',
        agentVersion: data.agentVersion,
        capabilities,
        actions: [...data.actions]
      }
    }
    case 'agent-context':
      if (
        !keys(data, ['v', 'extension', 'type', 'sequence', 'state', 'imageAvailable']) ||
        typeof data.sequence !== 'number' ||
        !Number.isSafeInteger(data.sequence) ||
        data.sequence < 1 ||
        data.sequence > 2147483647 ||
        !oneOf(data.state, AGENT_CONTEXTS) ||
        typeof data.imageAvailable !== 'boolean' ||
        (['transition', 'unavailable'].includes(data.state) && data.imageAvailable)
      )
        return null
      return {
        v: 1,
        extension: 1,
        type: 'agent-context',
        sequence: data.sequence,
        state: data.state,
        imageAvailable: data.imageAvailable
      }
    case 'host-operation-result':
      if (!operation(data)) return null
      if (
        data.status === 'accepted' &&
        keys(data, ['v', 'extension', 'type', 'id', 'action', 'status'])
      ) {
        return {
          v: 1,
          extension: 1,
          type: 'host-operation-result',
          id: data.id,
          action: data.action,
          status: 'accepted'
        }
      }
      if (
        (data.status === 'rejected' || data.status === 'failed') &&
        oneOf(data.code, AGENT_ERRORS) &&
        keys(data, ['v', 'extension', 'type', 'id', 'action', 'status', 'code'])
      ) {
        return {
          v: 1,
          extension: 1,
          type: 'host-operation-result',
          id: data.id,
          action: data.action,
          status: data.status,
          code: data.code
        }
      }
      return null
    default:
      return null
  }
}
