// Contrato del IPC local entre la app de Electron (la sesión del usuario ya autenticada) y el
// servicio con privilegios de Windows (add-windows-privileged-host D4). SOLO define la forma de los
// mensajes y los valida. No captura la pantalla ni aplica entrada: eso lo hace el servicio y su
// ayudante, que son otra pieza (nativa) y necesitan revisión de seguridad aparte.
//
// Reglas del canal (ver design.md):
//   - Es un canal local (named pipe), nunca de red. El servicio solo atiende al usuario de la
//     sesión de consola interactiva.
//   - Cada petición de la app lleva un `token` efímero por arranque, para que solo la app del
//     usuario (y no otro proceso suyo) hable con el servicio.
//   - El servicio solo actúa mientras hay una sesión de control ya autenticada con la contraseña
//     del PC: la app lo marca con `attach` y lo quita con `detach`. Una sesión a la vez.
//   - `input` lleva un `InputEvent` del protocolo v1 YA validado (`parseInputEvent`); aquí solo se
//     comprueba la forma del sobre, no se vuelve a validar el evento.

import { InputEvent } from './input'

/** Longitud máxima del nombre del controlador que se muestra en el aviso del escritorio seguro. */
export const MAX_NOTICE_NAME_LENGTH = 100

/** Longitud máxima del token efímero del canal. */
export const MAX_TOKEN_LENGTH = 256

/** Peticiones de la app → servicio. Todas llevan el `token` del canal. */
export type PrivilegedRequest =
  // Empieza a seguir el escritorio activo para una sesión de control en curso. `display` es el id
  // de la pantalla elegida; `controllerName`, quién controla (para el aviso del escritorio seguro).
  | { type: 'attach'; token: string; display: string; controllerName: string }
  // Deja de seguir el escritorio y repliega el ayudante (fin o corte de la sesión).
  | { type: 'detach'; token: string }
  // Aplica una entrada ya validada en el escritorio activo (también en el seguro o en una ventana elevada).
  | { type: 'input'; token: string; event: InputEvent }
  // Cambia de pantalla sin cortar la sesión.
  | { type: 'select-display'; token: string; display: string }
  // Muestra u oculta el aviso de "te están controlando" en el escritorio seguro.
  | { type: 'notice'; token: string; show: boolean; controllerName: string }

/** Respuestas del servicio → app. No llevan token (el canal ya está autenticado). */
export type PrivilegedResponse =
  // Resultado de una petición: `ok`, o `error` con un motivo estable.
  | { type: 'result'; ok: true }
  | { type: 'result'; ok: false; reason: PrivilegedError }
  // Un fotograma del escritorio activo. `secureDesktop` indica si es el escritorio seguro, para que
  // el controlador lo sepa. Los píxeles van aparte (binario); aquí solo va la cabecera.
  | { type: 'frame'; width: number; height: number; secureDesktop: boolean }
  // El escritorio de entrada ha cambiado (p. ej. ha aparecido el UAC o se ha bloqueado el PC).
  | { type: 'desktop-changed'; secureDesktop: boolean }

/** Motivos de error estables del servicio. */
export type PrivilegedError =
  | 'bad_token' // el token no coincide: la petición no es de la app autenticada
  | 'busy' // ya hay una sesión adjunta (una a la vez)
  | 'not_attached' // input/select-display/notice sin un attach previo
  | 'no_active_session' // no hay sesión de consola activa a la que adjuntarse
  | 'unsupported' // el sistema no lo permite (no es Windows, o falta soporte)

export const PRIVILEGED_ERRORS: readonly PrivilegedError[] = [
  'bad_token',
  'busy',
  'not_attached',
  'no_active_session',
  'unsupported'
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH
}

function isDisplay(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function noticeName(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_NOTICE_NAME_LENGTH ? value : null
}

/**
 * Valida el sobre de una petición de la app. Devuelve null si el tipo es desconocido o algún campo
 * no es válido. El `event` de `input` NO se valida aquí: debe venir ya validado con
 * `parseInputEvent` antes de construir la petición.
 */
export function parsePrivilegedRequest(raw: unknown): PrivilegedRequest | null {
  if (!isRecord(raw) || !isToken(raw.token)) return null
  const token = raw.token
  switch (raw.type) {
    case 'detach':
      return { type: 'detach', token }
    case 'attach': {
      const name = noticeName(raw.controllerName)
      if (!isDisplay(raw.display) || name === null) return null
      return { type: 'attach', token, display: raw.display, controllerName: name }
    }
    case 'select-display':
      return isDisplay(raw.display) ? { type: 'select-display', token, display: raw.display } : null
    case 'input':
      // Solo se comprueba que haya un objeto `event` con un `type` de texto; el contenido lo validó
      // ya `parseInputEvent` en el proceso principal (el servicio confía en la app autenticada).
      return isRecord(raw.event) && typeof raw.event.type === 'string'
        ? { type: 'input', token, event: raw.event as InputEvent }
        : null
    case 'notice': {
      const name = noticeName(raw.controllerName)
      if (typeof raw.show !== 'boolean' || name === null) return null
      return { type: 'notice', token, show: raw.show, controllerName: name }
    }
    default:
      return null
  }
}

/** Valida una respuesta del servicio. Devuelve null si no es una respuesta conocida y válida. */
export function parsePrivilegedResponse(raw: unknown): PrivilegedResponse | null {
  if (!isRecord(raw)) return null
  switch (raw.type) {
    case 'result':
      if (raw.ok === true) return { type: 'result', ok: true }
      if (raw.ok === false && PRIVILEGED_ERRORS.includes(raw.reason as PrivilegedError)) {
        return { type: 'result', ok: false, reason: raw.reason as PrivilegedError }
      }
      return null
    case 'frame':
      return typeof raw.width === 'number' &&
        Number.isInteger(raw.width) &&
        raw.width > 0 &&
        typeof raw.height === 'number' &&
        Number.isInteger(raw.height) &&
        raw.height > 0 &&
        typeof raw.secureDesktop === 'boolean'
        ? { type: 'frame', width: raw.width, height: raw.height, secureDesktop: raw.secureDesktop }
        : null
    case 'desktop-changed':
      return typeof raw.secureDesktop === 'boolean'
        ? { type: 'desktop-changed', secureDesktop: raw.secureDesktop }
        : null
    default:
      return null
  }
}
