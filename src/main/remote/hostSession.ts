// Una sesión del PC controlado (add-remote-desktop D6/D7/D8): la ventana oculta `host` hace el
// WebRTC y la captura; aquí se decide todo lo demás. Es la implementación de `openSession` de
// HostService.
//   - La ventana va en su propia partición, con un gestor de getDisplayMedia que no da nada hasta
//     que la conexión se ha autenticado, y que elige la pantalla y el sonido (`loopback`).
//   - La contraseña se verifica aquí (HostAuth: K no sale del proceso principal), con la
//     confirmación local si está activada.
//   - La entrada se valida (parseInputEvent) y se aplica con InputController sobre la pantalla elegida.
//   - Límites: respuesta en 15 s, autenticación en 60 s y captura en 15 s; si no, se corta.
import {
  BrowserWindow,
  desktopCapturer,
  Display,
  ipcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  screen,
  session as electronSession,
  Streams,
  WebFrameMain
} from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { HOST_IPC, HostFeatures, IceServer } from '../../shared/remote/hostBridge'
import { parseInputEvent } from '../../shared/remote/input'
import { AuthResultMessage, DisplayInfo, HelloMessage } from '../../shared/remote/protocol'
import { PendingRequest } from './deviceApi'
import { HostAuth } from './hostAuth'
import { confirmLocally, openSessionNotice } from './hostNotice'
import { HostCloseReason, HostSession } from './hostService'
import { createInputController, InputController, nativeDisplayRect } from './input'
import { RemoteAccessStore } from './remoteAccessStore'

const HOST_PARTITION = 'remote-host'
/** Escritorio completo de X11 (fuente de WebRTC kFullDesktopScreenId). */
const FULL_DESKTOP_SOURCE = { id: 'screen:-1:0', name: 'Screen' }
const ANSWER_TIMEOUT_MS = 15_000
const AUTH_TIMEOUT_MS = 60_000
const CAPTURE_TIMEOUT_MS = 15_000
/**
 * La ventana `host` avisa cada 2 s. Sin aviso en 10 s su renderer está colgado o muerto (Chromium
 * puede tardar más de un minuto en darlo por perdido): se cierra la sesión para que el PC no se
 * quede "ocupado" y el controlador pueda reconectar.
 */
const HEARTBEAT_TIMEOUT_MS = 10_000
/** Tiempo para que la ventana se despida del controlador antes de destruirla. */
const CLOSE_GRACE_MS = 400

export interface HostSessionContext {
  store: Pick<
    RemoteAccessStore,
    | 'snapshot'
    | 'getPasswordParams'
    | 'getKey'
    | 'isLocked'
    | 'lockRemainingSeconds'
    | 'registerFailure'
    | 'clearFailures'
  >
  iceServers: () => Promise<IceServer[]>
  language: () => Promise<string>
}

/** Sesiones abiertas por el id del webContents de su ventana: el IPC solo atiende a esas ventanas. */
const sessions = new Map<number, ActiveHostSession>()

class ActiveHostSession implements HostSession {
  answer = ''
  readonly started: Promise<void>
  readonly ended: Promise<void>
  authenticated = false
  displayId: string
  /** Se guarda al crear la ventana: después de destruirla ya no se puede leer. */
  readonly contentsId: number
  private auth: HostAuth | null = null
  private input: InputController | null = null
  private notice: { close(): void } | null = null
  private closed = false
  private isStarted = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private lastAlive = Date.now()
  private resolveAnswer!: (sdp: string) => void
  private readonly answerReceived: Promise<string>
  private resolveStarted!: () => void
  private rejectStarted!: (error: Error) => void
  private resolveEnded!: () => void

  constructor(
    readonly window: BrowserWindow,
    private readonly request: PendingRequest,
    private readonly ctx: HostSessionContext,
    readonly features: HostFeatures,
    private readonly hostName: string
  ) {
    this.displayId = String(screen.getPrimaryDisplay().id)
    this.contentsId = window.webContents.id
    this.answerReceived = new Promise((resolve) => (this.resolveAnswer = resolve))
    this.started = new Promise((resolve, reject) => {
      this.resolveStarted = resolve
      this.rejectStarted = reject
    })
    this.started.catch(() => undefined)
    this.ended = new Promise((resolve) => (this.resolveEnded = resolve))
  }

