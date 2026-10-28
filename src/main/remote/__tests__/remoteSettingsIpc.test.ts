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
  secret: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      h.handlers.set(name, handler)
  }
}))
vi.mock('../../background', () => ({ getMainWindow: () => h.main }))
vi.mock('../../cloud/session', () => ({
  currentSession: () => ({
    email: 'owner@example.invalid',
    token: 'account-token-not-for-renderer'
  })
}))
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
    agentState: h.state
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
