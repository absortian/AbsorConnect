// Puente entre el proceso principal y las ventanas de visor (add-remote-desktop D11, tarea 4.9).
// El visor hace el WebRTC y deriva K; las llamadas a la API las hace el proceso principal, para que
// el token de la cuenta no llegue nunca a un renderer.
import type { AgentCapabilities } from './agentProtocol'
import type { IceServer } from './hostBridge'
import type { ClipboardContent, TransferErrorReason } from './transfer'

export interface ViewerInit {
  deviceId: string
  deviceName: string
  language: string
  theme: string
  /** `process.platform` del equipo que controla (el menú de combinaciones cambia en macOS). */
  platform: string
  /** Solo por relé (TURN): para probar la conexión por relé (`ABSOR_CONNECT_FORCE_RELAY=1`). */
  forceRelay: boolean
}

export type SaveBeginResult = { ok: true } | { ok: false; reason: 'cancelled' | 'io' }
export type SaveFinishResult =
  | { ok: true; path: string }
  | { ok: false; reason: TransferErrorReason }

/** Resultado de pedir sesión: el id de la solicitud, o el código de error del servicio. */
export type ViewerRequestResult =
  | { ok: true; id: string }
  | { ok: false; code: string; retryAfter?: number }

/** Estado de la solicitud mientras el PC responde. */
export type ViewerPollResult =
  | { status: 'pending' }
  | { status: 'answered'; answer: string }
  | { status: 'rejected'; reason: string; retryAfter?: number }
  | { status: 'error'; code: string }

export type ViewerAvailabilityResult =
  | { ok: true; online: boolean; available: boolean; lastSeenAt: string }
  | { ok: false; code: string; retryAfter?: number }

/** API que el preload del visor expone como `window.absorViewer`. */
export interface AbsorViewerApi {
  init(): Promise<ViewerInit>
  availability(): Promise<ViewerAvailabilityResult>
  iceServers(): Promise<IceServer[]>
  request(offer: string): Promise<ViewerRequestResult>
  poll(requestId: string): Promise<ViewerPollResult>
  /** Vigilar el portapapeles de este equipo (true) o dejar de hacerlo (en pausa o sin sesión). */
  clipboardWatch(on: boolean): Promise<void>
  /** Se ha copiado algo en este equipo mientras se vigila. */
  onClipboard(callback: (content: ClipboardContent) => void): void
  /** Pone en el portapapeles de este equipo lo copiado en el PC remoto. */
  clipboardWrite(content: ClipboardContent): void
  /** Descarga desde el PC: pide dónde guardarla (diálogo) y la escribe por trozos (D9). */
  saveBegin(id: number, name: string, size: number): Promise<SaveBeginResult>
  saveChunk(id: number, chunk: Uint8Array): void
  saveFinish(id: number, sha256: string): Promise<SaveFinishResult>
  saveCancel(id: number): void
  /** Muestra en su carpeta un fichero descargado en esta sesión. */
  showInFolder(path: string): void
}

export const VIEWER_IPC = {
  init: 'remote-viewer:init',
  availability: 'remote-viewer:availability',
  iceServers: 'remote-viewer:ice-servers',
  request: 'remote-viewer:request',
  poll: 'remote-viewer:poll',
  clipboardWatch: 'remote-viewer:clipboard-watch',
  clipboard: 'remote-viewer:clipboard',
  clipboardWrite: 'remote-viewer:clipboard-write',
  saveBegin: 'remote-viewer:save-begin',
  saveChunk: 'remote-viewer:save-chunk',
  saveFinish: 'remote-viewer:save-finish',
  saveCancel: 'remote-viewer:save-cancel',
  showInFolder: 'remote-viewer:show-in-folder'
} as const

/** Un equipo de la cuenta tal como lo ve la ventana principal (sección Equipos). */
export interface AccountDevice {
  id: string
  name: string
  platform: 'windows' | 'macos' | 'linux'
  appVersion: string
  online: boolean
  lastSeenAt: string
  remote: {
    state: string
    features: { clipboard: boolean; files: boolean; audio: boolean }
    mode?: 'agent'
    agentVersion?: string
    capabilities?: AgentCapabilities
  }
  /** Es este mismo PC: se marca y no se puede conectar. */
  self: boolean
}

export type AccountDevicesResult =
  | { ok: true; devices: AccountDevice[] }
  | { ok: false; code: string }
