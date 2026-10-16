// Protocolo v1 del canal `control` (add-remote-desktop D6/D9), compartido por el PC controlado, el
// visor de escritorio y la app móvil. Los mensajes son JSON con `v` y `type`; los tipos desconocidos
// se ignoran. Antes de autenticar, el PC solo atiende `auth`.
//
// PC → controlador: hello, auth-result, features, displays, clipboard, bye.
// Controlador → PC: auth, select-display, clipboard, bye.
// Los eventos de entrada van por los canales `input` y `pointer` (input.ts), y los ficheros por el
// canal `file` (transfer.ts).
import { ClipboardPiece, parseClipboardPiece } from './transfer'

export const PROTOCOL_VERSION = 1

/** Etiquetas de los canales de datos que crea el controlador (D9). */
export const CHANNELS = {
  control: 'control',
  input: 'input',
  pointer: 'pointer',
  file: 'file'
} as const

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: string
  name: string
  bounds: Bounds
  scaleFactor: number
  primary: boolean
}

export interface HelloMessage {
  v: 1
  type: 'hello'
  salt: string
  iterations: number
  nonce: string
  hostName: string
}

export type AuthFailure = 'wrong_password' | 'locked' | 'declined'

export type AuthResultMessage =
  | { v: 1; type: 'auth-result'; ok: true }
  | { v: 1; type: 'auth-result'; ok: false; reason: AuthFailure; retryAfter?: number }

/** Funciones que el PC permite en esta sesión (Ajustes, y el sonido según el sistema). */
export interface FeaturesMessage {
  v: 1
  type: 'features'
  clipboard: boolean
  files: boolean
  audio: boolean
}

export interface DisplaysMessage {
  v: 1
  type: 'displays'
  displays: DisplayInfo[]
  current: string
}

/**
 * Por qué termina la sesión. Desde el PC: `local` (Desconectar), `disabled`, `password_changed`,
 * `signed_out`, `stopped`, `expired`, `capture_failed`, `ended`. Desde el controlador: `closed`.
 */
export interface ByeMessage {
  v: 1
  type: 'bye'
  reason: string
}

export type HostMessage =
  | HelloMessage
  | AuthResultMessage
  | FeaturesMessage
  | DisplaysMessage
  | ClipboardPiece
  | ByeMessage

export type ControllerMessage =
  | { v: 1; type: 'auth'; proof: string }
  | { v: 1; type: 'select-display'; id: string }
  | ClipboardPiece
  | ByeMessage

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Valida un mensaje del controlador recibido por el canal `control`; null si no se reconoce. */
export function parseControllerMessage(raw: unknown): ControllerMessage | null {
  let data = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!isRecord(data)) return null
  switch (data.type) {
    case 'auth':
      return typeof data.proof === 'string' && data.proof.length <= 256
        ? { v: 1, type: 'auth', proof: data.proof }
        : null
    case 'select-display':
      return typeof data.id === 'string' && data.id.length <= 64
        ? { v: 1, type: 'select-display', id: data.id }
        : null
    case 'clipboard':
      return parseClipboardPiece(data)
    case 'bye':
      return {
        v: 1,
        type: 'bye',
        reason: typeof data.reason === 'string' ? data.reason.slice(0, 64) : 'closed'
      }
    default:
      return null
  }
}
