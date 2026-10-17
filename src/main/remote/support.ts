// Si este PC puede ofrecerse para el control remoto (add-remote-desktop D8, remote-access-host):
// Windows siempre; macOS con los permisos de Grabación de pantalla y Accesibilidad; Linux solo con
// sesión X11 (en Wayland la captura pasa por el portal, que pide aceptar cada vez, y XTest no actúa
// sobre las apps de Wayland). El estado es el `remote_state` del equipo en la cuenta (D4).
//
// Sin dependencias de Electron: la lectura de los permisos reales está en platformSupport.ts.

export type MacPermission = 'screen' | 'accessibility'

export type RemoteSupport =
  | { state: 'available' }
  | { state: 'missing_permissions'; missing: MacPermission[] }
  | { state: 'unsupported'; reason: 'wayland' | 'platform' }

export interface SupportInput {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  /** macOS: permiso de Grabación de pantalla concedido. */
  screenGranted?: boolean
  /** macOS: permiso de Accesibilidad concedido. */
  accessibilityTrusted?: boolean
}

/**
 * Sesión Wayland: manda `XDG_SESSION_TYPE` (lo pone logind) y, si no está, `WAYLAND_DISPLAY`. Una
 * app con XWayland tiene también `DISPLAY`, pero sigue sin poder controlar el escritorio.
 */
export function isWaylandSession(env: Record<string, string | undefined>): boolean {
  const type = env.XDG_SESSION_TYPE?.toLowerCase()
  if (type === 'wayland') return true
  if (type === 'x11') return false
  return Boolean(env.WAYLAND_DISPLAY)
}

export function evaluateSupport(input: SupportInput): RemoteSupport {
  switch (input.platform) {
    case 'win32':
      return { state: 'available' }
    case 'darwin': {
      const missing: MacPermission[] = []
      if (!input.screenGranted) missing.push('screen')
      if (!input.accessibilityTrusted) missing.push('accessibility')
      return missing.length > 0 ? { state: 'missing_permissions', missing } : { state: 'available' }
    }
    case 'linux':
      return isWaylandSession(input.env)
        ? { state: 'unsupported', reason: 'wayland' }
        : { state: 'available' }
    default:
      return { state: 'unsupported', reason: 'platform' }
  }
}

/**
 * macOS 27 cambió el nombre del permiso de Accesibilidad en Privacidad y seguridad: ahora es
 * "Control de dispositivos y acceso a datos" (el enlace `Privacy_Accessibility` abre ese panel). La
 * app lo nombra como se ve en Ajustes del Sistema. `macosVersion` es la de macOS, p. ej. "27.0.1".
 */
export function accessibilityRenamed(macosVersion: string): boolean {
  return Number(macosVersion.split('.')[0]) >= 27
}

const PERMISSION_NAMES: Record<'es' | 'en', Record<MacPermission | 'accessibility27', string>> = {
  es: {
    screen: 'Grabación de pantalla',
    accessibility: 'Accesibilidad',
    accessibility27: 'Control de dispositivos y acceso a datos'
  },
  en: {
    screen: 'Screen Recording',
    accessibility: 'Accessibility',
    accessibility27: 'Device Control and Data Access'
  }
}

/** Texto de la notificación de permisos perdidos, con los que faltan. */
export function missingPermissionsMessage(
  missing: MacPermission[],
  language: string,
  macosVersion = ''
): string {
  const lang = language === 'es' ? 'es' : 'en'
  const renamed = accessibilityRenamed(macosVersion)
  const names = missing.map(
    (permission) =>
      PERMISSION_NAMES[lang][
        permission === 'accessibility' && renamed ? 'accessibility27' : permission
      ]
  )
  if (lang === 'es') {
    const list = names.join(' y ')
    return names.length > 1
      ? `El control remoto de este PC necesita otra vez los permisos de ${list}. Vuelve a concederlos en Ajustes del Sistema > Privacidad y seguridad.`
      : `El control remoto de este PC necesita otra vez el permiso de ${list}. Vuelve a concederlo en Ajustes del Sistema > Privacidad y seguridad.`
  }
  const list = names.join(' and ')
  return `Remote control of this PC needs the ${list} permission${names.length > 1 ? 's' : ''} again. Grant ${names.length > 1 ? 'them' : 'it'} in System Settings > Privacy & Security.`
}

interface MonitorDeps {
  detect: () => RemoteSupport
  /** Notificación de los permisos que faltan (todos, no solo los nuevos). */
  notifyMissing: (missing: MacPermission[]) => void
  /** El estado ha cambiado: hay que volver a registrar el equipo con el nuevo `remote_state`. */
  onChange?: (support: RemoteSupport) => void
}

/**
 * Vigila el estado (lo consultan el registro del equipo, cada solicitud de sesión y Ajustes).
 * Avisa una vez por cada permiso que se pierde: no repite el aviso mientras siga faltando, y
 * vuelve a avisar si se recupera y se pierde otra vez (p. ej. tras otra actualización).
 */
export class SupportMonitor {
  private last: RemoteSupport | null = null
  private known: MacPermission[] = []

  constructor(private readonly deps: MonitorDeps) {}

  /**
   * Vuelve a mirar el estado. Con `quiet` (Ajustes, que ya lo muestra) no se notifica, pero los
   * permisos que faltan cuentan como avisados.
   */
  check(options: { quiet?: boolean } = {}): RemoteSupport {
    const support = this.deps.detect()
    const missing = support.state === 'missing_permissions' ? support.missing : []
    const lost = missing.filter((permission) => !this.known.includes(permission))
    if (lost.length > 0 && !options.quiet) this.deps.notifyMissing(missing)
    this.known = missing
    if (this.last === null || JSON.stringify(this.last) !== JSON.stringify(support)) {
      this.last = support
      this.deps.onChange?.(support)
    }
    return support
  }

  /** Último estado visto (lo mira si aún no se ha mirado). */
  current(): RemoteSupport {
    return this.last ?? this.check({ quiet: true })
  }
}
