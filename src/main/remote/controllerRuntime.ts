// El lado del controlador en el escritorio (add-remote-desktop D11, tarea 4.9): la lista de equipos
// para la ventana principal y las ventanas de visor. Los canales `remote-viewer:*` solo atienden a
// las ventanas de visor abiertas desde aquí, y todas las llamadas a la API se hacen en este proceso:
// el token de la cuenta no llega a ningún renderer.
import { randomUUID } from 'crypto'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  shell
} from 'electron'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'
import { is } from '@electron-toolkit/utils'
import { ApiError, apiRequest } from '../cloud/apiClient'
import { currentSession } from '../cloud/session'
import { getLanguage, getTheme } from '../store'
import {
  AccountDevice,
  AccountDevicesResult,
  VIEWER_IPC,
  ViewerInit,
  ViewerPollResult,
  ViewerRequestResult
} from '../../shared/remote/viewerBridge'
import { IceServer } from '../../shared/remote/hostBridge'
import { ClipboardContent, clipboardFits } from '../../shared/remote/transfer'
import { ClipboardWatcher } from './clipboardSync'
import { FileSink, placeWithFreeName, sanitizeFileName, TransferError } from './fileTransfer'
import { remoteHost } from './hostRuntime'

/** Tamaño máximo de una descripción de sesión (el servicio admite 64 KB). */
const MAX_SDP_BYTES = 64 * 1024

/** Una descarga desde el PC: se escribe en un `.part` junto al destino. */
interface SaveJob {
  sink: FileSink
  /** Destino elegido en el diálogo; null si se guarda con nombre libre en una carpeta fija. */
  target: string | null
  dir: string
  name: string
}

interface ViewerWindow {
  window: BrowserWindow
  deviceId: string
  deviceName: string
  /** Portapapeles de este equipo mientras la sesión lo comparte (y no está en pausa). */
  clipboard: ClipboardWatcher | null
  saves: Map<number, SaveJob>
  /** Ficheros guardados en esta sesión: los únicos que se pueden mostrar en su carpeta. */
  saved: Set<string>
}

/** Ventanas de visor abiertas, por el id de su webContents. */
const viewers = new Map<number, ViewerWindow>()

function token(): string | undefined {
  return currentSession()?.token
}

function codeOf(error: unknown): string {
  return error instanceof ApiError ? error.code : 'network_error'
}

