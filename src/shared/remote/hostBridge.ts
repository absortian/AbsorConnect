// Puente entre el proceso principal y la ventana oculta `host` del PC controlado (add-remote-desktop
// D7). La ventana hace WebRTC y la captura; el proceso principal decide todo lo demás: K y la
// verificación de la contraseña no salen de él, y la entrada se aplica allí.
import type { AuthResultMessage, DisplayInfo, HelloMessage } from './protocol'

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface HostFeatures {
  clipboard: boolean
  files: boolean
  /** Sonido permitido en Ajustes y posible en este sistema. */
  audio: boolean
}

/** Lo que recibe la ventana al empezar: una sesión, o la conexión local que abre el cortafuegos de Windows. */
export type HostInit =
  | { mode: 'session'; offer: string; iceServers: IceServer[]; features: HostFeatures }
  | { mode: 'loopback' }

/** API que el preload `host` expone como `window.absorHost`. */
export interface AbsorHostApi {
  onStart(callback: (init: HostInit) => void): void
  /** El proceso principal corta la sesión: hay que despedirse del controlador y cerrar. */
  onClose(callback: (reason: string) => void): void
  /** Descripción de sesión completa (con candidatos) para publicarla como respuesta. */
  answer(sdp: string): void
  hello(): Promise<HelloMessage | null>
  auth(proof: string): Promise<AuthResultMessage>
  displays(): Promise<{ displays: DisplayInfo[]; current: string }>
  selectDisplay(id: string): Promise<boolean>
  /** La captura ya se envía: empieza la sesión de verdad (aviso, notificación, registro). */
  captureStarted(): void
  /** Mensaje recibido por los canales `input` o `pointer` (se valida en el proceso principal). */
  input(message: unknown): void
  /** La conexión terminó por su cuenta (el controlador se fue, se perdió la red…). */
  ended(reason: string): void
  log(message: string): void
}

export const HOST_IPC = {
  start: 'remote-host:start',
  close: 'remote-host:close',
  answer: 'remote-host:answer',
  hello: 'remote-host:hello',
  auth: 'remote-host:auth',
  displays: 'remote-host:displays',
  selectDisplay: 'remote-host:select-display',
  captureStarted: 'remote-host:capture-started',
  input: 'remote-host:input',
  ended: 'remote-host:ended',
  log: 'remote-host:log'
} as const
