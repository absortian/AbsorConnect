import { beforeEach, expect, it, vi } from 'vitest'
import { absentLocalAgent, type LocalAgentSnapshot } from '../../../shared/remote/localAgent'

const h = vi.hoisted(() => ({
  state: {} as LocalAgentSnapshot,
  load: vi.fn(),
  bind: vi.fn(),
  identity: vi.fn(),
  read: vi.fn(),
  close: vi.fn(),
  watch: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  reserve: vi.fn(),
  disable: vi.fn(),
  intent: vi.fn(),
  owned: undefined as undefined | (() => Promise<void>),
  managed: false,
  closed: false
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/test', getVersion: () => 'test' },
  powerSaveBlocker: {}
}))
vi.mock('../../cloud/session', () => ({
  currentSession: () => ({ token: 'never-render', email: 'lab@example.invalid' }),
  loadSession: h.load
}))
vi.mock('../../updater', () => ({ refreshAgentUpdateGuard: vi.fn() }))
vi.mock('../../store', () => ({ getLanguage: async () => 'es' }))
vi.mock('../../background', () => ({
  getMainWindow: () => null,
  setRemoteStatus: vi.fn(),
  setLocalAgentState: vi.fn(),
  showMainWindow: vi.fn()
}))
vi.mock('../hostNotice', () => ({ notifyAccountExpired: vi.fn(), notifySession: vi.fn() }))
vi.mock('../hostSession', () => ({ openHostSession: vi.fn() }))
vi.mock('../linuxAudio', () => ({ linuxAudio: { cleanup: vi.fn() } }))
vi.mock('../safeBox', () => ({ createSafeBox: () => ({}) }))
vi.mock('../deviceApi', () => ({ devicePlatform: () => 'linux', DeviceApi: class {} }))
vi.mock('../deviceIdentity', () => ({
  DeviceIdentity: class {
    get = h.identity
  }
}))
vi.mock('../remoteAccessStore', () => ({
  RemoteAccessStore: class {
    bindToAccount = h.bind
    setEnabled = h.disable
  }
}))
vi.mock('../migrationJournal', () => ({
  MigrationJournal: class {
    intentPresent = h.intent
  },
  migrationStatusSource: vi.fn()
}))
vi.mock('../platformSupport', () => ({
  createSupportMonitor: () => ({ check: vi.fn() }),
  detectSupport: vi.fn()
}))
vi.mock('../agentStatusClient', () => ({
  installedAgentSource: vi.fn(),
  AgentStatusClient: class {
    get isClosed(): boolean {
      return h.closed
    }
    read = h.read
    watch = h.watch
    close(): void {
      h.closed = true
      h.close()
    }
  }
}))
vi.mock('../hostService', () => ({
  HostService: class {
    constructor(deps: { onAgentOwned: () => Promise<void> }) {
      h.owned = deps.onAgentOwned
    }
    start = h.start
    stop = h.stop
    async reserveForLocalAgent(): Promise<void> {
      h.managed = true
      await h.reserve()
    }
    isAgentManaged(): boolean {
      return h.managed
    }
  }
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  h.state = absentLocalAgent()
  h.closed = false
  h.managed = false
  h.owned = undefined
  h.intent.mockResolvedValue(false)
  h.read.mockImplementation(async () => h.state)
  h.load.mockResolvedValue(undefined)
  h.identity.mockResolvedValue({ id: 'legacy-device' })
})
it.each(['present', 'corrupt', 'absent'])(
  'la reserva conserva el origen de migración %s',
  async (mode) => {
    if (mode === 'corrupt') h.intent.mockRejectedValue(Error('corrupt'))
    else h.intent.mockResolvedValue(mode === 'present')
    const runtime = await import('../hostRuntime')
    await runtime.startRemoteHost()
    await h.owned!()
    if (mode === 'absent') expect(h.disable).toHaveBeenCalledExactlyOnceWith(false)
    else expect(h.disable).not.toHaveBeenCalled()
    await runtime.stopRemoteHost()
  }
)

it('el arranque simultáneo se comparte y el modo legado conserva su identidad y cuenta', async () => {
  const runtime = await import('../hostRuntime')
  expect(runtime.startRemoteHost()).toBe(runtime.startRemoteHost())
  await runtime.remoteHostStarted()
  expect(h.start).toHaveBeenCalledTimes(1)
  expect(h.bind).toHaveBeenCalledExactlyOnceWith('lab@example.invalid')
  expect(await runtime.remoteHost().ownDeviceId()).toBe('legacy-device')
  expect(h.reserve).not.toHaveBeenCalled()
  await runtime.stopRemoteHost()
})

it.each(['agent', 'unknown'] as const)(
  'la propiedad %s reserva antes de arrancar, sin identidad ni vínculo legado',
  async (ownership) => {
    h.state = {
      ...absentLocalAgent(),
      ownership,
      phase: 'unverified',
      deviceId: ownership === 'agent' ? 'native-device' : null
    }
    const runtime = await import('../hostRuntime')
    await runtime.startRemoteHost()
    expect(h.reserve).toHaveBeenCalledTimes(1)
    expect(h.reserve.mock.invocationCallOrder[0]).toBeLessThan(h.start.mock.invocationCallOrder[0])
    expect(await runtime.remoteHost().ownDeviceId()).toBe(h.state.deviceId)
    await runtime.remoteHost().bindToAccount('another@example.invalid')
    expect(h.bind).not.toHaveBeenCalled()
    expect(h.identity).not.toHaveBeenCalled()
    await runtime.stopRemoteHost()
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.stop).toHaveBeenCalledExactlyOnceWith('stopped')
  }
)

it.each(['account', 'probe'] as const)(
  'salir durante %s impide un arranque tardío',
  async (phase) => {
    let complete!: () => void
    const gate = new Promise<void>((resolve) => {
      complete = resolve
    })
    if (phase === 'account') h.load.mockReturnValue(gate)
    else
      h.read.mockImplementation(async () => {
        await gate
        return h.state
      })
    const runtime = await import('../hostRuntime')
    const pending = runtime.startRemoteHost()
    await vi.waitFor(() => expect(phase === 'account' ? h.load : h.read).toHaveBeenCalled())
    await runtime.stopRemoteHost()
    complete()
    await pending
    expect(h.start).not.toHaveBeenCalled()
    expect(h.watch).not.toHaveBeenCalled()
    expect(h.bind).not.toHaveBeenCalled()
    expect(h.identity).not.toHaveBeenCalled()
  }
)
