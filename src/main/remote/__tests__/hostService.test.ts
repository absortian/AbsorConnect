import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError } from '../../cloud/apiClient'
import { DeviceCredentials, DeviceInfo, PendingRequest, RejectionReason } from '../deviceApi'
import {
  HostService,
  HostServiceDeps,
  HostSession,
  POLL_INTERVAL_MS,
  REGISTER_INTERVAL_MS
} from '../hostService'
import { RemoteLogEntry } from '../sessionLog'
import { RemoteSupport } from '../support'

class FakeApi {
  registrations: { id: string; info: DeviceInfo }[] = []
  pending: PendingRequest[] = []
  polls = 0
  answers: { requestId: string; answer: string }[] = []
  rejections: { requestId: string; reason: RejectionReason; retryAfter?: number }[] = []
  registerErrors: ApiError[] = []
  pollErrors: ApiError[] = []
  answerErrors: ApiError[] = []

  async register(device: DeviceCredentials, info: DeviceInfo): Promise<void> {
    const error = this.registerErrors.shift()
    if (error) throw error
    this.registrations.push({ id: device.id, info })
  }

  async poll(): Promise<PendingRequest[]> {
    this.polls++
    const error = this.pollErrors.shift()
    if (error) throw error
    const pending = this.pending
    this.pending = []
    return pending
  }

  async answer(_device: DeviceCredentials, requestId: string, answer: string): Promise<void> {
    const error = this.answerErrors.shift()
    if (error) throw error
    this.answers.push({ requestId, answer })
  }

  async reject(
    _device: DeviceCredentials,
    requestId: string,
    reason: RejectionReason,
    retryAfter?: number
  ): Promise<void> {
    this.rejections.push({ requestId, reason, retryAfter })
  }

  get lastState(): string | undefined {
    return this.registrations.at(-1)?.info.remote.state
  }
}

function request(id: string, controllerName = 'Portátil'): PendingRequest {
  return { id, controllerName, offer: 'v=0 oferta', createdAt: new Date().toISOString() }
}

function fakeSession(): {
  session: HostSession & { closedWith?: string }
  start: () => void
  end: () => void
} {
  let start!: () => void
  let fail!: (error: unknown) => void
  let end!: () => void
  const started = new Promise<void>((resolve, reject) => {
    start = resolve
    fail = reject
  })
  started.catch(() => undefined)
  const ended = new Promise<void>((resolve) => {
    end = resolve
  })
  const session: HostSession & { closedWith?: string } = {
    answer: 'v=0 respuesta',
    started,
    ended,
    close(reason) {
      session.closedWith = reason
      fail(new Error(reason))
      end()
    }
  }
  return { session, start, end }
}

function setup(): {
  api: FakeApi
  state: {
    enabled: boolean
    preventSleep: boolean
    lock: number
    support: RemoteSupport
    signedIn: boolean
  }
  logs: RemoteLogEntry[]
  statuses: string[]
  notifications: string[]
  keepAwake: boolean[]
  sessions: ReturnType<typeof fakeSession>[]
  service: HostService
} {
  const api = new FakeApi()
  let identity: DeviceCredentials = { id: 'equipo-1', key: 'clave-1' }
  const state = {
    enabled: true,
    preventSleep: false,
    lock: 0,
    support: { state: 'available' } as RemoteSupport,
    signedIn: true
  }
  const logs: RemoteLogEntry[] = []
  const statuses: string[] = []
  const notifications: string[] = []
  const keepAwake: boolean[] = []
  const sessions: ReturnType<typeof fakeSession>[] = []
  const deps: HostServiceDeps = {
    api,
    identity: {
      get: async () => identity,
      reset: async () => (identity = { id: 'equipo-2', key: 'clave-2' })
    },
    store: {
      isEnabled: async () => state.enabled,
      snapshot: async () => ({
        enabled: state.enabled,
        deviceName: 'Sobremesa',
        hasPassword: true,
        features: { clipboard: true, files: true, audio: false },
        confirmLocal: false,
        preventSleep: state.preventSleep,
        encryptionAvailable: true
      }),
      lockRemainingSeconds: async () => state.lock,
      addLog: async (entry) => {
        logs.push(entry)
      }
    },
    support: () => state.support,
    signedIn: () => state.signedIn,
    platform: 'linux',
    appVersion: '0.4.0',
    openSession: async () => {
      const session = fakeSession()
      sessions.push(session)
      return session.session
    },
    setKeepAwake: (on) => keepAwake.push(on),
    setStatus: (status, controller) =>
      statuses.push(controller ? `${status}:${controller}` : status),
    notify: (event, controller) => notifications.push(`${event}:${controller}`)
  }
  return {
    api,
    state,
    logs,
    statuses,
    notifications,
    keepAwake,
    sessions,
    service: new HostService(deps)
  }
}