  async waitForAnswer(): Promise<void> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('answer_timeout')), ANSWER_TIMEOUT_MS)
    )
    this.answer = await Promise.race([this.answerReceived, timeout])
    this.auth = new HostAuth(this.ctx.store, this.request.offer, this.answer)
    this.setTimer(AUTH_TIMEOUT_MS, 'expired')
  }

  alive(): void {
    this.lastAlive = Date.now()
  }

  watchHeartbeat(): void {
    this.lastAlive = Date.now()
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastAlive > HEARTBEAT_TIMEOUT_MS) this.close('ended')
    }, 2000)
  }

  onAnswer(sdp: unknown): void {
    if (typeof sdp === 'string' && sdp.length > 0 && sdp.length <= 64 * 1024)
      this.resolveAnswer(sdp)
  }

  hello(): Promise<HelloMessage | null> {
    return this.auth ? this.auth.hello(this.hostName) : Promise.resolve(null)
  }

  async authenticate(proof: unknown): Promise<AuthResultMessage> {
    const failed = (
      reason: 'wrong_password' | 'locked' | 'declined',
      retryAfter?: number
    ): AuthResultMessage => ({
      v: 1,
      type: 'auth-result',
      ok: false,
      reason,
      ...(retryAfter ? { retryAfter } : {})
    })
    if (!this.auth || this.authenticated || this.closed) return failed('wrong_password')
    const outcome = await this.auth.verify(proof)
    if (!outcome.ok) {
      return outcome.reason === 'locked'
        ? failed('locked', outcome.retryAfter)
        : failed('wrong_password')
    }
    if ((await this.ctx.store.snapshot()).confirmLocal) {
      const accepted = await confirmLocally(this.request.controllerName, await this.ctx.language())
      if (!accepted || this.closed) return failed('declined')
    }
    this.authenticated = true
    this.setTimer(CAPTURE_TIMEOUT_MS, 'capture_failed')
    try {
      this.input = await createInputController()
      this.input.setDisplayRect(nativeDisplayRect(this.display()))
    } catch (error) {
      // Sin entrada (p. ej. sin libXtst) la sesión sigue, solo para ver
      console.error('Remote input unavailable:', error)
    }
    return { v: 1, type: 'auth-result', ok: true }
  }

  displays(): { displays: DisplayInfo[]; current: string } {
    const primary = screen.getPrimaryDisplay().id
    return {
      displays: screen.getAllDisplays().map((d, i) => ({
        id: String(d.id),
        name: d.label || `${i + 1}`,
        bounds: d.bounds,
        scaleFactor: d.scaleFactor,
        primary: d.id === primary
      })),
      current: this.displayId
    }
  }

  selectDisplay(id: unknown): boolean {
    if (!this.authenticated || typeof id !== 'string') return false
    const display = screen.getAllDisplays().find((d) => String(d.id) === id)
    if (!display) return false
    this.displayId = id
    this.input?.setDisplayRect(nativeDisplayRect(display))
    return true
  }

  display(): Display {
    return (
      screen.getAllDisplays().find((d) => String(d.id) === this.displayId) ??
      screen.getPrimaryDisplay()
    )
  }

  async captureStarted(): Promise<void> {
    if (!this.authenticated || this.isStarted || this.closed) return
    this.isStarted = true
    this.clearTimer()
    this.notice = openSessionNotice(this.request.controllerName, await this.ctx.language(), () =>
      this.close('local')
    )
    this.resolveStarted()
  }

  applyInput(raw: unknown): void {
    if (!this.authenticated || this.closed || !this.input) return
    const event = parseInputEvent(raw)
    if (event) this.input.apply(event).catch((error) => console.error('Remote input:', error))
  }

  close(reason: HostCloseReason | string): void {
    if (this.closed) return
    this.closed = true
    this.clearTimer()
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.notice?.close()
    void this.input?.dispose()
    this.input = null
    if (!this.isStarted) this.rejectStarted(new Error(reason))
    // Si el renderer murió no hay a quién avisar (y enviarle algo deja un error en el registro)
    if (!this.window.isDestroyed() && !this.window.webContents.isCrashed()) {
      this.window.webContents.send(HOST_IPC.close, reason)
    }
    setTimeout(() => {
      sessions.delete(this.contentsId)
      if (!this.window.isDestroyed()) this.window.destroy()
      this.resolveEnded()
    }, CLOSE_GRACE_MS)
  }

  private setTimer(ms: number, reason: HostCloseReason): void {
    this.clearTimer()
    this.timer = setTimeout(() => this.close(reason), ms)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

function sessionFor(event: IpcMainEvent | IpcMainInvokeEvent): ActiveHostSession | undefined {
  return sessions.get(event.sender.id)
}

let ipcReady = false

function setupIpc(): void {
  if (ipcReady) return
  ipcReady = true
  ipcMain.on(HOST_IPC.answer, (event, sdp) => sessionFor(event)?.onAnswer(sdp))
  ipcMain.handle(HOST_IPC.hello, (event) => sessionFor(event)?.hello() ?? null)
  ipcMain.handle(HOST_IPC.auth, (event, proof) => {
    const session = sessionFor(event)
    return session
      ? session.authenticate(proof)
      : { v: 1, type: 'auth-result', ok: false, reason: 'wrong_password' }
  })
  ipcMain.handle(
    HOST_IPC.displays,
    (event) => sessionFor(event)?.displays() ?? { displays: [], current: '' }
  )
  ipcMain.handle(
    HOST_IPC.selectDisplay,
    (event, id) => sessionFor(event)?.selectDisplay(id) ?? false
  )
  ipcMain.on(HOST_IPC.captureStarted, (event) => void sessionFor(event)?.captureStarted())
  ipcMain.on(HOST_IPC.input, (event, message) => sessionFor(event)?.applyInput(message))
  ipcMain.on(HOST_IPC.alive, (event) => sessionFor(event)?.alive())
  ipcMain.on(HOST_IPC.ended, (event, reason) =>
    sessionFor(event)?.close(typeof reason === 'string' ? reason.slice(0, 32) : 'ended')
  )
  ipcMain.on(HOST_IPC.log, (event, message) => {
    if (sessionFor(event)) console.warn('Remote host:', String(message).slice(0, 500))
  })

  // getDisplayMedia de la ventana `host`: nada antes de autenticar; después, la pantalla elegida
  // y, en Windows y macOS, el sonido del sistema (en Linux no funciona `loopback`, D8)
  electronSession
    .fromPartition(HOST_PARTITION)
    .setDisplayMediaRequestHandler(async (request, callback) => {
      // Electron 39 no admite `{}` si se pidió vídeo; sin un objeto, rechaza la petición
      const deny = (): void => (callback as unknown as (streams: null) => void)(null)
      const session = sessionForFrame(request.frame)
      if (!session?.authenticated) {
        deny()
        return
      }
      let streams: Streams | null = null
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        const source =
          sources.find((s) => s.display_id === session.displayId) ??
          sources[0] ??
          // X11 sin monitores RandR (Xvnc, xrdp…): Chromium no lista pantallas, pero el escritorio
          // completo sí se captura, y Electron ve entonces una sola pantalla que lo cubre todo
          (process.platform === 'linux' ? FULL_DESKTOP_SOURCE : undefined)
        if (source) {
          streams =
            session.features.audio && request.audioRequested
              ? { video: source, audio: 'loopback' }
              : { video: source }
        }
      } catch (error) {
        console.error('Remote host: screen sources unavailable:', error)
      }
      if (streams) callback(streams)
      else deny()
    })
}

