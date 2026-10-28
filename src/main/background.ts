// Segundo plano de la app de escritorio (add-remote-desktop, background-mode): instancia única,
// icono en la bandeja con su menú, cerrar la ventana sin salir y abrir al iniciar sesión.
//
// Nada de esto es oculto: el icono de la bandeja está siempre visible mientras la app corre, y es
// la vía para ver el estado del control remoto, abrir la ventana y salir del todo.
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { join } from 'path'
import * as fs from 'fs/promises'
import icon from '../../resources/icon.png?asset'
import trayIconTemplate from '../../resources/trayTemplate.png?asset'
import { getBackgroundSettings, getLanguage, saveBackgroundSettings } from './store'
import { publicLocalAgentSnapshot, type LocalAgentSnapshot } from '../shared/remote/localAgent'

/** Estado del control remoto de ESTE PC, para reflejarlo en la bandeja. */
export type RemoteStatus = 'off' | 'available' | 'active' | 'agent'

interface BackgroundDeps {
  /** Crea la ventana principal (la define el proceso principal). */
  createWindow: () => BrowserWindow
}

let tray: Tray | null = null
let deps: BackgroundDeps | null = null
let mainWindow: BrowserWindow | null = null
let remoteStatus: RemoteStatus = 'off'
let ownershipResolved = false
let localAgent: LocalAgentSnapshot | null = null
let activeController: string | null = null
// Salida real (menú "Salir" o app.quit()): deja de ocultar la ventana en 'close'.
let quitting = false

/** Entrada opcional de actualización en el menú de la bandeja (la alimenta el updater). */
interface TrayUpdate {
  version: string
  action: () => void
}
let trayUpdate: TrayUpdate | null = null

interface TrayLabels {
  open: string
  quit: string
  remoteAgent: string
  nativeState: Record<string, string>
  updateSessionDeferred: (version: string) => string
  quitInterface: string
  remoteOff: string
  remoteAvailable: string
  remoteActiveFrom: (name: string) => string
  updateAvailable: (version: string) => string
  updateReady: (version: string) => string
  updateDeferred: (version: string) => string
}

const LABELS: Record<'es' | 'en', TrayLabels> = {
  es: {
    open: 'Abrir Absor Connect',
    quit: 'Salir',
    remoteAgent: 'Servicio nativo: estado sin verificar',
    nativeState: {
      idle: 'Servicio nativo: sin sesión activa; sin certificar',
      active: 'Servicio nativo: sesión activa; sin certificar',
      validation_required: 'Servicio nativo: requiere autorización nueva',
      revoked: 'Servicio nativo: autorización revocada'
    },
    updateSessionDeferred: (version) => `Versión ${version} pospuesta durante la sesión remota`,
    quitInterface: 'Salir de la interfaz',
    remoteOff: 'Control remoto: desactivado',
    remoteAvailable: 'Control remoto: disponible',
    remoteActiveFrom: (name) => `Controlado ahora desde ${name}`,
    updateAvailable: (version) => `Descargar la versión ${version}`,
    updateReady: (version) => `Instalar la versión ${version} al salir`,
    updateDeferred: (version) =>
      `Versión ${version} pospuesta: actualización conjunta app/agente pendiente`
  },
  en: {
    open: 'Open Absor Connect',
    quit: 'Quit',
    remoteAgent: 'Native service: state unverified',
    nativeState: {
      idle: 'Native service: no active session; not certified',
      active: 'Native service: active session; not certified',
      validation_required: 'Native service: fresh authorization required',
      revoked: 'Native service: authorization revoked'
    },
    updateSessionDeferred: (version) => `Version ${version} deferred during the remote session`,
    quitInterface: 'Quit the interface',
    remoteOff: 'Remote control: off',
    remoteAvailable: 'Remote control: available',
    remoteActiveFrom: (name) => `Controlled now from ${name}`,
    updateAvailable: (version) => `Download version ${version}`,
    updateReady: (version) => `Install version ${version} on quit`,
    updateDeferred: (version) => `Version ${version} deferred: coordinated app/agent update pending`
  }
}

async function labels(): Promise<TrayLabels> {
  return LABELS[((await getLanguage()) as 'en' | 'es') ?? 'en'] ?? LABELS.en
}

