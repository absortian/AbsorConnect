import { autoUpdater, UpdateInfo } from 'electron-updater'
import { Notification } from 'electron'
import { RELEASES_URL } from '../shared/constants'
import {
  getMainWindow,
  isAgentHostOwned,
  isRemoteControlActive,
  isRemoteOwnershipResolved,
  setTrayUpdate,
  showMainWindow
} from './background'

// Cada cuánto busca actualizaciones la app mientras está en marcha (add-remote-desktop D15).
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// Versión ya anunciada por notificación, para no repetirla en cada búsqueda.
let notifiedVersion: string | null = null

export function initUpdater(): void {
  autoUpdater.autoDownload = false
  refreshAgentUpdateGuard()

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer('update-status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    sendToRenderer('update-status', {
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate
    })
    // Con la app en segundo plano puede no haber ventana: se avisa por notificación y por la
    // bandeja, que ofrece descargarla (background-mode / app-updates).
    notifyUpdateAvailable(info.version)
    setTrayUpdate({ version: info.version, action: () => void downloadUpdate() })
  })

  autoUpdater.on('update-not-available', () => {
    sendToRenderer('update-status', { status: 'up-to-date' })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent)
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    sendToRenderer('update-status', { status: 'downloaded' })
    // Ya descargada: se instalará al salir (autoInstallOnAppQuit). La bandeja lo indica, sin
    // reiniciar por su cuenta: nunca se interrumpe una sesión de control remoto.
    setTrayUpdate({ version: info.version })
  })

  autoUpdater.on('error', (err: Error) => {
    const isCodeSignError = /code.?sign|signature|not valid|no firmado/i.test(err.message)

    sendToRenderer('update-status', {
      status: 'error',
      error: err.message,
      releasesUrl: RELEASES_URL,
      isCodeSignError
    })
  })
}

/** El host nativo requiere la actualización conjunta de 11.4, incluso si ahora está idle. */
export function refreshAgentUpdateGuard(): void {
  autoUpdater.autoInstallOnAppQuit =
    isRemoteOwnershipResolved() && !isAgentHostOwned() && !isRemoteControlActive()
}

/** Busca al arrancar y cada 6 h mientras la app sigue en marcha (incluso sin ventana). */
export function startBackgroundUpdateChecks(): void {
  void safeCheck()
  setInterval(() => void safeCheck(), CHECK_INTERVAL_MS)
}

async function safeCheck(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // Sin red o error de firma: ya lo recoge el handler 'error'; en segundo plano no molesta
  }
}

function notifyUpdateAvailable(version: string): void {
  if (version === notifiedVersion || !Notification.isSupported()) return
  notifiedVersion = version
  const notification = new Notification({
    title: 'Absor Connect',
    body: `Hay una versión nueva disponible (${version}).`
  })
  notification.on('click', showMainWindow)
  notification.show()
}

export async function checkForUpdates(): Promise<void> {
  await autoUpdater.checkForUpdates()
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

/**
 * Instala y reinicia. NUNCA mientras se controla este PC en remoto: la sesión se perdería. En ese
 * caso no hace nada y el aviso de la interfaz explica que se instalará al terminar la sesión.
 */
export function quitAndInstall(): boolean {
  if (!isRemoteOwnershipResolved() || isRemoteControlActive() || isAgentHostOwned()) return false
  // quitAndInstall llama a app.quit(), que dispara 'before-quit' (marca la salida real) antes de
  // cerrar las ventanas, así que "mantener en segundo plano" no bloquea este cierre.
  autoUpdater.quitAndInstall()
  return true
}

/** Solo a la ventana principal: las ventanas `host` y los visores no saben nada de esto. */
function sendToRenderer(channel: string, data: unknown): void {
  getMainWindow()?.webContents.send(channel, data)
}
