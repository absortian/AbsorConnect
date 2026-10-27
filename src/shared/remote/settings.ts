// Lo que ve y cambia la sección "Control remoto de este PC" de Ajustes (add-remote-desktop D14,
// remote-access-host, tarea 6.2). La contraseña del PC solo viaja una vez, al definirla, de la
// ventana al proceso principal, que deriva K y no la guarda.

export interface RemoteSupportInfo {
  state: 'available' | 'missing_permissions' | 'unsupported'
  /** Permisos de macOS que faltan. */
  missing?: ('screen' | 'accessibility')[]
  reason?: 'wayland' | 'platform'
}

export interface RemoteLogInfo {
  at: number
  type: 'session-start' | 'session-end' | 'auth-failed' | 'locked'
  controller?: string
  durationMs?: number
}

export interface RemoteFeaturesInfo {
  clipboard: boolean
  files: boolean
  audio: boolean
}

export interface RemoteSettingsState {
  /** El control remoto de este PC existe en este sistema (Windows, macOS o Linux). */
  available: boolean
  signedIn: boolean
  enabled: boolean
  deviceName: string
  hasPassword: boolean
  features: RemoteFeaturesInfo
  confirmLocal: boolean
  preventSleep: boolean
  /** K se guarda cifrada con el almacén seguro del sistema. */
  encryptionAvailable: boolean
  support: RemoteSupportInfo
  platform: string
  /** macOS 27 o posterior: el permiso de Accesibilidad se llama "Control de dispositivos y acceso a datos". */
  accessibilityRenamed: boolean
  /** Alguien controla este PC ahora. */
  active: boolean
  /** Propiedad confirmada por la API; no describe salud ni certificación del servicio. */
  agentOwned?: boolean
  agentOwnershipPersistenceFailed?: boolean
  log: RemoteLogInfo[]
}

export interface RemoteSettingsChanges {
  deviceName?: string
  features?: Partial<RemoteFeaturesInfo>
  confirmLocal?: boolean
  preventSleep?: boolean
}

export type RemoteSettingsResult =
  | { ok: true; state: RemoteSettingsState }
  | { ok: false; code: string; state?: RemoteSettingsState }

export const MIN_PC_PASSWORD_LENGTH = 8
export const MAX_DEVICE_NAME_LENGTH = 100
