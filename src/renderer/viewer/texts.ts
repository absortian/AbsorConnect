// Textos de la ventana de visor, en el idioma de la app (es/en). Cada fallo tiene su mensaje
// (remote-desktop-viewer, "Fallos comprensibles").

export interface ViewerTexts {
  passwordTitle: (pc: string) => string
  passwordHint: string
  password: string
  connect: string
  reconnect: string
  connecting: string
  waitingPc: string
  authenticating: string
  reconnecting: string
  direct: string
  relay: string
  fit: string
  realSize: string
  fullscreen: string
  exitFullscreen: string
  combos: string
  mute: string
  unmute: string
  noAudio: string
  disconnect: string
  display: (n: number) => string
  closedBy: (reason: string) => string
  error: (code: string, retryAfter?: number) => string
}

function minutes(seconds?: number): string {
  return seconds ? String(Math.max(1, Math.ceil(seconds / 60))) : '?'
}

const es: ViewerTexts = {
  passwordTitle: (pc) => `Conectar con ${pc}`,
  passwordHint: 'Escribe la contraseña de control remoto de ese PC.',
  password: 'Contraseña del PC',
  connect: 'Conectar',
  reconnect: 'Reconectar',
  connecting: 'Conectando…',
  waitingPc: 'Esperando al PC…',
  authenticating: 'Comprobando la contraseña…',
  reconnecting: 'Se ha perdido la conexión. Reconectando…',
  direct: 'Directa',
  relay: 'Por relé',
  fit: 'Ajustar',
  realSize: 'Tamaño real',
  fullscreen: 'Pantalla completa',
  exitFullscreen: 'Salir de pantalla completa',
  combos: 'Combinaciones',
  mute: 'Silenciar',
  unmute: 'Activar sonido',
  noAudio: 'Sonido no disponible en este equipo',
  disconnect: 'Desconectar',
  display: (n) => `Pantalla ${n}`,
  closedBy: (reason) =>
    ({
      local: 'Se ha desconectado desde el PC.',
      disabled: 'El PC ha desactivado el control remoto.',
      password_changed: 'Ha cambiado la contraseña del PC.',
      signed_out: 'El PC ha cerrado la sesión de la cuenta.',
      stopped: 'La app del PC se ha cerrado.',
      capture_failed: 'El PC no ha podido capturar la pantalla.'
    })[reason] ?? 'El PC ha cerrado la sesión.',
  error: (code, retryAfter) =>
    ({
      wrong_password: 'Contraseña incorrecta.',
      locked: `Demasiados intentos fallidos. El PC no acepta conexiones durante ${minutes(retryAfter)} min.`,
      busy: 'Otro equipo está controlando ese PC ahora.',
      device_offline: 'El PC no está conectado: la app no está en marcha o no tiene red.',
      remote_disabled: 'El control remoto está desactivado en ese PC.',
      missing_permissions: 'A ese PC le faltan permisos del sistema para dejarse controlar.',
      unsupported:
        'Ese PC no puede dejarse controlar ahora: su sistema no lo permite (por ejemplo, Linux con Wayland) o no ha podido abrir la sesión.',
      declined: 'En el PC han rechazado la conexión, o nadie la aceptó a tiempo.',
      connection_failed: 'La red no permite conectar con ese PC.',
      no_answer: 'El PC no ha respondido.',
      reconnect_failed: 'No se ha podido recuperar la conexión.',
      too_many_requests: `Demasiadas solicitudes. Prueba de nuevo en ${retryAfter ?? 60} s.`,
      remote_unavailable: 'El control remoto no está disponible ahora mismo en el servicio.',
      device_not_found: 'Ese PC ya no está en la cuenta.',
      network_error: 'Sin conexión con el servicio. Comprueba la red.'
    })[code] ?? `No se ha podido conectar (${code}).`
}

const en: ViewerTexts = {
  passwordTitle: (pc) => `Connect to ${pc}`,
  passwordHint: "Enter that PC's remote control password.",
  password: 'PC password',
  connect: 'Connect',
  reconnect: 'Reconnect',
  connecting: 'Connecting…',
  waitingPc: 'Waiting for the PC…',
  authenticating: 'Checking the password…',
  reconnecting: 'Connection lost. Reconnecting…',
  direct: 'Direct',
  relay: 'Relayed',
  fit: 'Fit',
  realSize: 'Actual size',
  fullscreen: 'Full screen',
  exitFullscreen: 'Exit full screen',
  combos: 'Shortcuts',
  mute: 'Mute',
  unmute: 'Unmute',
  noAudio: 'Sound not available on this PC',
  disconnect: 'Disconnect',
  display: (n) => `Display ${n}`,
  closedBy: (reason) =>
    ({
      local: 'Disconnected from the PC.',
      disabled: 'The PC turned remote control off.',
      password_changed: "The PC's password changed.",
      signed_out: 'The PC signed out of the account.',
      stopped: 'The app on the PC was closed.',
      capture_failed: 'The PC could not capture its screen.'
    })[reason] ?? 'The PC closed the session.',
  error: (code, retryAfter) =>
    ({
      wrong_password: 'Wrong password.',
      locked: `Too many failed attempts. The PC refuses connections for ${minutes(retryAfter)} min.`,
      busy: 'Another device is controlling that PC right now.',
      device_offline: "The PC is offline: the app isn't running or has no network.",
      remote_disabled: 'Remote control is turned off on that PC.',
      missing_permissions: 'That PC is missing system permissions to be controlled.',
      unsupported:
        "That PC can't be controlled right now: its system doesn't allow it (for example, Linux with Wayland) or it couldn't open the session.",
      declined: 'The connection was declined on the PC, or nobody accepted it in time.',
      connection_failed: "The network doesn't allow connecting to that PC.",
      no_answer: "The PC didn't answer.",
      reconnect_failed: 'The connection could not be recovered.',
      too_many_requests: `Too many requests. Try again in ${retryAfter ?? 60} s.`,
      remote_unavailable: 'Remote control is not available on the service right now.',
      device_not_found: 'That PC is no longer in the account.',
      network_error: 'No connection to the service. Check your network.'
    })[code] ?? `Could not connect (${code}).`
}

export function viewerTexts(language: string): ViewerTexts {
  return language === 'es' ? es : en
}
