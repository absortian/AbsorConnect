import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HostSessionContext } from '../hostSession'
const h = vi.hoisted(() => ({
  verify: vi.fn(),
  create: vi.fn(),
  snapshot: vi.fn(),
  dispose: vi.fn(),
  destroyed: false
}))
vi.mock('electron', () => ({
  app: {},
  BrowserWindow: class {},
  desktopCapturer: {},
  ipcMain: {},
  session: {},
  screen: {
    getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1280, height: 720 } }),
    getAllDisplays: () => [{ id: 1 }]
  }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../hostAuth', () => ({
  HostAuth: class {
    verify = h.verify
  }
}))
vi.mock('../hostNotice', () => ({ confirmLocally: vi.fn(), openSessionNotice: vi.fn() }))
vi.mock('../input', () => ({
  createInputController: h.create,
  nativeDisplayRect: () => ({ x: 0, y: 0, width: 1280, height: 720 })
}))
vi.mock('../linuxAudio', () => ({ linuxAudio: { stop: vi.fn() } }))
vi.mock('../clipboardSync', () => ({ ClipboardWatcher: class {} }))
vi.mock('../fileTransfer', () => ({ HostFiles: class {} }))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  h.destroyed = false
  h.verify.mockResolvedValue({ ok: true })
  h.snapshot.mockResolvedValue({ confirmLocal: false })
  h.dispose.mockResolvedValue(undefined)
  h.create.mockResolvedValue({ dispose: h.dispose, setDisplayRect: vi.fn() })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
async function setup(): Promise<import('../hostSession').ActiveHostSession> {
  const { ActiveHostSession } = await import('../hostSession')
  const window = {
    webContents: { id: 1, send: vi.fn(), isCrashed: () => false },
    isDestroyed: () => h.destroyed,
    destroy: () => {
      h.destroyed = true
    }
  }
  const session = new ActiveHostSession(
    window as never,
    { id: 'request', offer: 'offer', controllerName: 'Ficticio', createdAt: '' },
    {
      store: { snapshot: h.snapshot },
      iceServers: async () => [],
      language: async () => 'es'
    } as HostSessionContext,
    { clipboard: false, files: false, audio: false },
    'Ficticio'
  )
  session.onAnswer('answer')
  await session.waitForAnswer()
  return session
}
it('cerrar durante verificación impide entrada tardía y ended espera el trabajo de autenticación', async () => {
  let verify!: (value: { ok: true }) => void
  h.verify.mockReturnValue(
    new Promise((resolve) => {
      verify = resolve
    })
  )
  const session = await setup()
  const auth = session.authenticate('proof')
  session.close('stopped')
  let ended = false
  void session.ended.then(() => {
    ended = true
  })
  await vi.advanceTimersByTimeAsync(400)
  expect(ended).toBe(false)
  verify({ ok: true })
  expect(await auth).toMatchObject({ ok: false, reason: 'declined' })
  await session.ended
  expect(ended).toBe(true)
  expect(h.create).not.toHaveBeenCalled()
  expect(h.snapshot).not.toHaveBeenCalled()
})
it('si la entrada se crea después del cierre se destruye y el drenaje espera su liberación', async () => {
  let create!: (value: unknown) => void, dispose!: () => void
  h.create.mockReturnValue(
    new Promise((resolve) => {
      create = resolve
    })
  )
  h.dispose.mockReturnValue(
    new Promise<void>((resolve) => {
      dispose = resolve
    })
  )
  const session = await setup(),
    auth = session.authenticate('proof')
  await vi.waitFor(() => expect(h.create).toHaveBeenCalledOnce())
  session.close('stopped')
  let ended = false
  void session.ended.then(() => {
    ended = true
  })
  await vi.advanceTimersByTimeAsync(400)
  create({ dispose: h.dispose, setDisplayRect: vi.fn() })
  await vi.waitFor(() => expect(h.dispose).toHaveBeenCalledOnce())
  expect(ended).toBe(false)
  dispose()
  expect(await auth).toMatchObject({ ok: false, reason: 'declined' })
  await session.ended
  expect(session.authenticated).toBe(false)
})
it('un fallo de liberación se conserva como error de drenaje y no permite migrar', async () => {
  const session = await setup()
  expect(await session.authenticate('proof')).toMatchObject({ ok: true })
  h.dispose.mockRejectedValue(Error('private-system-detail'))
  session.close('stopped')
  const ended = expect(session.ended).rejects.toThrow('host_cleanup_failed')
  await vi.advanceTimersByTimeAsync(400)
  await ended
})
it('un fallo del almacén durante autenticación tampoco se convierte en un cierre limpio', async () => {
  let reject!: (error: Error) => void
  h.verify.mockReturnValue(
    new Promise((_resolve, r) => {
      reject = r
    })
  )
  const session = await setup(),
    auth = session.authenticate('proof')
  session.close('stopped')
  const failure = expect(auth).rejects.toThrow('private-storage-detail')
  reject(Error('private-storage-detail'))
  await failure
  const ended = expect(session.ended).rejects.toThrow('host_cleanup_failed')
  await vi.advanceTimersByTimeAsync(400)
  await ended
  expect(h.create).not.toHaveBeenCalled()
})
