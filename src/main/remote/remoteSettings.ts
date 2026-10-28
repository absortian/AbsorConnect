// Ajustes del control remoto de ESTE PC (add-remote-desktop D14, tarea 6.2): lo que lee y cambia la
// ventana principal. Cada cambio avisa a HostService: desactivar o cambiar la contraseña corta la
// sesión en curso, y el resto se publica en la cuenta en la siguiente vuelta.
import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { getMainWindow } from '../background'
import { getLanguage } from '../store'
import { publicLocalAgentSnapshot } from '../../shared/remote/localAgent'
import { currentSession } from '../cloud/session'
import {
  MAX_DEVICE_NAME_LENGTH,
  MIN_PC_PASSWORD_LENGTH,
  RemoteSettingsChanges,
  RemoteSettingsResult,
  RemoteSettingsState
} from '../../shared/remote/settings'
import { primeFirewall } from './hostSession'
import { remoteHost, remoteHostStarted } from './hostRuntime'
import { openPermissionSettings } from './platformSupport'
import { accessibilityRenamed } from './support'
import { PasswordTooShortError } from './remoteAccessStore'

async function state(): Promise<RemoteSettingsState | null> {
  const { store, service, support, agentState } = remoteHost()
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
    encryptionAvailable: snapshot.encryptionAvailable,
    support: support(),
    platform: process.platform,
    accessibilityRenamed:
      process.platform === 'darwin' && accessibilityRenamed(process.getSystemVersion()),
    active: service?.isActive() ?? false,
    agentOwned: service?.isAgentOwned() ?? false,
    localAgent: publicLocalAgentSnapshot(await agentState()),
    localStopAvailable: await remoteHost().nativeStopAvailable(),
    agentOwnershipPersistenceFailed: service?.didOwnershipPersistenceFail() ?? false,
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
  if (service?.isAgentManaged())
    return { ok: false, code: 'device_agent_owned', state: (await state())! }
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
  if (service?.isAgentManaged())
    return { ok: false, code: 'device_agent_owned', state: (await state())! }
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
  if (service?.isAgentManaged())
    return { ok: false, code: 'device_agent_owned', state: (await state())! }
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
  await service?.settingsChanged()
  return result()
}

/** Ni visores, host oculto o subframes pueden consultar/configurar el host local. */
function trustedMainFrame(event: IpcMainInvokeEvent): boolean {
  const main = getMainWindow()
  return (
    !!main && event.sender === main.webContents && event.senderFrame === main.webContents.mainFrame
  )
}
const FORBIDDEN: RemoteSettingsResult = { ok: false, code: 'forbidden' }

let ready = false

export function setupRemoteSettingsIpc(): void {
  if (ready) return
  ready = true
  ipcMain.handle('remote-settings:stop-agent', async (event, ...args) => {
    if (!trustedMainFrame(event) || args.length !== 0) return { ok: false, code: 'forbidden' }
    await remoteHostStarted()
    const before = await remoteHost().agentState()
    if (
      before.phase !== 'responding' ||
      before.ownership !== 'agent' ||
      !before.deviceId ||
      !(await remoteHost().nativeStopAvailable())
    )
      return { ok: false, code: 'local_agent_control_unavailable' }
    const spanish = (await getLanguage()) === 'es'
    const account = currentSession()
    const parent = getMainWindow()
    if (!parent) return { ok: false, code: 'cancelled' }
    const response = await dialog.showMessageBox(parent, {
      type: 'warning',
      title: 'Absor Connect',
      message: spanish ? '¿Detener el host nativo de este PC?' : 'Stop the native host on this PC?',
      detail: spanish
        ? 'Se cortará la sesión remota y hará falta una nueva alta autorizada para reactivarlo. Salir de la interfaz no requiere esta parada.'
        : 'This ends the remote session and requires a new authorized enrollment to reactivate the host. Quitting the interface does not require this stop.',
      buttons: spanish ? ['Cancelar', 'Detener host'] : ['Cancel', 'Stop host'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (response.response !== 1 || currentSession() !== account || !trustedMainFrame(event))
      return { ok: false, code: 'cancelled' }
    const after = await remoteHost().agentState()
    if (
      after.deviceId !== before.deviceId ||
      after.phase !== 'responding' ||
      after.ownership !== 'agent'
    )
      return { ok: false, code: 'local_agent_unverified' }
    return remoteHost().stopNativeHost()
  })
  ipcMain.handle('remote-settings:get', async (event, ...args) => {
    if (!trustedMainFrame(event) || args.length !== 0) return FORBIDDEN
    await bindToCurrentAccount()
    return result()
  })
  ipcMain.handle('remote-settings:set-password', async (event, password, ...args) => {
    if (!trustedMainFrame(event) || args.length !== 0) return FORBIDDEN
    await bindToCurrentAccount()
    return setPassword(password)
  })
  ipcMain.handle('remote-settings:set-enabled', async (event, enabled, ...args) => {
    if (!trustedMainFrame(event) || args.length !== 0) return FORBIDDEN
    await bindToCurrentAccount()
    return setEnabled(enabled)
  })
  ipcMain.handle('remote-settings:update', async (event, changes, ...args) => {
    if (!trustedMainFrame(event) || args.length !== 0) return FORBIDDEN
    await bindToCurrentAccount()
    return update(changes)
  })
  ipcMain.handle('remote-settings:open-permission', async (event, permission, ...args) => {
    if (!trustedMainFrame(event) || args.length !== 0) return FORBIDDEN
    await remoteHostStarted()
    if (permission === 'screen' || permission === 'accessibility') {
      await openPermissionSettings(permission)
    }
    return result()
  })
}
