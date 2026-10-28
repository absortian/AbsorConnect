/** Estado informativo local. No contiene autoridad ni secretos del agente. */
export type LocalBrokerState = 'idle' | 'active' | 'validation_required' | 'revoked'
export type LocalAgentStopResult =
  | { ok: true; freshEnrollmentRequired: true }
  | {
      ok: false
      code:
        | 'forbidden'
        | 'cancelled'
        | 'local_agent_unverified'
        | 'local_agent_busy'
        | 'local_agent_control_unavailable'
        | 'local_agent_stop_unconfirmed'
    }
export interface LocalAgentSnapshot {
  ownership: 'legacy' | 'agent' | 'unknown'
  phase: 'absent' | 'responding' | 'unverified'
  deviceId: string | null
  agentVersion: string | null
  state: LocalBrokerState | null
  active: boolean
  readyForUnattended: false
}
/** Proyección explícita al cruzar IPC; una ampliación interna no añade campos al renderer. */
export function publicLocalAgentSnapshot(value: LocalAgentSnapshot): LocalAgentSnapshot {
  return {
    ownership: value.ownership,
    phase: value.phase,
    deviceId: value.deviceId,
    agentVersion: value.agentVersion,
    state: value.state,
    active: value.active,
    readyForUnattended: false
  }
}
export function absentLocalAgent(): LocalAgentSnapshot {
  return {
    ownership: 'legacy',
    phase: 'absent',
    deviceId: null,
    agentVersion: null,
    state: null,
    active: false,
    readyForUnattended: false
  }
}
export function unverifiedLocalAgent(previous?: LocalAgentSnapshot): LocalAgentSnapshot {
  return {
    ownership: previous?.ownership === 'agent' ? 'agent' : 'unknown',
    phase: 'unverified',
    deviceId: previous?.deviceId ?? null,
    agentVersion: previous?.agentVersion ?? null,
    state: null,
    active: false,
    readyForUnattended: false
  }
}
