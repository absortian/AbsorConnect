// DTO cerrado: ningún secreto, ruta, PID o identificador privado de transacción cruza preload.
export type AgentSetupPhase =
  | 'unavailable'
  | 'idle'
  | 'preparing'
  | 'prepared'
  | 'committed'
  | 'compensating'
  | 'intervention_required'
export interface AgentSetupState {
  phase: AgentSetupPhase
  providerAvailable: boolean
  busy: boolean
  canCommit: boolean
  freshEnrollmentRequired: boolean
  readyForUnattended: false
}
export type AgentSetupCode =
  | 'forbidden'
  | 'cancelled'
  | 'not_signed_in'
  | 'agent_setup_busy'
  | 'agent_setup_unavailable'
  | 'agent_setup_intervention_required'
  | 'agent_setup_no_intent'
export type AgentSetupResult =
  | { ok: true; state: AgentSetupState }
  | { ok: false; code: AgentSetupCode; state?: AgentSetupState }
export interface AgentSetupChoice {
  confirmLocal: boolean
  activate: boolean
}
export function agentSetupChoice(value: unknown): value is AgentSetupChoice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    Object.keys(v).length === 2 &&
    typeof v.confirmLocal === 'boolean' &&
    typeof v.activate === 'boolean'
  )
}
const phases = new Set<AgentSetupPhase>([
  'unavailable',
  'idle',
  'preparing',
  'prepared',
  'committed',
  'compensating',
  'intervention_required'
])
export function publicAgentSetupState(value: AgentSetupState): AgentSetupState {
  const phase = phases.has(value.phase) ? value.phase : 'intervention_required'
  return {
    phase,
    providerAvailable: value.providerAvailable === true,
    busy: value.busy === true,
    canCommit:
      phase === 'prepared' &&
      value.providerAvailable === true &&
      value.busy === false &&
      value.canCommit === true,
    freshEnrollmentRequired: value.freshEnrollmentRequired === true,
    readyForUnattended: false
  }
}
export function publicAgentSetupResult(value: AgentSetupResult): AgentSetupResult {
  if (value.ok === true) return { ok: true, state: publicAgentSetupState(value.state) }
  const codes: AgentSetupCode[] = [
    'forbidden',
    'cancelled',
    'not_signed_in',
    'agent_setup_busy',
    'agent_setup_unavailable',
    'agent_setup_intervention_required',
    'agent_setup_no_intent'
  ]
  return {
    ok: false,
    code: codes.includes(value.code) ? value.code : 'agent_setup_intervention_required',
    ...(value.state ? { state: publicAgentSetupState(value.state) } : {})
  }
}
