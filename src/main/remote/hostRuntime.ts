// El control remoto de ESTE PC dentro de la app (add-remote-desktop D7): monta HostService con las
// piezas reales (API con el token de la sesión, almacenes en userData con la caja segura, permisos
// del sistema, ventana `host`, bandeja, notificaciones y powerSaveBlocker) y lo arranca.
import { app, powerSaveBlocker } from 'electron'
import * as os from 'os'
import { join } from 'path'
import { currentSession, loadSession } from '../cloud/session'
import { getLanguage } from '../store'
import { setRemoteStatus, showMainWindow } from '../background'
import { DeviceApi, devicePlatform } from './deviceApi'
import { DeviceIdentity } from './deviceIdentity'
import { notifySession } from './hostNotice'
import { HostCloseReason, HostService } from './hostService'
import { openHostSession } from './hostSession'
import { createSupportMonitor, detectSupport } from './platformSupport'
import { RemoteSupport, SupportMonitor } from './support'
import { RemoteAccessStore } from './remoteAccessStore'
import { createSafeBox } from './safeBox'

let service: HostService | null = null
let store: RemoteAccessStore | null = null
let identity: DeviceIdentity | null = null
let monitor: SupportMonitor | null = null
let keepAwakeId: number | null = null

function setKeepAwake(on: boolean): void {
  if (on && keepAwakeId === null) {
    // La pantalla sí puede apagarse: la entrada remota la despierta (D7)
    keepAwakeId = powerSaveBlocker.start('prevent-app-suspension')
  } else if (!on && keepAwakeId !== null) {
    powerSaveBlocker.stop(keepAwakeId)
    keepAwakeId = null
  }
}

/**
 * Arranca el servicio. Carga antes la sesión de la cuenta: con la app arrancada oculta al iniciar
 * sesión en el sistema no hay ventana que la pida, y sin ella el PC no estaría disponible.
 */
export async function startRemoteHost(): Promise<void> {
  const platform = devicePlatform(process.platform)
  if (service || !platform) return
  await loadSession()

  const userData = app.getPath('userData')
  const box = createSafeBox()
  store = new RemoteAccessStore(join(userData, 'remote-access.json'), box, os.hostname())
  const deviceIdentity = new DeviceIdentity(join(userData, 'device.json'), box)
  identity = deviceIdentity
  const api = new DeviceApi(() => currentSession()?.token ?? null)
  const hostStore = store
  const supportMonitor = createSupportMonitor({
    language: getLanguage,
    onClick: showMainWindow,
    onChange: () => service?.refresh()
  })
  monitor = supportMonitor
  // La configuración pertenece a la cuenta que la creó: con otra cuenta se borra (D14)
  const session = currentSession()
  if (session) await hostStore.bindToAccount(session.email)

  service = new HostService({
    api,
    identity: deviceIdentity,
    store: hostStore,
    support: (enabled) => supportMonitor.check({ quiet: !enabled }),
    signedIn: () => currentSession() !== null,
    platform,
    appVersion: app.getVersion(),
    openSession: (request) =>
      openHostSession(request, {
        store: hostStore,
        iceServers: () => api.iceServers(),
        language: getLanguage
      }),
    setKeepAwake,
    setStatus: setRemoteStatus,
    notify: (event, controller) => {
      void getLanguage().then((language) =>
        notifySession(event, controller, language, showMainWindow)
      )
    }
  })
  service.start()
}

/** Para el servicio y corta la sesión en curso (salir de la app; cerrar sesión, tarea 4.10). */
export async function stopRemoteHost(reason: HostCloseReason = 'stopped'): Promise<void> {
  const current = service
  service = null
  await current?.stop(reason)
}

/** Para Ajustes (tarea 6.2), el cierre de sesión (4.10) y la lista de equipos (marcar este PC). */
export function remoteHost(): {
  service: HostService | null
  store: RemoteAccessStore | null
  ownDeviceId: () => Promise<string | null>
  /** Estado del sistema para Ajustes, que ya lo muestra: sin notificación. */
  support: () => RemoteSupport
  /** Tras iniciar sesión: si la configuración era de otra cuenta, se borra y se desactiva. */
  bindToAccount: (email: string) => Promise<void>
} {
  return {
    service,
    store,
    ownDeviceId: async () => (identity ? (await identity.get()).id : null),
    support: () => monitor?.check({ quiet: true }) ?? detectSupport(),
    bindToAccount: async (email) => {
      if (!store) return
      const before = await store.getAccountEmail()
      await store.bindToAccount(email)
      if (before !== null && before !== email) await service?.settingsChanged()
    }
  }
}