/** Sesión de la ventana `host` que pide la captura (por su marco principal). */
function sessionForFrame(frame: WebFrameMain | null): ActiveHostSession | undefined {
  if (!frame) return undefined
  for (const session of sessions.values()) {
    if (session.window.isDestroyed()) continue
    const main = session.window.webContents.mainFrame
    if (main.processId === frame.processId && main.routingId === frame.routingId) return session
  }
  return undefined
}

async function loadHostPage(window: BrowserWindow): Promise<void> {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    await window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/host.html`)
  } else {
    await window.loadFile(join(__dirname, '../renderer/host.html'))
  }
}

function hostWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      preload: join(__dirname, '../preload/host.js'),
      contextIsolation: true,
      sandbox: true,
      // Sin esto Chromium ralentiza los temporizadores y la captura de las ventanas ocultas (D7)
      backgroundThrottling: false,
      partition: HOST_PARTITION
    }
  })
}

/** Abre la conexión para una solicitud: crea la ventana, le pasa la oferta y espera la respuesta. */
export async function openHostSession(
  request: PendingRequest,
  ctx: HostSessionContext
): Promise<HostSession> {
  setupIpc()
  const snapshot = await ctx.store.snapshot()
  const iceServers = await ctx.iceServers()
  const features: HostFeatures = {
    clipboard: snapshot.features.clipboard,
    files: snapshot.features.files,
    audio: snapshot.features.audio && process.platform !== 'linux'
  }
  const window = hostWindow()
  const session = new ActiveHostSession(window, request, ctx, features, snapshot.deviceName)
  sessions.set(session.contentsId, session)
  window.on('closed', () => session.close('ended'))
  // Si el proceso de la ventana muere, la sesión no puede seguir: el PC deja de estar ocupado
  window.webContents.on('render-process-gone', () => session.close('ended'))
  try {
    await loadHostPage(window)
    window.webContents.send(HOST_IPC.start, {
      mode: 'session',
      offer: request.offer,
      iceServers,
      features
    })
    await session.waitForAnswer()
  } catch (error) {
    session.close('ended')
    throw error
  }
  session.watchHeartbeat()
  return session
}

/**
 * Abre y cierra una conexión WebRTC local, para que el cortafuegos de Windows pregunte al activar
 * el control remoto (con alguien delante) y no la primera vez que alguien se conecta (D7).
 */
export async function primeFirewall(): Promise<void> {
  if (process.platform !== 'win32') return
  setupIpc()
  const window = hostWindow()
  const contentsId = window.webContents.id
  const done = new Promise<void>((resolve) => {
    const finish = (event: IpcMainEvent): void => {
      if (event.sender.id !== contentsId) return
      ipcMain.removeListener(HOST_IPC.ended, finish)
      resolve()
    }
    ipcMain.on(HOST_IPC.ended, finish)
    setTimeout(resolve, 15_000)
  })
  await loadHostPage(window)
  window.webContents.send(HOST_IPC.start, { mode: 'loopback' })
  await done
  if (!window.isDestroyed()) window.destroy()
}