/**
 * La ventana principal, si está abierta (aunque esté oculta en la bandeja). No sirve
 * `getAllWindows()[0]`: también están las ventanas ocultas `host`, el aviso de la sesión y los
 * visores, y Electron no garantiza el orden.
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** Muestra y enfoca la ventana; la crea si se había cerrado a la bandeja. */
export function showMainWindow(): void {
  const window = getMainWindow() ?? deps?.createWindow()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  // La ventana oculta (cerrada a la bandeja) no vuelve a emitir 'ready-to-show': el icono del
  // Dock que escondió attachCloseToTray se recupera aquí
  if (process.platform === 'darwin') void app.dock?.show()
}

/** Arranque oculto en macOS: sin ventana tampoco hay icono en el Dock, solo en la barra de menús. */
export function hideDockForHiddenStart(): void {
  if (process.platform === 'darwin') app.dock?.hide()
}

/** La app empieza oculta (solo bandeja) cuando la arranca el sistema al iniciar sesión. */
export function startedHidden(): boolean {
  if (process.argv.includes('--hidden')) return true
  if (process.platform === 'darwin') {
    try {
      return app.getLoginItemSettings().wasOpenedAtLogin
    } catch {
      return false
    }
  }
  return false
}

export function beginQuitting(): void {
  quitting = true
}

// El evento 'close' es síncrono, así que "Mantener abierta en segundo plano" se cachea aquí
// y se refresca al arrancar y al cambiarlo en Ajustes.
let keepInBackgroundCache = false
async function refreshKeepInBackgroundCache(): Promise<void> {
  keepInBackgroundCache = (await getBackgroundSettings()).keepInBackground
}

/**
 * La ventana recién creada es la principal. Con "Mantener abierta en segundo plano" activado,
 * cerrarla la oculta en lugar de terminar la app (el icono de la bandeja sigue visible). Sin el
 * ajuste, se comporta como antes.
 */
export function registerMainWindow(window: BrowserWindow): void {
  mainWindow = window
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.on('close', (event) => {
    if (quitting || !keepInBackgroundCache) return
    event.preventDefault()
    window.hide()
    if (process.platform === 'darwin') app.dock?.hide()
  })
}

async function trayImage(): Promise<Electron.NativeImage> {
  // En macOS, imagen template monocroma (se adapta a la barra de menús clara u oscura).
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(trayIconTemplate)
    image.setTemplateImage(true)
    return image.isEmpty() ? nativeImage.createFromPath(icon) : image
  }
  return nativeImage.createFromPath(icon)
}

export async function initTray(): Promise<void> {
  if (tray) return
  tray = new Tray(await trayImage())
  tray.setToolTip('Absor Connect')
  tray.on('click', showMainWindow)
  await rebuildTrayMenu()
}

async function rebuildTrayMenu(): Promise<void> {
  if (!tray) return
  const t = await labels()
  const statusLabel =
    remoteStatus === 'active'
      ? t.remoteActiveFrom(activeController ?? '—')
      : remoteStatus === 'agent'
        ? ((localAgent?.phase === 'responding' && localAgent.state
            ? t.nativeState[localAgent.state]
            : null) ?? t.remoteAgent)
        : remoteStatus === 'available'
          ? t.remoteAvailable
          : t.remoteOff
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: t.open, click: showMainWindow },
    { type: 'separator' },
    { label: statusLabel, enabled: false }
  ]
  if (trayUpdate) {
    const label =
      trayUpdate.action === NO_OP
        ? remoteStatus === 'agent'
          ? t.updateDeferred(trayUpdate.version)
          : isRemoteControlActive()
            ? t.updateSessionDeferred(trayUpdate.version)
            : t.updateReady(trayUpdate.version)
        : t.updateAvailable(trayUpdate.version)
    items.push({ type: 'separator' }, { label, click: () => trayUpdate?.action() })
  }
  items.push(
    { type: 'separator' },
    {
      label: remoteStatus === 'agent' ? t.quitInterface : t.quit,
      click: () => {
        beginQuitting()
        app.quit()
      }
    }
  )
  tray.setContextMenu(Menu.buildFromTemplate(items))
  tray.setToolTip(remoteStatus === 'active' ? `Absor Connect — ${statusLabel}` : 'Absor Connect')
}

