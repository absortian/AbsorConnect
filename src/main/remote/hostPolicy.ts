// Qué publica este PC en la cuenta y qué solicitudes rechaza sin abrir ninguna conexión
// (add-remote-desktop D3/D4/D5). Lógica pura: la usa hostService.ts.
import { RejectionReason, RemoteState } from './deviceApi'
import { RemoteSupport } from './support'

export interface HostConditions {
  /** Activado en Ajustes y con contraseña definida. */
  enabled: boolean
  support: RemoteSupport
  /** Segundos de bloqueo que quedan tras 5 fallos (0 sin bloqueo). */
  lockRemainingSeconds: number
  /** Hay una sesión en curso o abriéndose. */
  busy: boolean
}

export interface EarlyRejection {
  reason: RejectionReason
  retryAfter?: number
}

/**
 * `remote_state` para la lista de equipos. Un sistema que no lo permite (Wayland) se muestra como
 * tal aunque esté desactivado: así el controlador entiende por qué.
 */
export function deviceState(c: HostConditions): RemoteState {
  if (c.support.state === 'unsupported') return 'unsupported'
  if (!c.enabled) return 'disabled'
  if (c.support.state === 'missing_permissions') return 'missing_permissions'
  return c.busy ? 'busy' : 'available'
}

/** Si la solicitud se rechaza sin crear la conexión, y con qué motivo. */
export function earlyRejection(c: HostConditions): EarlyRejection | null {
  if (c.support.state === 'unsupported') return { reason: 'unsupported' }
  if (!c.enabled) return { reason: 'remote_disabled' }
  if (c.support.state === 'missing_permissions') return { reason: 'missing_permissions' }
  if (c.lockRemainingSeconds > 0) return { reason: 'locked', retryAfter: c.lockRemainingSeconds }
  if (c.busy) return { reason: 'busy' }
  return null
}

/** El PC consulta solicitudes (y aparece en línea) solo si puede llegar a aceptar alguna. */
export function shouldPoll(c: HostConditions): boolean {
  return c.enabled && c.support.state !== 'unsupported'
}
