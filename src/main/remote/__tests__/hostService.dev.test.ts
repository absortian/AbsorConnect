// Prueba de integración de HostService con el backend de desarrollo REAL (tarea 4.8). Se salta si no
// se indica la API; con el backend de compose levantado:
//
//   bin/dev sh -c 'ABSOR_DEV_API=http://php npx vitest run src/main/remote/__tests__/hostService.dev.test.ts'
//
// Crea una cuenta de prueba con dos sesiones (este PC y un "controlador"), hace desde el
// controlador lo que hará el visor (lista de equipos, pedir sesión, esperar la respuesta) y al
// final borra el equipo y la cuenta. La conexión WebRTC se sustituye por una sesión simulada.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes, randomUUID } from 'crypto'
import { ApiError, apiRequest } from '../../cloud/apiClient'
import { DeviceApi, DeviceCredentials } from '../deviceApi'
import { HostService, HostSession } from '../hostService'
import { RemoteSupport } from '../support'

const API = process.env.ABSOR_DEV_API
const PASSWORD = 'contraseña-de-prueba-larga'

interface DeviceListEntry {
  id: string
  name: string
  online: boolean
  remote: { state: string; features: Record<string, boolean> }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  ms = 15_000
): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read()
    if (ok(value) || Date.now() > deadline) return value
    await sleep(500)
  }
}

describe.skipIf(!API)('HostService contra el backend de desarrollo', () => {
  let pcToken = ''
  let controllerToken = ''
  const device: DeviceCredentials = { id: randomUUID(), key: randomBytes(32).toString('base64url') }
  const state = { enabled: true, support: { state: 'available' } as RemoteSupport }
  const sessions: { start: () => void; end: () => void; closedWith?: string }[] = []
  let service: HostService

  const asController = <T>(method: string, path: string, body?: unknown): Promise<T> =>
    apiRequest<T>(method, path, { token: controllerToken, body })
  const listed = async (): Promise<DeviceListEntry | undefined> =>
    (await asController<{ devices: DeviceListEntry[] }>('GET', '/api/devices')).devices.find(
      (d) => d.id === device.id
    )
  const requestSession = (): Promise<{ id: string }> =>
    asController('POST', `/api/devices/${device.id}/remote-requests`, {
      offer: 'v=0 oferta de prueba'
    })
  const outcome = (
    id: string
  ): Promise<{ status: string; answer?: string; rejection?: { reason: string } }> =>
    waitFor(
      () => asController('GET', `/api/remote-requests/${id}`),
      (r: { status: string }) => r.status !== 'pending'
    )

  beforeAll(async () => {
    process.env.ABSOR_CONNECT_API_URL = API
    const email = `prueba-remoto-${Date.now()}@example.test`
    pcToken = (
      await apiRequest<{ token: string }>('POST', '/api/auth/register', {
        body: { email, password: PASSWORD, deviceName: 'Sobremesa de prueba' }
      })
    ).token
    controllerToken = (
      await apiRequest<{ token: string }>('POST', '/api/auth/login', {
        body: { email, password: PASSWORD, deviceName: 'Portátil de prueba' }
      })
    ).token

    service = new HostService({
      api: new DeviceApi(() => pcToken),
      identity: { get: async () => device, reset: async () => device },
      store: {
        isEnabled: async () => state.enabled,
        snapshot: async () => ({
          enabled: state.enabled,
          deviceName: 'Sobremesa de prueba',
          hasPassword: true,
          features: { clipboard: true, files: false, audio: true },
          confirmLocal: false,
          preventSleep: false,
          encryptionAvailable: true
        }),
        lockRemainingSeconds: async () => 0,
        addLog: async () => undefined
      },
      support: () => state.support,
      signedIn: () => pcToken !== '',
      platform: 'linux',
      appVersion: '0.4.0-dev',
      openSession: async () => {
        let start!: () => void
        let end!: () => void
        const started = new Promise<void>((resolve) => (start = resolve))
        const ended = new Promise<void>((resolve) => (end = resolve))
        const entry: { start: () => void; end: () => void; closedWith?: string } = { start, end }
        sessions.push(entry)
        const session: HostSession = {
          answer: 'v=0 respuesta de prueba',
          started,
          ended,
          close: (reason) => {
            entry.closedWith = reason
            end()
          }
        }
        return session
      },
      setKeepAwake: () => undefined,
      setStatus: () => undefined,
      notify: () => undefined
    })
    service.start()
  }, 30_000)

  afterAll(async () => {
    await service?.stop()
    if (pcToken) {
      await new DeviceApi(() => pcToken).remove(device).catch(() => undefined)
      await apiRequest('DELETE', '/api/me', { token: pcToken, body: { password: PASSWORD } })
    }
  }, 30_000)

  it('el equipo aparece en la cuenta del controlador, en línea y disponible, con sus funciones', async () => {
    const entry = await waitFor(listed, (d) => d?.online === true)
    expect(entry).toMatchObject({
      name: 'Sobremesa de prueba',
      online: true,
      remote: { state: 'available', features: { clipboard: true, files: false, audio: true } }
    })
  }, 30_000)

  it('una solicitud del controlador recibe la respuesta del PC; mientras dura, otra recibe "ocupado"', async () => {
    const first = await requestSession()
    expect(await outcome(first.id)).toEqual({
      status: 'answered',
      answer: 'v=0 respuesta de prueba'
    })

    const second = await requestSession()
    expect(await outcome(second.id)).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'busy' }
    })
    expect((await waitFor(listed, (d) => d?.remote.state === 'busy'))?.remote.state).toBe('busy')

    sessions[0].start()
    await sleep(500)
    expect(service.isActive()).toBe(true)
    sessions[0].end()
    expect((await waitFor(listed, (d) => d?.remote.state === 'available'))?.remote.state).toBe(
      'available'
    )
  }, 60_000)

  it('sin permisos: el PC lo publica y rechaza con ese motivo', async () => {
    state.support = { state: 'missing_permissions', missing: ['screen'] }
    service.refresh()
    expect(
      (await waitFor(listed, (d) => d?.remote.state === 'missing_permissions'))?.remote.state
    ).toBe('missing_permissions')
    const request = await requestSession()
    expect(await outcome(request.id)).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'missing_permissions' }
    })
    state.support = { state: 'available' }
  }, 60_000)

  it('desactivar corta la sesión y el servicio deja de aceptar solicitudes (remote_disabled)', async () => {
    service.refresh()
    await waitFor(listed, (d) => d?.remote.state === 'available')
    const request = await requestSession()
    await outcome(request.id)
    const session = sessions.at(-1)!
    session.start()
    await sleep(500)

    state.enabled = false
    await service.settingsChanged()
    expect(session.closedWith).toBe('disabled')
    expect((await waitFor(listed, (d) => d?.remote.state === 'disabled'))?.remote.state).toBe(
      'disabled'
    )
    const refused = await requestSession().catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(ApiError)
    expect((refused as ApiError).code).toBe('remote_disabled')
  }, 60_000)
})
