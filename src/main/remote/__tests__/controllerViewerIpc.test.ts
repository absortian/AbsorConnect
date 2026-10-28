import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VIEWER_IPC } from '../../../shared/remote/viewerBridge'
type WindowStub = { title: string; webContents: { id: number; mainFrame: object }; close(): void }
const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  windows: [] as WindowStub[],
  account: null as { token: string } | null,
  api: vi.fn(),
  saveDialog: vi.fn(),
  sent: vi.fn(),
  clipboardCallback: null as ((content: unknown) => void) | null,
  clipboardStops: 0,
  main: { webContents: { id: 1, mainFrame: {} }, isDestroyed: () => false }
}))
vi.mock('electron', () => {
  let nextId = 10
  class Window {
    title: string
    dead = false
    events = new Map<string, () => void>()
    webContents = { id: nextId++, mainFrame: {}, send: h.sent }
    constructor(options: { title: string }) {
      this.title = options.title
      h.windows.push(this)
    }
    isDestroyed(): boolean {
      return this.dead
    }
    on(event: string, callback: () => void): void {
      this.events.set(event, callback)
    }
    once(event: string, callback: () => void): void {
      this.on(event, callback)
    }
    show = vi.fn<() => void>()
    focus = vi.fn<() => void>()
    close(): void {
      this.dead = true
      this.events.get('closed')?.()
    }
    loadFile = vi.fn(async (): Promise<void> => undefined)
    loadURL = vi.fn(async (): Promise<void> => undefined)
  }
  return {
    BrowserWindow: Window,
    app: { getPath: () => '/tmp' },
    ipcMain: {
      handle: (name: string, callback: (event: unknown, ...args: unknown[]) => unknown) =>
        h.handlers.set(name, callback),
      on: vi.fn()
    },
    dialog: { showSaveDialog: h.saveDialog, showMessageBox: vi.fn() },
    shell: { showItemInFolder: vi.fn() },
    clipboard: {},
    nativeImage: {}
  }
})
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../background', () => ({ getMainWindow: () => h.main }))
vi.mock('../../store', () => ({ getLanguage: async () => 'es', getTheme: async () => 'dark' }))
vi.mock('../../cloud/session', () => ({ currentSession: () => h.account }))
vi.mock('../../cloud/apiClient', () => ({
  apiRequest: (...args: unknown[]) => h.api(...args),
  ApiError: class extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
      readonly body: unknown = null
    ) {
      super(code)
    }
  }
}))
vi.mock('../hostRuntime', () => ({ remoteHost: () => ({ ownDeviceId: async () => null }) }))
vi.mock('../clipboardSync', () => ({
  ClipboardWatcher: class {
    running = false
    constructor(callback: (content: unknown) => void) {
      h.clipboardCallback = callback
    }
    start(): void {
      this.running = true
    }
    stop(): void {
      this.running = false
      h.clipboardStops++
    }
    write = vi.fn()
  }
}))
import { closeAllViewers, setupControllerIpc } from '../controllerRuntime'
const id = '12345678-1234-4abc-8def-123456789abc',
  requestId = '22345678-1234-4abc-8def-123456789abc'
const device = {
  id,
  name: 'PC autorizado',
  online: true,
  lastSeenAt: '2026-10-28T00:00:00Z',
  remote: { state: 'available' }
}
const mainEvent = (): object => ({
  sender: h.main.webContents,
  senderFrame: h.main.webContents.mainFrame
})
const viewerEvent = (window = h.windows[0]): object => ({
  sender: window.webContents,
  senderFrame: window.webContents.mainFrame
})
const invoke = (name: string, event: unknown, ...args: unknown[]): unknown =>
  h.handlers.get(name)!(event, ...args)
