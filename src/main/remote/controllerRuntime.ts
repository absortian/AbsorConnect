// El lado del controlador en el escritorio (add-remote-desktop D11, tarea 4.9): la lista de equipos
// para la ventana principal y las ventanas de visor. Los canales `remote-viewer:*` solo atienden a
// las ventanas de visor abiertas desde aquí, y todas las llamadas a la API se hacen en este proceso:
// el token de la cuenta no llega a ningún renderer.
import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
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
import { remoteHost } from './hostRuntime'

/** Tamaño máximo de una descripción de sesión (el servicio admite 64 KB). */
const MAX_SDP_BYTES = 64 * 1024

interface ViewerWindow {
  window: BrowserWindow
  deviceId: string
  deviceName: string
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

function viewerFor(event: IpcMainInvokeEvent): ViewerWindow | undefined {
  return viewers.get(event.sender.id)
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
  viewers.set(id, { window, deviceId, deviceName: deviceName.slice(0, 100) })
  window.on('closed', () => viewers.delete(id))
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
      platform: process.platform
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
}
