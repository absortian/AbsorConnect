// Servicio del PC controlado (add-remote-desktop D3/D7): registra el equipo en la cuenta, consulta
// cada 3 s las solicitudes de sesión (la consulta es también su señal de vida), rechaza sin abrir
// conexión las que no puede atender y lleva la sesión en curso: una a la vez, con aviso, registro
// local y corte al desactivar, al cambiar la contraseña o al salir de la cuenta.
//
// Todo lo que toca Electron o la red llega inyectado: así se prueba con tests y contra el backend
// de desarrollo. La conexión en sí (ventana oculta `host`, WebRTC, captura) la crea `openSession`.
import { ApiError } from '../cloud/apiClient'
import {
  DeviceApi,
  DeviceCredentials,
  DeviceInfo,
  DevicePlatform,
  PendingRequest
} from './deviceApi'
import {
  deviceState,
  EarlyRejection,
  earlyRejection,
  HostConditions,
  shouldPoll
} from './hostPolicy'
import { RemoteAccessStore } from './remoteAccessStore'
import { RemoteSupport } from './support'
import type { LocalAgentSnapshot } from '../../shared/remote/localAgent'

export const POLL_INTERVAL_MS = 3_000
export const REGISTER_INTERVAL_MS = 5 * 60_000
/** Sin sesión de la cuenta no se hace nada; se vuelve a mirar cada poco por si se inicia. */
const SIGNED_OUT_RETRY_MS = 10_000
/** Con REMOTE_ENABLED=0 en el servicio (503 remote_unavailable). */
const UNAVAILABLE_RETRY_MS = 5 * 60_000
const MAX_BACKOFF_MS = 60_000
/** Otros errores (p. ej. 400): no tiene sentido insistir cada 3 s. */
const OTHER_ERROR_RETRY_MS = 60_000

export type HostCloseReason =
  | 'local'
  | 'disabled'
  | 'password_changed'
  | 'signed_out'
  | 'expired'
  | 'stopped'
  | 'capture_failed'
  | 'ended'

/** Una conexión abierta para una solicitud (la crea la ventana `host`, tarea 4.8 bloque B). */
export interface HostSession {
  /** Descripción de sesión completa, con candidatos, que se publica como respuesta. */
  answer: string
  /** Se resuelve cuando la conexión queda autenticada (y aceptada en el PC si se pide). */
  started: Promise<void>
  /** Se resuelve cuando la sesión termina por cualquier motivo. */
  ended: Promise<void>
  close(reason: HostCloseReason): void
}

export type TrayStatus = 'off' | 'available' | 'active' | 'agent'

export interface HostServiceDeps {
  api: Pick<DeviceApi, 'register' | 'poll' | 'answer' | 'reject'>
  identity: { get(): Promise<DeviceCredentials>; reset(): Promise<DeviceCredentials> }
  store: Pick<RemoteAccessStore, 'isEnabled' | 'snapshot' | 'lockRemainingSeconds' | 'addLog'>
  /**
   * Estado del sistema (permisos de macOS, Wayland): SupportMonitor.check(). Con el control remoto
   * desactivado se mira sin notificar la pérdida de permisos.
   */
  support: (enabled: boolean) => RemoteSupport
  /** Hay sesión de la cuenta iniciada (con token). */
  signedIn: () => boolean
  platform: DevicePlatform
  appVersion: string
  openSession: (request: PendingRequest) => Promise<HostSession>
  /** Evitar la suspensión (powerSaveBlocker) mientras el control remoto está activado. */
  setKeepAwake: (on: boolean) => void
  /** Estado para la bandeja (background.ts). */
  setStatus: (status: TrayStatus, controller: string | null) => void
  /** Notificación del sistema al empezar y al terminar cada sesión. */
  notify: (event: 'session-start' | 'session-end', controller: string) => void
  /** Persistir la desactivación del host de usuario al detectar propietario nativo. */
  onAgentOwned?: () => Promise<void>
  /** Consulta de solo lectura: nunca concede captura ni para el servicio nativo. */
  nativeAgent?: () => Promise<LocalAgentSnapshot>
  now?: () => number
}

interface Current {
  request: PendingRequest
  session: HostSession
  startedAt: number | null
}