/** El proceso principal avisa de los cambios de estado del control remoto para la bandeja. */
export function setRemoteStatus(status: RemoteStatus, controller: string | null = null): void {
  remoteStatus = status
  activeController = controller
  void rebuildTrayMenu()
}

/** Hay una sesión de control remoto en curso en ESTE PC (para no reinstalar durante ella). */
export function isRemoteControlActive(): boolean {
  return (
    remoteStatus === 'active' ||
    (remoteStatus === 'agent' && localAgent?.phase === 'responding' && localAgent.active)
  )
}

/** El actualizador no puede decidir mientras se está comprobando la propiedad al arrancar. */
export function isRemoteOwnershipResolved(): boolean {
  return ownershipResolved
}
export function setLocalAgentState(state: LocalAgentSnapshot): void {
  localAgent = publicLocalAgentSnapshot(state)
  ownershipResolved = true
  if (state.ownership !== 'legacy') remoteStatus = 'agent'
  void rebuildTrayMenu()
}

export function isAgentHostOwned(): boolean {
  return remoteStatus === 'agent'
}

/** Entrada de la bandeja marcada como "ya descargada, se instala al salir" (sin acción directa). */
const NO_OP = (): void => {}

/** El updater fija la entrada de actualización de la bandeja: null la quita. */
export function setTrayUpdate(update: { version: string; action?: () => void } | null): void {
  trayUpdate = update ? { version: update.version, action: update.action ?? NO_OP } : null
  void rebuildTrayMenu()
}

// --- Abrir al iniciar sesión -------------------------------------------------

const LINUX_AUTOSTART = join(app.getPath('home'), '.config', 'autostart', 'absor-connect.desktop')

/** Ruta del ejecutable que se vuelve a lanzar: en AppImage, el propio .AppImage. */
function launchPath(): string {
  return process.env.APPIMAGE ?? process.execPath
}

async function applyOpenAtLogin(enabled: boolean): Promise<void> {
  if (process.platform === 'linux') {
    if (!enabled) {
      await fs.rm(LINUX_AUTOSTART, { force: true })
      return
    }
    const entry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Absor Connect',
      `Exec=${launchPath()} --hidden`,
      'X-GNOME-Autostart-enabled=true',
      'Terminal=false',
      ''
    ].join('\n')
    await fs.mkdir(join(app.getPath('home'), '.config', 'autostart'), { recursive: true })
    await fs.writeFile(LINUX_AUTOSTART, entry, 'utf-8')
    return
  }
  // Windows y macOS: lo gestiona el sistema. --hidden para arrancar solo en la bandeja.
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}

// --- API para Ajustes --------------------------------------------------------

export async function getBackgroundState(): Promise<{
  keepInBackground: boolean
  openAtLogin: boolean
}> {
  return getBackgroundSettings()
}

export async function setKeepInBackground(value: boolean): Promise<void> {
  await saveBackgroundSettings({ keepInBackground: value })
  await refreshKeepInBackgroundCache()
}

export async function setOpenAtLogin(value: boolean): Promise<void> {
  await saveBackgroundSettings({ openAtLogin: value })
  await applyOpenAtLogin(value)
}

/** Al arrancar: aplica el ajuste de arranque guardado (por si el .desktop se borró, etc.). */
export async function syncOpenAtLoginOnStartup(): Promise<void> {
  const { openAtLogin } = await getBackgroundSettings()
  await applyOpenAtLogin(openAtLogin)
}

/**
 * Instancia única: si ya hay una en marcha, la segunda termina y la primera muestra su ventana.
 * Devuelve false cuando esta instancia debe salir de inmediato.
 */
export function acquireSingleInstance(onSecondInstance: () => void): boolean {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) return false
  app.on('second-instance', onSecondInstance)
  return true
}

/** Guarda cómo crear la ventana principal y deja listo el ajuste cacheado para 'close'. */
export async function setupBackground(dependencies: BackgroundDeps): Promise<void> {
  deps = dependencies
  await refreshKeepInBackgroundCache()
}