const flush = (ms = 0): Promise<void> => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('HostService — registro y consulta', () => {
  it('registra el equipo al arrancar, consulta cada 3 s y vuelve a registrarse cada 5 min', async () => {
    const { api, statuses, service } = setup()
    service.start()
    await flush()
    expect(api.registrations).toEqual([
      {
        id: 'equipo-1',
        info: {
          name: 'Sobremesa',
          platform: 'linux',
          appVersion: '0.4.0',
          remote: { state: 'available', features: { clipboard: true, files: true, audio: false } }
        }
      }
    ])
    expect(api.polls).toBe(1)
    await flush(POLL_INTERVAL_MS)
    expect(api.polls).toBe(2)
    expect(api.registrations).toHaveLength(1)
    await flush(REGISTER_INTERVAL_MS)
    expect(api.registrations.length).toBeGreaterThanOrEqual(2)
    expect(statuses).toEqual(['available'])
    await service.stop()
  })

  it('desactivado: se publica como disabled y no consulta; al activarlo empieza en el momento', async () => {
    const { api, state, statuses, service } = setup()
    state.enabled = false
    service.start()
    await flush(10_000)
    expect(api.lastState).toBe('disabled')
    expect(api.polls).toBe(0)
    expect(statuses).toEqual(['off'])
    state.enabled = true
    await service.settingsChanged()
    await flush()
    expect(api.lastState).toBe('available')
    expect(api.polls).toBe(1)
    await service.stop()
  })

  it('sin sesión de la cuenta no llama a la API', async () => {
    const { api, state, service } = setup()
    state.signedIn = false
    service.start()
    await flush(30_000)
    expect(api.registrations).toEqual([])
    expect(api.polls).toBe(0)
    await service.stop()
  })

  it('identificador de otra cuenta (device_taken): identidad nueva y se registra con ella', async () => {
    const { api, service } = setup()
    api.registerErrors.push(new ApiError('device_taken', 409))
    service.start()
    await flush()
    expect(api.registrations.map((r) => r.id)).toEqual(['equipo-2'])
    await service.stop()
  })

  it('el servicio ya no conoce el equipo (device_not_found): se vuelve a registrar enseguida', async () => {
    const { api, service } = setup()
    api.pollErrors.push(new ApiError('device_not_found', 404))
    service.start()
    await flush()
    // La vuelta siguiente va sin esperar los 3 s (un setTimeout de 0 anidado cuenta como 1 ms)
    await flush(10)
    expect(api.registrations).toHaveLength(2)
    expect(api.polls).toBe(2)
    await service.stop()
  })

  it('too_many_requests: espera lo que indica el servicio', async () => {
    const { api, service } = setup()
    api.pollErrors.push(
      new ApiError('too_many_requests', 429, {
        error: { code: 'too_many_requests', details: { retryAfter: 20 } }
      })
    )
    service.start()
    await flush()
    expect(api.polls).toBe(1)
    await flush(19_000)
    expect(api.polls).toBe(1)
    await flush(1_000)
    expect(api.polls).toBe(2)
    await service.stop()
  })

  it('sin red: reintenta cada vez más espaciado (3, 6, 12 s) y vuelve a 3 s al recuperarse', async () => {
    const { api, service } = setup()
    for (let i = 0; i < 3; i++) api.pollErrors.push(new ApiError('network_error', 0))
    service.start()
    await flush()
    expect(api.polls).toBe(1)
    await flush(3_000)
    expect(api.polls).toBe(2)
    await flush(6_000)
    expect(api.polls).toBe(3)
    await flush(12_000)
    expect(api.polls).toBe(4) // esta ya va bien
    await flush(3_000)
    expect(api.polls).toBe(5)
    await service.stop()
  })
})

