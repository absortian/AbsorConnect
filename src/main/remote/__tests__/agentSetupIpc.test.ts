import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  main: { webContents: { mainFrame: {} } },
  account: {} as object | null,
  confirm: vi.fn(),
  state: vi.fn(),
  scope: vi.fn(),
  begin: vi.fn(),
  recover: vi.fn(),
  commit: vi.fn(),
  cancel: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      h.handlers.set(name, handler)
  },
  dialog: { showMessageBox: h.confirm }
}))
vi.mock('../../background', () => ({ getMainWindow: () => h.main }))
vi.mock('../../cloud/session', () => ({ currentSession: () => h.account }))
vi.mock('../../store', () => ({ getLanguage: async () => 'es' }))
vi.mock('../hostRuntime', () => ({
  remoteHostStarted: async () => {},
  agentSetup: () => ({
    state: h.state,
    confirmationScope: h.scope,
    begin: h.begin,
    recover: h.recover,
    commit: h.commit,
    cancel: h.cancel
  })
}))
beforeAll(async () => {
  ;(await import('../agentSetupIpc')).setupAgentSetupIpc()
})
const state = {
  phase: 'idle',
  providerAvailable: true,
  busy: false,
  canCommit: false,
  freshEnrollmentRequired: false,
  readyForUnattended: false
}
beforeEach(() => {
  vi.clearAllMocks()
  h.account = {}
  h.state.mockResolvedValue({
    ...state,
    key: 'K-never-render',
    credential: 'acg_private',
    accountBinding: 'private-binding',
    transactionId: 'private-transaction'
  })
  h.scope.mockResolvedValue('private-scope')
  h.confirm.mockResolvedValue({ response: 1 })
  for (const fn of [h.begin, h.recover, h.commit, h.cancel])
    fn.mockResolvedValue({ ok: true, state: { ...state, token: 'account-private' } })
})
const main = (): { sender: typeof h.main.webContents; senderFrame: object } => ({
  sender: h.main.webContents,
  senderFrame: h.main.webContents.mainFrame
})
it('cada canal rechaza ventana/visor/host/subframe y argumentos extra antes de consultar', async () => {
  for (const handler of h.handlers.values())
    for (const event of [
      { sender: {}, senderFrame: h.main.webContents.mainFrame },
      { sender: h.main.webContents, senderFrame: {} }
    ])
      expect(await handler(event)).toEqual({ ok: false, code: 'forbidden' })
  for (const [name, handler] of h.handlers)
    expect(
      await handler(
        main(),
        ...(name.endsWith(':prepare')
          ? [{ confirmLocal: false, activate: true }, 'extra']
          : ['extra'])
      )
    ).toEqual({ ok: false, code: 'forbidden' })
  expect(h.state).not.toHaveBeenCalled()
  expect(h.scope).not.toHaveBeenCalled()
  expect(h.confirm).not.toHaveBeenCalled()
})
it.each([
  null,
  {},
  true,
  { confirmLocal: false },
  { confirmLocal: 'false', activate: true },
  { confirmLocal: false, activate: true, path: '/tmp' }
])('prepare valida elección cerrada %j', async (value) => {
  expect(await h.handlers.get('agent-setup:prepare')!(main(), value)).toEqual({
    ok: false,
    code: 'forbidden'
  })
  expect(h.begin).not.toHaveBeenCalled()
  expect(h.confirm).not.toHaveBeenCalled()
})
it.each(['prepare', 'recover', 'commit', 'cancel', 'retire'])(
  '%s confirma en Main, revalida y proyecta solo estado público',
  async (action) => {
    const result = await h.handlers.get('agent-setup:' + action)!(
      main(),
      ...(action === 'prepare' ? [{ confirmLocal: false, activate: true }] : [])
    )
    expect(result).toEqual({ ok: true, state })
    expect(h.confirm).toHaveBeenCalledOnce()
    expect(h.scope).toHaveBeenCalledTimes(2)
    const text = JSON.stringify(result)
    for (const secret of [
      'account-private',
      'acg_private',
      'K-never-render',
      'private-binding',
      'private-transaction',
      'private-scope'
    ])
      expect(text).not.toContain(secret)
    if (action === 'prepare')
      expect(h.begin).toHaveBeenCalledExactlyOnceWith({ confirmLocal: false, activate: true })
    else
      expect(
        action === 'recover' ? h.recover : action === 'commit' ? h.commit : h.cancel
      ).toHaveBeenCalledExactlyOnceWith()
  }
)
it.each([
  'cancelled',
  'account',
  'account-during-scope',
  'target',
  'unavailable',
  'busy',
  'signed-out'
])('%s impide la mutación', async (fault) => {
  if (fault === 'cancelled') h.confirm.mockResolvedValue({ response: 0 })
  if (fault === 'account')
    h.confirm.mockImplementation(async () => {
      h.account = {}
      return { response: 1 }
    })
  if (fault === 'target') h.scope.mockResolvedValueOnce('before').mockResolvedValueOnce('after')
  if (fault === 'account-during-scope')
    h.scope.mockResolvedValueOnce('private-scope').mockImplementationOnce(async () => {
      h.account = {}
      return 'private-scope'
    })
  if (fault === 'unavailable') h.state.mockResolvedValue({ ...state, providerAvailable: false })
  if (fault === 'busy') h.state.mockResolvedValue({ ...state, busy: true })
  if (fault === 'signed-out') h.account = null
  const result = (await h.handlers.get('agent-setup:prepare')!(main(), {
    confirmLocal: false,
    activate: true
  })) as { ok: boolean }
  expect(result.ok).toBe(false)
  expect(h.begin).not.toHaveBeenCalled()
})
it('get no confirma ni entrega secretos y fuerza readyForUnattended=false', async () => {
  h.state.mockResolvedValue({ ...state, readyForUnattended: true, key: 'private' })
  expect(await h.handlers.get('agent-setup:get')!(main())).toEqual({ ok: true, state })
  expect(h.confirm).not.toHaveBeenCalled()
})