function retryAfterOf(error: unknown): number | undefined {
  const details = (error instanceof ApiError ? error.body : null) as {
    error?: { details?: { retryAfter?: unknown } }
  } | null
  const value = Number(details?.error?.details?.retryAfter)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function viewerFor(event: IpcMainInvokeEvent | IpcMainEvent): ViewerWindow | undefined {
  return viewers.get(event.sender.id)
}

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xffffffff

function isClipboardContent(value: unknown): value is ClipboardContent {
  if (typeof value !== 'object' || value === null) return false
  const content = value as Record<string, unknown>
  const valid =
    (content.kind === 'text' && typeof content.text === 'string') ||
    (content.kind === 'image' && content.png instanceof Uint8Array)
  return valid && clipboardFits(content as ClipboardContent)
}

/** Pide dónde guardar una descarga (o usa la carpeta de pruebas) y abre su `.part`. */
async function saveBegin(
  viewer: ViewerWindow,
  id: number,
  name: string,
  size: number
): Promise<{ ok: true } | { ok: false; reason: 'cancelled' | 'io' }> {
  const clean = sanitizeFileName(name)
  // Para las pruebas automáticas (lan-check): sin diálogo, con nombre libre en esa carpeta
  const fixedDir = process.env['ABSOR_CONNECT_SAVE_DIR']
  let target: string | null = null
  let dir: string
  if (fixedDir) {
    dir = fixedDir
  } else {
    const choice = await dialog.showSaveDialog(viewer.window, {
      defaultPath: join(app.getPath('downloads'), clean)
    })
    if (choice.canceled || !choice.filePath) return { ok: false, reason: 'cancelled' }
    target = choice.filePath
    dir = dirname(target)
  }
  try {
    await fs.mkdir(dir, { recursive: true })
    const part = join(dir, `.${basename(target ?? clean)}.${randomUUID().slice(0, 8)}.part`)
    viewer.saves.set(id, { sink: await FileSink.create(part, size), target, dir, name: clean })
    return { ok: true }
  } catch {
    return { ok: false, reason: 'io' }
  }
}

async function saveFinish(
  viewer: ViewerWindow,
  id: number,
  sha256: string
): Promise<{ ok: true; path: string } | { ok: false; reason: 'integrity' | 'io' | 'size' }> {
  const job = viewer.saves.get(id)
  if (!job) return { ok: false, reason: 'io' }
  viewer.saves.delete(id)
  try {
    await job.sink.finish(sha256)
    let path: string
    if (job.target) {
      // El diálogo ya ha preguntado si se sustituye un fichero existente
      await fs.rename(job.sink.partPath, job.target)
      path = job.target
    } else {
      path = join(job.dir, await placeWithFreeName(job.sink.partPath, job.dir, job.name))
    }
    viewer.saved.add(path)
    return { ok: true, path }
  } catch (error) {
    await fs.rm(job.sink.partPath, { force: true })
    return { ok: false, reason: error instanceof TransferError ? error.reason : 'io' }
  }
}

/** Al cerrar la ventana: se deja de vigilar el portapapeles y se borran las descargas a medias. */
function disposeViewer(viewer: ViewerWindow): void {
  viewer.clipboard?.stop()
  viewer.clipboard = null
  for (const job of viewer.saves.values()) void job.sink.abort()
  viewer.saves.clear()
}

/**
 * Al salir de la cuenta se cierran los visores, porque sus sesiones dependían de ella (tarea 4.10).
 * Cada visor se despide del PC al cerrarse (`beforeunload`).
 */
export function closeAllViewers(): void {
  for (const viewer of viewers.values()) {
    if (!viewer.window.isDestroyed()) viewer.window.close()
  }
}

/** Si la ventana es un visor: así index.ts no le pone los atajos de desarrollo (F12, Ctrl+R). */
export function isViewerWindow(window: BrowserWindow): boolean {
  return !window.isDestroyed() && viewers.has(window.webContents.id)
}

async function accountDevices(): Promise<AccountDevicesResult> {
  try {
    const data = await apiRequest<{ devices?: Omit<AccountDevice, 'self'>[] }>(
      'GET',
      '/api/devices',
      {
        token: token()
      }
    )
    const own = await remoteHost().ownDeviceId()
    return {
      ok: true,
      devices: (data?.devices ?? []).map((device) => ({ ...device, self: device.id === own }))
    }
  } catch (error) {
    return { ok: false, code: codeOf(error) }
  }
}

async function requestSession(viewer: ViewerWindow, offer: unknown): Promise<ViewerRequestResult> {
  if (typeof offer !== 'string' || offer.length === 0 || offer.length > MAX_SDP_BYTES) {
    return { ok: false, code: 'remote_request_invalid' }
  }
  try {
    const data = await apiRequest<{ id: string }>(
      'POST',
      `/api/devices/${viewer.deviceId}/remote-requests`,
      { token: token(), body: { offer } }
    )
    return { ok: true, id: data.id }
  } catch (error) {
    return { ok: false, code: codeOf(error), retryAfter: retryAfterOf(error) }
  }
}

async function pollRequest(requestId: unknown): Promise<ViewerPollResult> {
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    return { status: 'error', code: 'remote_request_not_found' }
  }
  try {
    const data = await apiRequest<{
      status: string
      answer?: string
      rejection?: { reason: string; retryAfter?: number }
    }>('GET', `/api/remote-requests/${requestId}`, { token: token() })
    if (data.status === 'answered' && typeof data.answer === 'string') {
      return { status: 'answered', answer: data.answer }
    }
    if (data.status === 'rejected' && data.rejection) {
      return { status: 'rejected', ...data.rejection }
    }
    return { status: 'pending' }
  } catch (error) {
    return { status: 'error', code: codeOf(error) }
  }
}

async function iceServers(): Promise<IceServer[]> {
  try {
    const data = await apiRequest<{ iceServers?: IceServer[] }>('GET', '/api/remote/ice-servers', {
      token: token()
    })
    return Array.isArray(data?.iceServers) ? data.iceServers : []
  } catch {
    return []
  }
}

/**
 * Abre la ventana de visor de un equipo (o enfoca la que ya esté abierta). Una ventana por
 * sesión: se pueden controlar varios PCs a la vez.
 */