describe('HostService — solicitudes y sesiones', () => {
  it('rechaza sin abrir conexión si faltan permisos o está bloqueado', async () => {
    const { api, state, sessions, service } = setup()
    state.support = { state: 'missing_permissions', missing: ['screen'] }
    api.pending = [request('r1')]
    service.start()
    await flush()
    expect(api.lastState).toBe('missing_permissions')
    expect(api.rejections).toEqual([
      { requestId: 'r1', reason: 'missing_permissions', retryAfter: undefined }
    ])

    state.support = { state: 'available' }
    state.lock = 600
    api.pending = [request('r2')]
    await flush(POLL_INTERVAL_MS)
    expect(api.rejections.at(-1)).toEqual({ requestId: 'r2', reason: 'locked', retryAfter: 600 })
    expect(sessions).toHaveLength(0)
    await service.stop()
  })

  it('una sesión a la vez: la segunda solicitud recibe "ocupado" y el equipo se publica como busy', async () => {
    const { api, sessions, service } = setup()
    api.pending = [request('r1'), request('r2', 'Móvil')]
    service.start()
    await flush()
    expect(api.answers).toEqual([{ requestId: 'r1', answer: 'v=0 respuesta' }])
    expect(api.rejections).toEqual([{ requestId: 'r2', reason: 'busy', retryAfter: undefined }])
    expect(sessions).toHaveLength(1)
    await flush(POLL_INTERVAL_MS)
    expect(api.lastState).toBe('busy')
    await service.stop()
  })

  it('al empezar y al terminar: bandeja, notificaciones y registro con la duración', async () => {
    const { api, sessions, statuses, notifications, logs, service } = setup()
    api.pending = [request('r1')]
    service.start()
    await flush()
    sessions[0].start()
    await flush()
    expect(service.isActive()).toBe(true)
    expect(statuses.at(-1)).toBe('active:Portátil')
    expect(notifications).toEqual(['session-start:Portátil'])

    await flush(5_000)
    sessions[0].end()
    await flush()
    expect(service.isActive()).toBe(false)
    expect(notifications).toEqual(['session-start:Portátil', 'session-end:Portátil'])
    expect(logs.map((l) => l.type)).toEqual(['session-start', 'session-end'])
    expect(logs[1]).toMatchObject({ controller: 'Portátil', durationMs: 5_000 })
    expect(statuses.at(-1)).toBe('available')
    expect(api.lastState).toBe('available')
    await service.stop()
  })

  it('una conexión que no llega a autenticarse no cuenta como sesión', async () => {
    const { api, sessions, notifications, logs, service } = setup()
    api.pending = [request('r1')]
    service.start()
    await flush()
    sessions[0].session.close('expired')
    await flush()
    expect(notifications).toEqual([])
    expect(logs).toEqual([])
    expect(api.lastState).toBe('available')
    await service.stop()
  })

  it('desactivar el control remoto corta la sesión al momento', async () => {
    const { api, state, sessions, service } = setup()
    api.pending = [request('r1')]
    service.start()
    await flush()
    sessions[0].start()
    await flush()
    state.enabled = false
    await service.settingsChanged()
    expect(sessions[0].session.closedWith).toBe('disabled')
    await flush()
    expect(api.lastState).toBe('disabled')
    await service.stop()
  })

  it('cambiar la contraseña y "Desconectar" cortan la sesión', async () => {
    const { api, sessions, service } = setup()
    api.pending = [request('r1')]
    service.start()
    await flush()
    service.passwordChanged()
    expect(sessions[0].session.closedWith).toBe('password_changed')

    api.pending = [request('r2')]
    await flush(POLL_INTERVAL_MS)
    service.disconnect()
    expect(sessions[1].session.closedWith).toBe('local')
    await service.stop()
  })

  it('si la solicitud caduca antes de responder, se cierra la conexión creada', async () => {
    const { api, sessions, service } = setup()
    api.answerErrors.push(new ApiError('remote_request_expired', 410))
    api.pending = [request('r1')]
    service.start()
    await flush()
    expect(sessions[0].session.closedWith).toBe('expired')
    expect(service.isActive()).toBe(false)
    await service.stop()
  })

  it('mantener despierto solo con la opción y el control remoto activados; parar lo apaga todo', async () => {
    const { state, keepAwake, statuses, sessions, api, service } = setup()
    state.preventSleep = true
    api.pending = [request('r1')]
    service.start()
    await flush()
    expect(keepAwake).toEqual([true])
    await service.stop()
    expect(sessions[0].session.closedWith).toBe('stopped')
    expect(keepAwake).toEqual([true, false])
    expect(statuses.at(-1)).toBe('off')
  })
})
