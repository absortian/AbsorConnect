// El control remoto de ESTE PC dentro de la app (add-remote-desktop D7): monta HostService con las
// piezas reales (API con el token de la sesión, almacenes en userData con la caja segura, permisos
// del sistema, ventana `host`, bandeja, notificaciones y powerSaveBlocker) y lo arranca.
import { app, powerSaveBlocker } from 'electron'
import * as os from 'os'
import { join } from 'path'
import type { AccountExit } from '../cloud/account'
import { currentSession, loadSession } from '../cloud/session'
import { refreshAgentUpdateGuard } from '../updater'
import { getLanguage } from '../store'
import { getMainWindow, setLocalAgentState, setRemoteStatus, showMainWindow } from '../background'
import { DeviceApi, devicePlatform } from './deviceApi'
import { DeviceIdentity } from './deviceIdentity'
import { notifyAccountExpired, notifySession } from './hostNotice'
import { HostCloseReason, HostService } from './hostService'
import { openHostSession } from './hostSession'
import { linuxAudio } from './linuxAudio'
import { createSupportMonitor, detectSupport } from './platformSupport'
import { RemoteSupport, SupportMonitor } from './support'
import { RemoteAccessStore } from './remoteAccessStore'
import { createSafeBox } from './safeBox'
import { AgentStatusClient, installedAgentSource } from './agentStatusClient'
import { AgentControlClient, installedAgentControlSource } from './agentControlClient'
import type { LocalAgentStopResult } from '../../shared/remote/localAgent'
import { absentLocalAgent, type LocalAgentSnapshot } from '../../shared/remote/localAgent'

let service: HostService | null = null
let store: RemoteAccessStore | null = null
let identity: DeviceIdentity | null = null
let monitor: SupportMonitor | null = null
let nativeClient: AgentStatusClient | null = null
const nativeControl = new AgentControlClient(installedAgentControlSource())
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

let starting: Promise<void> | null = null
let stopRequested = false

/**
 * Arranca el servicio. Carga antes la sesión de la cuenta: con la app arrancada oculta al iniciar
 * sesión en el sistema no hay ventana que la pida, y sin ella el PC no estaría disponible.
 */
export function startRemoteHost(): Promise<void> {
  starting ??= start()
  return starting
}

/**
 * Termina cuando ha terminado el arranque. Ajustes puede preguntar antes (la ventana carga mientras
 * la app prepara la bandeja y la sesión, y el primer arranque con Rosetta es lento) y, sin esperar,
 * vería el control remoto como no disponible en este equipo.
 */
export function remoteHostStarted(): Promise<void> {
  return starting?.catch(() => undefined) ?? Promise.resolve()
}

async function start(): Promise<void> {
  const platform = devicePlatform(process.platform)
  if (service || !platform) return
  await loadSession()
  if (stopRequested) return
  nativeClient = new AgentStatusClient(installedAgentSource())
  const native = await nativeClient.read()
  if (!stopRequested) {
    setLocalAgentState(native)
    refreshAgentUpdateGuard()
  }
  if (stopRequested || nativeClient.isClosed) return
  // Fuente de sonido que quedó de una sesión anterior si la app se cerró de golpe (D8)
  if (process.platform === 'linux' && native.ownership === 'legacy') void linuxAudio.cleanup()

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
  if (session && native.ownership === 'legacy') await hostStore.bindToAccount(session.email)

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
    onAgentOwned: () => hostStore.setEnabled(false),
    nativeAgent: () => nativeClient?.read() ?? Promise.resolve(absentLocalAgent()),
    setKeepAwake,
    setStatus: (status, controller) => {
      setRemoteStatus(status, controller)
      refreshAgentUpdateGuard()
    },
    notify: (event, controller) => {
      void getLanguage().then((language) =>
        notifySession(event, controller, language, showMainWindow)
      )
    }
  })
  if (native.ownership !== 'legacy') await service.reserveForLocalAgent()
  if (stopRequested || nativeClient.isClosed) return
  service.start()
  nativeClient.watch((state) => {
    setLocalAgentState(state)
    refreshAgentUpdateGuard()
    if (state.ownership !== 'legacy') void service?.reserveForLocalAgent()
  })
}

/** Para el servicio y corta la sesión en curso (salir de la app; cerrar sesión, tarea 4.10). */
export async function stopRemoteHost(reason: HostCloseReason = 'stopped'): Promise<void> {
  stopRequested = true
  nativeClient?.close()
  const current = service
  service = null
  await current?.stop(reason)
}

/**
 * La cuenta se cierra en este equipo (tarea 4.10): se corta la sesión en curso y el servicio queda
 * parado hasta el siguiente inicio de sesión, conservando la configuración local.
 *   - Al cerrar sesión, además, se da de baja el equipo con el token que había (la cuenta ya lo
 *     ha olvidado), para que deje de aparecer en la cuenta. Sin red, deja de estar en línea a los
 *     30 s sin consultas.
 *   - Si caducó con la app en segundo plano y el control remoto activado, se avisa: si no, nadie
 *     sabría que el PC ha dejado de estar disponible.
 *   - Con la cuenta borrada, el servicio ya borró sus equipos.
 */
export async function signOutRemoteHost(exit: AccountExit, token: string | null): Promise<void> {
  const current = service
  if (!current) return
  // Lo primero, antes de esperar a nada: así la sesión se corta en el momento
  const device = await current.suspend()
  if (exit === 'signed_out' && token && device) {
    await new DeviceApi(() => token).remove(device).catch(() => undefined)
  }
  if (exit === 'expired' && (await store?.isEnabled()) && !getMainWindow()?.isVisible()) {
    notifyAccountExpired(await getLanguage(), showMainWindow)
  }
}

/** Para Ajustes (tarea 6.2), el cierre de sesión (4.10) y la lista de equipos (marcar este PC). */
export function remoteHost(): {
  service: HostService | null
  store: RemoteAccessStore | null
  ownDeviceId: () => Promise<string | null>
  /** Estado del sistema para Ajustes, que ya lo muestra: sin notificación. */
  agentState: () => Promise<LocalAgentSnapshot>
  nativeStopAvailable: () => Promise<boolean>
  stopNativeHost: () => Promise<LocalAgentStopResult>
  support: () => RemoteSupport
  /** Tras iniciar sesión: si la configuración era de otra cuenta, se borra y se desactiva. */
  bindToAccount: (email: string) => Promise<void>
} {
  return {
    service,
    store,
    ownDeviceId: async () => {
      const state = await nativeClient?.read()
      if (state && state.ownership !== 'legacy') return state.deviceId
      return identity ? (await identity.get()).id : null
    },
    agentState: () => nativeClient?.read() ?? Promise.resolve(absentLocalAgent()),
    nativeStopAvailable: () => nativeControl.available(),
    stopNativeHost: async () => {
      const value = await nativeClient?.read()
      if (!value || value.ownership !== 'agent' || value.phase !== 'responding' || !value.deviceId)
        return { ok: false, code: 'local_agent_unverified' }
      return nativeControl.stop(value.deviceId)
    },
    support: () => monitor?.check({ quiet: true }) ?? detectSupport(),
    bindToAccount: async (email) => {
      if (!store || service?.isAgentManaged()) return
      const before = await store.getAccountEmail()
      await store.bindToAccount(email)
      if (before !== null && before !== email) await service?.settingsChanged()
    }
  }
}
