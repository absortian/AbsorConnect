import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest'
import { absentLocalAgent } from '../../../shared/remote/localAgent'
const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  main: { webContents: { id: 1, mainFrame: {} } },
  bind: vi.fn(),
  snapshot: vi.fn(),
  state: vi.fn(),
  password: vi.fn(),
  permission: vi.fn(),
  secret: vi.fn(),
  stop: vi.fn(),
  available: vi.fn(),
  confirm: vi.fn(),
  account: { email: 'owner@example.invalid', token: 'account-token-not-for-renderer' } as object
}))
vi.mock('electron', () => ({
  dialog: { showMessageBox: h.confirm },
  ipcMain: {
    handle: (name: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      h.handlers.set(name, handler)
  }
}))
vi.mock('../../background', () => ({ getMainWindow: () => h.main }))
vi.mock('../../cloud/session', () => ({ currentSession: () => h.account }))
vi.mock('../../store', () => ({ getLanguage: async () => 'es' }))
vi.mock('../hostSession', () => ({ primeFirewall: vi.fn() }))
vi.mock('../platformSupport', () => ({ openPermissionSettings: h.permission }))
vi.mock('../hostRuntime', () => ({
  remoteHostStarted: async () => {},
  remoteHost: () => ({
    store: {
      snapshot: h.snapshot,
      getLog: async () => [],
      getKey: h.secret,
      setPassword: h.password
    },
    service: {
      isActive: () => false,
      isAgentOwned: () => false,
      isAgentManaged: () => true,
      didOwnershipPersistenceFail: () => false
    },
    support: () => ({ state: 'available' }),
    bindToAccount: h.bind,
    agentState: h.state,
    nativeStopAvailable: h.available,
    stopNativeHost: h.stop
  })
}))
const original = Object.getOwnPropertyDescriptor(process, 'getSystemVersion')
beforeAll(async () => {
  Object.defineProperty(process, 'getSystemVersion', { configurable: true, value: () => '27.0.1' })
  const module = await import('../remoteSettings')
  module.setupRemoteSettingsIpc()
})
afterAll(() => {
  if (original) Object.defineProperty(process, 'getSystemVersion', original)
  else Reflect.deleteProperty(process, 'getSystemVersion')
})
beforeEach(() => {
  vi.clearAllMocks()
  h.available.mockResolvedValue(true)
  h.confirm.mockResolvedValue({ response: 0 })
  h.stop.mockResolvedValue({ ok: true, freshEnrollmentRequired: true })
  h.account = { email: 'owner@example.invalid', token: 'account-token-not-for-renderer' }
  h.snapshot.mockResolvedValue({
    enabled: false,
    deviceName: 'PC datos ficticios',
    hasPassword: true,
    features: { clipboard: false, files: false, audio: false },
    confirmLocal: false,
    preventSleep: false,
    encryptionAvailable: true,
    key: 'legacy-key-not-for-renderer'
  })
  h.state.mockResolvedValue({
    ...absentLocalAgent(),
    ownership: 'agent',
    phase: 'responding',
    deviceId: '01234567-89ab-4def-8123-456789abcdef',
    state: 'active',
    active: true,
    token: 'agent-token-not-for-renderer',
    key: 'agent-key-not-for-renderer',
    pid: 99
  })
})
const main = (): { sender: typeof h.main.webContents; senderFrame: object } => ({
  sender: h.main.webContents,
  senderFrame: h.main.webContents.mainFrame
})
it('solo el frame principal consulta estado y su proyección no lleva secretos o datos del proceso', async () => {
  const value = (await h.handlers.get('remote-settings:get')!(main())) as {
    ok: boolean
    state: Record<string, unknown>
  }
  expect(value.ok).toBe(true)
  expect(value.state.localAgent).toEqual({
    ...absentLocalAgent(),
    ownership: 'agent',
    phase: 'responding',
    deviceId: '01234567-89ab-4def-8123-456789abcdef',
    state: 'active',
    active: true
  })
  const text = JSON.stringify(value)
  for (const word of ['account-token', 'legacy-key', 'agent-token', 'agent-key', 'pid'])
    expect(text).not.toContain(word)
  expect(h.secret).not.toHaveBeenCalled()
})
it('visores, host oculto, identidades copiadas y subframes se rechazan antes de leer o mutar', async () => {
  for (const event of [
    { sender: { id: 2 }, senderFrame: h.main.webContents.mainFrame },
    { sender: { ...h.main.webContents }, senderFrame: h.main.webContents.mainFrame },
    { sender: h.main.webContents, senderFrame: {} }
  ])
    for (const [name, handler] of h.handlers) {
      expect(await handler(event, ...(name.endsWith(':get') ? [] : ['unexpected']))).toEqual({
        ok: false,
        code: 'forbidden'
      })
    }
  expect(h.bind).not.toHaveBeenCalled()
  expect(h.snapshot).not.toHaveBeenCalled()
  expect(h.state).not.toHaveBeenCalled()
  expect(h.password).not.toHaveBeenCalled()
  expect(h.permission).not.toHaveBeenCalled()
})
it('ni el frame principal puede añadir argumentos no definidos al contrato', async () => {
  for (const [name, handler] of h.handlers) {
    const args = name.endsWith(':get') ? ['extra'] : ['value', 'extra']
    expect(await handler(main(), ...args)).toEqual({ ok: false, code: 'forbidden' })
  }
  expect(h.bind).not.toHaveBeenCalled()
  expect(h.state).not.toHaveBeenCalled()
})

it('la parada local exige confirmación Main y devuelve únicamente el resultado público', async () => {
  const stop = h.handlers.get('remote-settings:stop-agent')!
  expect(await stop(main())).toEqual({ ok: false, code: 'cancelled' })
  expect(h.stop).not.toHaveBeenCalled()
  h.confirm.mockResolvedValueOnce({ response: 1 })
  expect(await stop(main())).toEqual({ ok: true, freshEnrollmentRequired: true })
  expect(h.stop).toHaveBeenCalledTimes(1)
  expect(h.stop).toHaveBeenCalledWith()
  expect(h.secret).not.toHaveBeenCalled()
})
it('un cambio de cuenta o de equipo durante la confirmación invalida la parada', async () => {
  const stop = h.handlers.get('remote-settings:stop-agent')!
  h.confirm.mockImplementationOnce(async () => {
    h.account = {}
    return { response: 1 }
  })
  expect(await stop(main())).toEqual({ ok: false, code: 'cancelled' })
  const before = await h.state()
  h.state
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce({ ...before, deviceId: '22345678-1234-4abc-8def-123456789abc' })
  h.confirm.mockResolvedValueOnce({ response: 1 })
  expect(await stop(main())).toEqual({ ok: false, code: 'local_agent_unverified' })
  expect(h.stop).not.toHaveBeenCalled()
})
it('componente ausente o servicio sin verificar no abre confirmación ni envía parada', async () => {
  const stop = h.handlers.get('remote-settings:stop-agent')!
  h.available.mockResolvedValue(false)
  expect(await stop(main())).toEqual({ ok: false, code: 'local_agent_control_unavailable' })
  h.available.mockResolvedValue(true)
  h.state.mockResolvedValue({ ...absentLocalAgent(), ownership: 'unknown', phase: 'unverified' })
  expect(await stop(main())).toEqual({ ok: false, code: 'local_agent_control_unavailable' })
  expect(h.confirm).not.toHaveBeenCalled()
  expect(h.stop).not.toHaveBeenCalled()
})