export class HostService {
  private running = false
  private agentOwned = false
  private nativeReserved = false
  private ownershipPersistenceFailed = false
  /** Fuera de la cuenta (tarea 4.10): ni registro ni consultas hasta `resume()`. */
  private suspended = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private ticking: Promise<void> | null = null
  private registered: { fingerprint: string; at: number } | null = null
  private registrationDirty = true
  /** Se pidió mirar ya (refresh) mientras corría una vuelta: la siguiente va sin esperar. */
  private wakeRequested = false
  private opening = false
  private current: Current | null = null
  private readonly lifetimeSessions = new Set<HostSession>()
  private drainFailed = false
  private localReservation: Promise<void> | null = null
  private networkFailures = 0
  private status: string | null = null
  private keepAwake: boolean | null = null
  private readonly now: () => number

  constructor(private readonly deps: HostServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule(0)
  }

  /** Para el servicio y corta la sesión en curso (cerrar sesión de la cuenta, salir de la app). */
  async stop(reason: HostCloseReason = 'stopped'): Promise<void> {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.current?.session.close(reason)
    await this.ticking
    this.setKeepAwake(false)
    this.setStatus(this.isAgentManaged() ? 'agent' : 'off', null)
  }

  /**
   * La cuenta se cierra en este equipo (cerrar sesión, caducidad o cuenta borrada; tarea 4.10):
   * corta la sesión en curso y deja de registrarse y de consultar hasta `resume()`. Devuelve el
   * equipo cuando ya no queda ninguna vuelta en marcha, para darlo de baja sin que una vuelta
   * atrasada lo vuelva a registrar.
   */
  async suspend(): Promise<DeviceCredentials | null> {
    this.suspended = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.current?.session.close('signed_out')
    await this.ticking
    // La conexión que se haya abierto durante esa última vuelta
    this.current?.session.close('signed_out')
    this.registered = null
    this.updateLocal(null)
    return this.nativeReserved ? null : this.deps.identity.get()
  }

  /** Tras iniciar sesión: registrarse y consultar en el momento. */
  resume(): void {
    this.suspended = false
    this.refresh()
  }

  /** Algo cambió (Ajustes, permisos, inicio de sesión): registrar y consultar ya. */
  refresh(): void {
    this.registrationDirty = true
    if (this.ticking) this.wakeRequested = true
    else this.schedule(0)
  }

  /** Tras cambiar Ajustes. Desactivar el control remoto corta la sesión al momento. */
  async settingsChanged(): Promise<void> {
    if (this.isAgentManaged()) {
      // Una escritura de Ajustes iniciada antes del 409 no puede reactivar el host.
      try {
        await this.deps.onAgentOwned?.()
        this.ownershipPersistenceFailed = false
      } catch {
        this.ownershipPersistenceFailed = true
      }
      return
    }
    if (!(await this.deps.store.isEnabled())) this.current?.session.close('disabled')
    this.refresh()
  }

  /** Cambiar la contraseña corta las sesiones activas (la siguiente necesita la nueva). */
  passwordChanged(): void {
    this.current?.session.close('password_changed')
    this.refresh()
  }

  /** Botón "Desconectar" del aviso en el PC controlado. */
  disconnect(): void {
    this.current?.session.close('local')
  }

  /** Alguien controla ahora este PC (para no instalar actualizaciones durante la sesión). */
  isActive(): boolean {
    return this.current?.startedAt != null
  }

  /** Un 409 de propiedad no es una contraseña incorrecta ni autoriza otra identidad. */
  isAgentOwned(): boolean {
    return this.agentOwned
  }

  /** Presencia nativa ambigua también reserva el host; no afirma salud o propiedad API. */
  isAgentManaged(): boolean {
    return this.agentOwned || this.nativeReserved
  }

  async reserveForLocalAgent(): Promise<void> {
    if (!this.localReservation) {
      this.nativeReserved = true
      this.localReservation = this.reserveHost()
    }
    await this.localReservation
  }

  /** Solo el coordinador Main: no copiar K/contador hasta terminar todos los trabajos legado. */
  async quiesceForMigration(): Promise<void> {
    await this.reserveForLocalAgent()
    await this.ticking
    while (this.lifetimeSessions.size)
      await Promise.all([...this.lifetimeSessions].map((session) => session.ended))
    if (this.drainFailed || this.opening || this.ownershipPersistenceFailed)
      throw new Error('agent_migration_legacy_not_quiescent')
  }

  private async observeNativeOwnership(): Promise<boolean> {
    if (this.isAgentManaged()) return true
    try {
      const state = await this.deps.nativeAgent?.()
      if (state && state.ownership !== 'legacy') await this.reserveForLocalAgent()
    } catch {
      // Una consulta ambigua tampoco autoriza un segundo host.
      await this.reserveForLocalAgent()
    }
    return this.isAgentManaged()
  }

