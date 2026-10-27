import type { AgentCapabilities } from './agentProtocol'

export type AgentDeviceInfo =
  | { mode: 'legacy' }
  | { mode: 'unknown' }
  | { mode: 'agent'; agentVersion: string; capabilities: AgentCapabilities }
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/
const CAPABILITIES = ['administration', 'login', 'secureAttention', 'restart'] as const
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** La API declara capacidades; no demuestra que esa configuración esté certificada. */
export function parseAgentDeviceInfo(remote: unknown): AgentDeviceInfo {
  if (!isRecord(remote)) return { mode: 'unknown' }
  if (!Object.hasOwn(remote, 'mode')) return { mode: 'legacy' }
  if (
    remote.mode !== 'agent' ||
    typeof remote.agentVersion !== 'string' ||
    !VERSION.test(remote.agentVersion) ||
    !isRecord(remote.capabilities)
  )
    return { mode: 'unknown' }
  const caps = remote.capabilities
  if (
    Object.keys(caps).length !== CAPABILITIES.length ||
    !CAPABILITIES.every((k) => typeof caps[k] === 'boolean')
  )
    return { mode: 'unknown' }
  return {
    mode: 'agent',
    agentVersion: remote.agentVersion,
    capabilities: {
      administration: caps.administration as boolean,
      login: caps.login as boolean,
      secureAttention: caps.secureAttention as boolean,
      restart: caps.restart as boolean
    }
  }
}

/** No hay todavía una combinación de paquete/SO/arquitectura aceptada por el piloto. */
export function travelReadiness(
  info: AgentDeviceInfo,
  online: boolean
): 'offline' | 'legacy_session' | 'not_certified' | 'unknown' {
  if (!online) return 'offline'
  if (info.mode === 'legacy') return 'legacy_session'
  return info.mode === 'agent' ? 'not_certified' : 'unknown'
}
export function isDeviceId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
  )
}