export async function openViewer(deviceId: unknown, deviceName: unknown): Promise<boolean> {
  if (typeof deviceId !== 'string' || typeof deviceName !== 'string') return false
  for (const viewer of viewers.values()) {
    if (viewer.deviceId === deviceId && !viewer.window.isDestroyed()) {
      viewer.window.show()
      viewer.window.focus()
      return true
    }
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 320,
    title: deviceName,
    show: false,
    backgroundColor: '#11151d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/viewer.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  const id = window.webContents.id
  const viewer: ViewerWindow = {
    window,
    deviceId,
    deviceName: deviceName.slice(0, 100),
    clipboard: null,
    saves: new Map(),
    saved: new Set()
  }
  viewers.set(id, viewer)
  window.on('closed', () => {
    disposeViewer(viewer)
    viewers.delete(id)
  })
  window.once('ready-to-show', () => window.show())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    await window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/viewer.html`)
  } else {
    await window.loadFile(join(__dirname, '../renderer/viewer.html'))
  }
  return true
}

let ready = false

/** Canales del controlador: los de la ventana principal y los de los visores. */
export function setupControllerIpc(): void {
  if (ready) return
  ready = true
  ipcMain.handle('remote-devices', () => accountDevices())
  ipcMain.handle('remote-open-viewer', (_event, deviceId, deviceName) =>
    openViewer(deviceId, deviceName)
  )

  ipcMain.handle(VIEWER_IPC.init, async (event): Promise<ViewerInit | null> => {
    const viewer = viewerFor(event)
    if (!viewer) return null
    return {
      deviceId: viewer.deviceId,
      deviceName: viewer.deviceName,
      language: await getLanguage(),
      theme: await getTheme(),
      platform: process.platform,
      forceRelay: process.env['ABSOR_CONNECT_FORCE_RELAY'] === '1'
    }
  })
  ipcMain.handle(VIEWER_IPC.iceServers, (event) => (viewerFor(event) ? iceServers() : []))
  ipcMain.handle(VIEWER_IPC.request, (event, offer) => {
    const viewer = viewerFor(event)
    return viewer ? requestSession(viewer, offer) : { ok: false, code: 'forbidden' }
  })
  ipcMain.handle(VIEWER_IPC.poll, (event, requestId) =>
    viewerFor(event) ? pollRequest(requestId) : { status: 'error', code: 'forbidden' }
  )

  // Portapapeles de este equipo (D9): se vigila solo mientras el visor lo pide
  ipcMain.handle(VIEWER_IPC.clipboardWatch, (event, on) => {
    const viewer = viewerFor(event)
    if (!viewer) return
    if (on === true) {
      viewer.clipboard ??= new ClipboardWatcher((content) => {
        if (!viewer.window.isDestroyed())
          viewer.window.webContents.send(VIEWER_IPC.clipboard, content)
      })
      viewer.clipboard.start()
    } else {
      viewer.clipboard?.stop()
    }
  })
  ipcMain.on(VIEWER_IPC.clipboardWrite, (event, content) => {
    const viewer = viewerFor(event)
    // En pausa (sin vigilar) tampoco se escribe lo que llega
    if (viewer?.clipboard?.running && isClipboardContent(content)) viewer.clipboard.write(content)
  })

  // Descargas desde el PC (D9)
  ipcMain.handle(VIEWER_IPC.saveBegin, (event, id, name, size) => {
    const viewer = viewerFor(event)
    if (!viewer || !isId(id) || typeof name !== 'string' || !Number.isSafeInteger(size) || size < 0)
      return { ok: false, reason: 'io' }
    return saveBegin(viewer, id, name.slice(0, 255), size)
  })
  ipcMain.on(VIEWER_IPC.saveChunk, (event, id, chunk) => {
    if (isId(id) && chunk instanceof Uint8Array) viewerFor(event)?.saves.get(id)?.sink.write(chunk)
  })
  ipcMain.handle(VIEWER_IPC.saveFinish, (event, id, sha256) => {
    const viewer = viewerFor(event)
    if (!viewer || !isId(id) || typeof sha256 !== 'string') return { ok: false, reason: 'io' }
    return saveFinish(viewer, id, sha256)
  })
  ipcMain.on(VIEWER_IPC.saveCancel, (event, id) => {
    const viewer = viewerFor(event)
    const job = isId(id) ? viewer?.saves.get(id) : undefined
    if (!viewer || !job) return
    viewer.saves.delete(id)
    void job.sink.abort()
  })
  ipcMain.on(VIEWER_IPC.showInFolder, (event, path) => {
    const viewer = viewerFor(event)
    if (viewer && typeof path === 'string' && viewer.saved.has(path)) shell.showItemInFolder(path)
  })
}