beforeAll(() => setupControllerIpc())
beforeEach(() => {
  h.account = { token: 'public-fixture-token' }
  h.sent.mockClear()
  h.clipboardCallback = null
  h.clipboardStops = 0
  h.api.mockReset().mockImplementation(async (method: string, path: string) => {
    if (path === '/api/devices') return { devices: [device] }
    if (method === 'POST') return { id: requestId }
    if (path === `/api/remote-requests/${requestId}`)
      return { status: 'answered', answer: 'public-fixture-answer' }
    throw new Error('unexpected_api_route')
  })
})
afterEach(() => {
  closeAllViewers()
  h.windows.length = 0
  h.saveDialog.mockReset()
})
it('solo main puede abrir; el nombre procede de la API y otro frame no tiene IPC de visor', async () => {
  expect(
    await invoke(
      'remote-open-viewer',
      { sender: h.main.webContents, senderFrame: {} },
      id,
      'Nombre falso'
    )
  ).toBe(false)
  expect(h.api).not.toHaveBeenCalled()
  expect(await invoke('remote-open-viewer', mainEvent(), id, 'Nombre falso')).toBe(true)
  expect(h.windows[0].title).toBe('PC autorizado')
  expect(
    await invoke(VIEWER_IPC.availability, { sender: h.windows[0].webContents, senderFrame: {} })
  ).toEqual({ ok: false, code: 'forbidden' })
  expect(await invoke(VIEWER_IPC.availability, viewerEvent())).toEqual({
    ok: true,
    online: true,
    available: true,
    lastSeenAt: device.lastSeenAt
  })
})
it('fija solicitudes al visor correcto; otro visor no puede consultar una respuesta ajena', async () => {
  await invoke('remote-open-viewer', mainEvent(), id)
  const event = viewerEvent()
  expect(await invoke(VIEWER_IPC.request, event, 'public-fixture-offer')).toEqual({
    ok: true,
    id: requestId
  })
  const before = h.api.mock.calls.length
  expect(await invoke(VIEWER_IPC.poll, event, '32345678-1234-4abc-8def-123456789abc')).toEqual({
    status: 'error',
    code: 'remote_request_not_found'
  })
  expect(h.api.mock.calls.length).toBe(before)
  expect(await invoke(VIEWER_IPC.poll, event, requestId)).toEqual({
    status: 'answered',
    answer: 'public-fixture-answer'
  })
})
it('no devuelve una creación tardía ni reutiliza el visor al cambiar de cuenta', async () => {
  await invoke('remote-open-viewer', mainEvent(), id)
  const event = viewerEvent()
  let complete!: (value: unknown) => void
  h.api.mockImplementationOnce(
    () =>
      new Promise((r) => {
        complete = r
      })
  )
  const creating = invoke(VIEWER_IPC.request, event, 'public-fixture-offer')
  expect(await invoke(VIEWER_IPC.request, event, 'public-fixture-offer')).toEqual({
    ok: false,
    code: 'busy'
  })
  h.account = { token: 'another-public-fixture-token' }
  complete({ id: requestId })
  expect(await creating).toEqual({ ok: false, code: 'forbidden' })
  const before = h.api.mock.calls.length
  expect(await invoke(VIEWER_IPC.availability, event)).toEqual({ ok: false, code: 'forbidden' })
  expect(h.api.mock.calls.length).toBe(before)
})
it('un diálogo de guardado tardío no crea un fichero tras perder la cuenta', async () => {
  await invoke('remote-open-viewer', mainEvent(), id)
  const dir = await mkdtemp(join(tmpdir(), 'absor-viewer-late-save-'))
  try {
    const target = join(dir, 'not-created', 'fixture.txt')
    let choice!: (value: unknown) => void
    h.saveDialog.mockImplementationOnce(
      () =>
        new Promise((r) => {
          choice = r
        })
    )
    const saving = invoke(VIEWER_IPC.saveBegin, viewerEvent(), 1, 'fixture.txt', 1)
    h.account = { token: 'new-public-fixture-token' }
    choice({ canceled: false, filePath: target })
    expect(await saving).toEqual({ ok: false, reason: 'cancelled' })
    await expect(stat(join(dir, 'not-created'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('el vigilante del portapapeles no entrega contenido de otra cuenta durante el cierre', async () => {
  await invoke('remote-open-viewer', mainEvent(), id)
  await invoke(VIEWER_IPC.clipboardWatch, viewerEvent(), true)
  h.clipboardCallback!({ kind: 'text', text: 'dato ficticio autorizado' })
  expect(h.sent).toHaveBeenCalledTimes(1)
  h.account = { token: 'changed-public-fixture-token' }
  h.clipboardCallback!({ kind: 'text', text: 'dato ficticio posterior' })
  expect(h.sent).toHaveBeenCalledTimes(1)
  expect(h.clipboardStops).toBeGreaterThan(0)
})
