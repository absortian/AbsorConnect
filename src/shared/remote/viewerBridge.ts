// Puente entre el proceso principal y las ventanas de visor (add-remote-desktop D11, tarea 4.9).
// El visor hace el WebRTC y deriva K; las llamadas a la API las hace el proceso principal, para que
// el token de la cuenta no llegue nunca a un renderer.
import type { IceServer } from './hostBridge'

export interface ViewerInit {
  deviceId: string
  deviceName: string
  language: string
  theme: string
  /** `process.platform` del equipo que controla (el menú de combinaciones cambia en macOS). */
  platform: string
}

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

/** API que el preload del visor expone como `window.absorViewer`. */
export interface AbsorViewerApi {
  init(): Promise<ViewerInit>
  iceServers(): Promise<IceServer[]>
  request(offer: string): Promise<ViewerRequestResult>
  poll(requestId: string): Promise<ViewerPollResult>
}

export const VIEWER_IPC = {
  init: 'remote-viewer:init',
  iceServers: 'remote-viewer:ice-servers',
  request: 'remote-viewer:request',
  poll: 'remote-viewer:poll'
} as const

/** Un equipo de la cuenta tal como lo ve la ventana principal (sección Equipos). */
export interface AccountDevice {
  id: string
  name: string
  platform: 'windows' | 'macos' | 'linux'
  appVersion: string
  online: boolean
  lastSeenAt: string
  remote: { state: string; features: { clipboard: boolean; files: boolean; audio: boolean } }
  /** Es este mismo PC: se marca y no se puede conectar. */
  self: boolean
}

export type AccountDevicesResult =
  | { ok: true; devices: AccountDevice[] }
  | { ok: false; code: string }
