// Ajustes del control remoto de ESTE PC (add-remote-desktop D14, tarea 6.2): lo que lee y cambia la
// ventana principal. Cada cambio avisa a HostService: desactivar o cambiar la contraseña corta la
// sesión en curso, y el resto se publica en la cuenta en la siguiente vuelta.
import { ipcMain } from 'electron'
import { currentSession } from '../cloud/session'
import {
  MAX_DEVICE_NAME_LENGTH,
  MIN_PC_PASSWORD_LENGTH,
  RemoteSettingsChanges,
  RemoteSettingsResult,
  RemoteSettingsState,
  PrivilegedHostState
} from '../../shared/remote/settings'
import { primeFirewall } from './hostSession'
import { remoteHost, remoteHostStarted } from './hostRuntime'
import { openPermissionSettings } from './platformSupport'
import { accessibilityRenamed } from './support'
import { PasswordTooShortError } from './remoteAccessStore'

/**
 * Si este Windows tiene instalado el componente con privilegios (add-windows-privileged-host). Hoy
 * siempre false: el servicio aún no forma parte de la compilación. Cuando se implemente, aquí se
 * comprobará que el servicio está instalado (solo en Windows).
 */
function privilegedHostAvailable(): boolean {
  return false
}

function privilegedHostState(enabled: boolean): PrivilegedHostState {
  if (process.platform !== 'win32' || !privilegedHostAvailable()) return 'unavailable'
  return enabled ? 'enabled' : 'disabled'
}

async function state(): Promise<RemoteSettingsState | null> {
  const { store, service, support } = remoteHost()
  if (!store) return null
  const snapshot = await store.snapshot()
  return {
    available: true,
    signedIn: currentSession() !== null,
    enabled: snapshot.enabled,
    deviceName: snapshot.deviceName,
    hasPassword: snapshot.hasPassword,
    features: snapshot.features,
    confirmLocal: snapshot.confirmLocal,
    preventSleep: snapshot.preventSleep,
    privilegedHost: privilegedHostState(snapshot.privilegedHostEnabled),
    encryptionAvailable: snapshot.encryptionAvailable,
    support: support(),
    platform: process.platform,
    accessibilityRenamed:
      process.platform === 'darwin' && accessibilityRenamed(process.getSystemVersion()),
    active: service?.isActive() ?? false,
    log: await store.getLog()
  }
}

const UNAVAILABLE: RemoteSettingsResult = { ok: false, code: 'remote_unavailable_here' }

async function result(): Promise<RemoteSettingsResult> {
  const current = await state()
  return current ? { ok: true, state: current } : UNAVAILABLE
}

/** La configuración es de la cuenta con la sesión iniciada: antes de leerla o cambiarla se comprueba. */
async function bindToCurrentAccount(): Promise<void> {
  await remoteHostStarted()
  const email = currentSession()?.email
  if (email) await remoteHost().bindToAccount(email)
}

async function setPassword(password: unknown): Promise<RemoteSettingsResult> {
  const { store, service } = remoteHost()
  if (!store) return UNAVAILABLE
  if (typeof password !== 'string' || password.length < MIN_PC_PASSWORD_LENGTH) {
    return { ok: false, code: 'password_too_short' }
  }
  try {
    await store.setPassword(password)
  } catch (error) {
    if (error instanceof PasswordTooShortError) return { ok: false, code: 'password_too_short' }
    throw error
  }
  // Las sesiones abiertas con la contraseña anterior se cortan (remote-access-host)
  service?.passwordChanged()
  return result()
}

async function setEnabled(enabled: unknown): Promise<RemoteSettingsResult> {
  const { store, service, support } = remoteHost()
  if (!store || typeof enabled !== 'boolean') return UNAVAILABLE
  if (enabled) {
    if (!currentSession()) return { ok: false, code: 'not_signed_in', state: (await state())! }
    if (!(await store.hasPassword()))
      return { ok: false, code: 'password_required', state: (await state())! }
    if (support().state === 'unsupported')
      return { ok: false, code: 'unsupported', state: (await state())! }
  }
  await store.setEnabled(enabled)
  await service?.settingsChanged()
  // En Windows, el cortafuegos pregunta la primera vez que la app usa WebRTC: mejor ahora, con
  // alguien delante, que cuando alguien intente conectarse a un PC sin nadie (D7)
  if (enabled) void primeFirewall().catch(() => undefined)
  return result()
}

async function update(changes: unknown): Promise<RemoteSettingsResult> {
  const { store, service } = remoteHost()
  if (!store || typeof changes !== 'object' || changes === null) return UNAVAILABLE
  const c = changes as RemoteSettingsChanges
  if (c.deviceName !== undefined) {
    const name = typeof c.deviceName === 'string' ? c.deviceName.trim() : ''
    if (name.length === 0 || name.length > MAX_DEVICE_NAME_LENGTH) {
      return { ok: false, code: 'device_name_invalid', state: (await state())! }
    }
    await store.setDeviceName(name)
  }
  if (c.features) {
    const features: Record<string, boolean> = {}
    for (const key of ['clipboard', 'files', 'audio'] as const) {
      if (typeof c.features[key] === 'boolean') features[key] = c.features[key]!
    }
    await store.setFeatures(features)
  }
  if (typeof c.confirmLocal === 'boolean') await store.setConfirmLocal(c.confirmLocal)
  if (typeof c.preventSleep === 'boolean') await store.setPreventSleep(c.preventSleep)
  if (typeof c.privilegedHostEnabled === 'boolean') await store.setPrivilegedHostEnabled(c.privilegedHostEnabled)
  await service?.settingsChanged()
  return result()
}

let ready = false

export function setupRemoteSettingsIpc(): void {
  if (ready) return
  ready = true
  ipcMain.handle('remote-settings:get', async () => {
    await bindToCurrentAccount()
    return result()
  })
  ipcMain.handle('remote-settings:set-password', async (_event, password) => {
    await bindToCurrentAccount()
    return setPassword(password)
  })
  ipcMain.handle('remote-settings:set-enabled', async (_event, enabled) => {
    await bindToCurrentAccount()
    return setEnabled(enabled)
  })
  ipcMain.handle('remote-settings:update', async (_event, changes) => {
    await bindToCurrentAccount()
    return update(changes)
  })
  ipcMain.handle('remote-settings:open-permission', async (_event, permission) => {
    await remoteHostStarted()
    if (permission === 'screen' || permission === 'accessibility') {
      await openPermissionSettings(permission)
    }
    return result()
  })
}
