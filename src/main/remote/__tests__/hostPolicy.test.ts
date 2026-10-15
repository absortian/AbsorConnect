import { describe, it, expect } from 'vitest'
import { deviceState, earlyRejection, HostConditions, shouldPoll } from '../hostPolicy'

const base: HostConditions = {
  enabled: true,
  support: { state: 'available' },
  lockRemainingSeconds: 0,
  busy: false
}
const wayland: HostConditions = { ...base, support: { state: 'unsupported', reason: 'wayland' } }
const noPermissions: HostConditions = {
  ...base,
  support: { state: 'missing_permissions', missing: ['screen'] }
}

describe('hostPolicy', () => {
  it('estado del equipo en la cuenta', () => {
    expect(deviceState(base)).toBe('available')
    expect(deviceState({ ...base, busy: true })).toBe('busy')
    expect(deviceState({ ...base, enabled: false })).toBe('disabled')
    expect(deviceState(noPermissions)).toBe('missing_permissions')
    expect(deviceState({ ...noPermissions, enabled: false })).toBe('disabled')
    // Wayland se publica como tal aunque esté desactivado: el controlador entiende por qué
    expect(deviceState({ ...wayland, enabled: false })).toBe('unsupported')
    // El bloqueo afecta a cada solicitud, no al estado publicado
    expect(deviceState({ ...base, lockRemainingSeconds: 600 })).toBe('available')
  })

  it('rechazos sin abrir conexión, con su motivo', () => {
    expect(earlyRejection(base)).toBeNull()
    expect(earlyRejection({ ...base, enabled: false })).toEqual({ reason: 'remote_disabled' })
    expect(earlyRejection(wayland)).toEqual({ reason: 'unsupported' })
    expect(earlyRejection(noPermissions)).toEqual({ reason: 'missing_permissions' })
    expect(earlyRejection({ ...base, lockRemainingSeconds: 600 })).toEqual({
      reason: 'locked',
      retryAfter: 600
    })
    expect(earlyRejection({ ...base, busy: true })).toEqual({ reason: 'busy' })
  })

  it('solo consulta solicitudes si puede llegar a aceptar alguna', () => {
    expect(shouldPoll(base)).toBe(true)
    // Sin permisos sí: así el controlador ve "faltan permisos" en vez de "sin conexión"
    expect(shouldPoll(noPermissions)).toBe(true)
    expect(shouldPoll({ ...base, enabled: false })).toBe(false)
    expect(shouldPoll(wayland)).toBe(false)
  })
})