  didOwnershipPersistenceFail(): boolean {
    return this.ownershipPersistenceFailed
  }

  private async transferOwnership(): Promise<void> {
    if (this.agentOwned) return
    this.agentOwned = true
    await this.reserveHost()
  }

  private async reserveHost(): Promise<void> {
    this.registrationDirty = true
    this.registered = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const session of this.lifetimeSessions) session.close('stopped')
    this.setKeepAwake(false)
    this.setStatus('agent', null)
    try {
      await this.deps.onAgentOwned?.()
    } catch {
      this.ownershipPersistenceFailed = true
    }
  }

  private schedule(delay: number): void {
    if (!this.running || this.suspended || this.isAgentManaged()) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.ticking = this.tick().finally(() => {
        this.ticking = null
      })
    }, delay)
  }

  private async tick(): Promise<void> {
    let delay = POLL_INTERVAL_MS
    try {
      if (await this.observeNativeOwnership()) return
      if (!this.running || this.suspended) return
      if (!this.deps.signedIn()) {
        this.updateLocal(null)
        delay = SIGNED_OUT_RETRY_MS
        return
      }
      const conditions = await this.conditions()
      this.updateLocal(conditions)
      await this.register(conditions)
      if (this.isAgentManaged()) return
      if (!shouldPoll(conditions)) {
        delay = REGISTER_INTERVAL_MS
        return
      }
      const requests = await this.poll()
      if (requests === null) {
        delay = 0
        return
      }
      for (const request of requests) await this.handle(request)
      this.networkFailures = 0
    } catch (error) {
      if (isCode(error, 'device_agent_owned')) await this.transferOwnership()
      delay = this.retryDelay(error)
    } finally {
      this.schedule(this.wakeRequested ? 0 : delay)
      this.wakeRequested = false
    }
  }

  private async conditions(): Promise<HostConditions> {
    const enabled = await this.deps.store.isEnabled()
    return {
      enabled,
      support: this.deps.support(enabled),
      lockRemainingSeconds: await this.deps.store.lockRemainingSeconds(this.now()),
      busy: this.opening || this.current !== null
    }
  }

  /** Bandeja y "mantener despierto" según el estado; solo avisa cuando cambian. */
  private updateLocal(conditions: HostConditions | null): void {
    void this.applyKeepAwake(conditions)
    if (this.isAgentManaged()) {
      this.setStatus('agent', null)
      return
    }
    if (this.current?.startedAt != null) {
      this.setStatus('active', this.current.request.controllerName)
      return
    }
    const state = conditions ? deviceState(conditions) : 'disabled'
    this.setStatus(state === 'available' || state === 'busy' ? 'available' : 'off', null)
  }

  private async applyKeepAwake(conditions: HostConditions | null): Promise<void> {
    const on =
      conditions !== null && conditions.enabled && (await this.deps.store.snapshot()).preventSleep
    this.setKeepAwake(on && this.running && !this.isAgentManaged())
  }

  private setKeepAwake(on: boolean): void {
    if (this.keepAwake === on) return
    this.keepAwake = on
    this.deps.setKeepAwake(on)
  }

  private setStatus(status: TrayStatus, controller: string | null): void {
    const key = `${status}:${controller ?? ''}`
    if (this.status === key) return
    this.status = key
    this.deps.setStatus(status, controller)
  }

  /** Registro al empezar, cada 5 min y cuando cambia lo que se publica (estado, nombre, funciones). */
  private async register(conditions: HostConditions): Promise<void> {
    const snapshot = await this.deps.store.snapshot()
    const info: DeviceInfo = {
      name: snapshot.deviceName,
      platform: this.deps.platform,
      appVersion: this.deps.appVersion,
      remote: { state: deviceState(conditions), features: snapshot.features }
    }
    const fingerprint = JSON.stringify(info)
    const fresh =
      this.registered !== null &&
      this.registered.fingerprint === fingerprint &&
      this.now() - this.registered.at < REGISTER_INTERVAL_MS
    if (fresh && !this.registrationDirty) return

    if (await this.observeNativeOwnership()) return
    let device = await this.deps.identity.get()
    if (this.isAgentManaged()) return
    try {
      await this.deps.api.register(device, info)
    } catch (error) {
      // El identificador es de otra cuenta, o esta cuenta lo tiene con otra clave: identidad nueva
      if (!isCode(error, 'device_taken', 'device_key_invalid')) throw error
      if (await this.observeNativeOwnership()) return
      device = await this.deps.identity.reset()
      if (this.isAgentManaged()) return
      await this.deps.api.register(device, info)
    }
    this.registered = { fingerprint, at: this.now() }
    this.registrationDirty = false
  }

  /** Solicitudes pendientes; null si hay que volver a registrar el equipo antes. */
  private async poll(): Promise<PendingRequest[] | null> {
    if (await this.observeNativeOwnership()) return []
    try {
      return await this.deps.api.poll(await this.deps.identity.get())
    } catch (error) {
      if (isCode(error, 'device_key_invalid')) {
        if (await this.observeNativeOwnership()) return []
        await this.deps.identity.reset()
        this.registrationDirty = true
        return null
      }
      if (isCode(error, 'device_not_found')) {
        this.registrationDirty = true
        return null
      }
      throw error
    }
  }

  private async handle(request: PendingRequest): Promise<void> {
    if (await this.observeNativeOwnership()) return
    const device = await this.deps.identity.get()
    const rejection = earlyRejection(await this.conditions())
    if (rejection) {
      await this.reject(device, request.id, rejection)
      return
    }

    this.opening = true
    this.registrationDirty = true
    let session: HostSession
    try {
      session = await this.deps.openSession(request)
      this.lifetimeSessions.add(session)
      void session.ended.then(
        () => this.lifetimeSessions.delete(session),
        () => {
          this.drainFailed = true
          this.lifetimeSessions.delete(session)
        }
      )
    } catch {
      this.opening = false
      await this.reject(device, request.id, { reason: 'unsupported' })
      return
    }
    if (this.isAgentManaged()) {
      this.opening = false
      session.close('stopped')
      return
    }
    try {
      await this.deps.api.answer(device, request.id, session.answer)
    } catch (error) {
      this.opening = false
      if (isCode(error, 'device_agent_owned')) {
        // La sesión aún no está en current: cortarla antes de persistir o esperar.
        session.close('stopped')
        await this.transferOwnership()
        return
      }
      // Caducada (más de 60 s) o ya respondida: la conexión no llegará a usarse
      session.close('expired')
      return
    }
    this.opening = false
    if (this.isAgentManaged()) {
      session.close('stopped')
      return
    }
    const current: Current = { request, session, startedAt: null }
    this.current = current
    session.started.then(
      () => this.onStarted(current),
      () => undefined
    )
    session.ended.then(
      () => this.onEnded(current),
      () => this.onEnded(current)
    )
  }

  private async reject(
    device: DeviceCredentials,
    requestId: string,
    rejection: EarlyRejection
  ): Promise<void> {
    try {
      await this.deps.api.reject(device, requestId, rejection.reason, rejection.retryAfter)
    } catch (error) {
      if (isCode(error, 'device_agent_owned')) await this.transferOwnership()
      // Ya caducó o la respondió otra instancia: nada que hacer
    }
  }

  private onStarted(current: Current): void {
    if (this.current !== current || this.isAgentManaged()) {
      current.session.close('stopped')
      return
    }
    current.startedAt = this.now()
    const controller = current.request.controllerName
    this.setStatus('active', controller)
    this.deps.notify('session-start', controller)
    void this.deps.store.addLog({ at: current.startedAt, type: 'session-start', controller })
    this.refresh()
  }

  private onEnded(current: Current): void {
    if (this.current !== current) return
    this.current = null
    if (current.startedAt !== null) {
      const controller = current.request.controllerName
      const at = this.now()
      this.deps.notify('session-end', controller)
      void this.deps.store.addLog({
        at,
        type: 'session-end',
        controller,
        durationMs: at - current.startedAt
      })
    }
    this.status = null
    // Fuera de la cuenta no hay más vueltas: la bandeja se actualiza aquí
    if (this.suspended) this.updateLocal(null)
    this.refresh()
  }

  private retryDelay(error: unknown): number {
    if (isCode(error, 'too_many_requests')) {
      const retryAfter = (error as ApiError).body as {
        error?: { details?: { retryAfter?: unknown } }
      }
      const seconds = Number(retryAfter?.error?.details?.retryAfter)
      return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : POLL_INTERVAL_MS
    }
    if (isCode(error, 'remote_unavailable')) return UNAVAILABLE_RETRY_MS
    if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
      this.networkFailures++
      return Math.min(MAX_BACKOFF_MS, POLL_INTERVAL_MS * 2 ** (this.networkFailures - 1))
    }
    return OTHER_ERROR_RETRY_MS
  }
}

function isCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof ApiError && codes.includes(error.code)
}
