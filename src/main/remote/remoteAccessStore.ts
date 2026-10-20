// Configuración del control remoto de ESTE PC (add-remote-desktop D6/D14, remote-access-host).
// Vive solo en el equipo, en remote-access.json. La contraseña NUNCA se guarda: de ella se deriva K
// (password.ts), que se cifra con la caja inyectada. Los fallos y el bloqueo se persisten, el
// registro se acota a 50 eventos, y toda la configuración pertenece a la cuenta que la creó.
import * as fs from 'fs/promises'
import { writeAtomic } from './atomicWrite'
import { SecretBox } from './secretBox'
import { deriveKey, MIN_PASSWORD_LENGTH, newPasswordParams, PasswordParams } from './password'
import {
  clearFailures,
  isLocked,
  LockState,
  lockRemainingSeconds,
  registerFailure
} from './lockout'
import { appendLog, RemoteLogEntry } from './sessionLog'

export interface RemoteFeatures {
  clipboard: boolean
  files: boolean
  audio: boolean
}

interface StoredPassword {
  salt: string
  iterations: number
  key: string // caja.seal(K)
}

interface RemoteAccessFile {
  accountEmail: string | null
  deviceName: string
  enabled: boolean
  password: StoredPassword | null
  features: RemoteFeatures
  confirmLocal: boolean
  preventSleep: boolean
  failures: number[]
  lockedUntil: number | null
  log: RemoteLogEntry[]
}

function defaults(deviceName: string): RemoteAccessFile {
  return {
    accountEmail: null,
    deviceName,
    enabled: false,
    password: null,
    features: { clipboard: true, files: true, audio: true },
    confirmLocal: false,
    preventSleep: false,
    failures: [],
    lockedUntil: null,
    log: []
  }
}

export class PasswordTooShortError extends Error {}

export class RemoteAccessStore {
  private data: RemoteAccessFile | null = null

  constructor(
    private readonly path: string,
    private readonly box: SecretBox,
    private readonly defaultDeviceName: string
  ) {}

  private async load(): Promise<RemoteAccessFile> {
    if (this.data) return this.data
    try {
      const parsed = JSON.parse(await fs.readFile(this.path, 'utf-8')) as Partial<RemoteAccessFile>
      this.data = { ...defaults(this.defaultDeviceName), ...parsed }
    } catch {
      this.data = defaults(this.defaultDeviceName)
    }
    return this.data
  }

  private async persist(): Promise<void> {
    if (this.data) await writeAtomic(this.path, JSON.stringify(this.data, null, 2))
  }

  // --- Lectura de estado -----------------------------------------------------

  async snapshot(): Promise<{
    enabled: boolean
    deviceName: string
    hasPassword: boolean
    features: RemoteFeatures
    confirmLocal: boolean
    preventSleep: boolean
    encryptionAvailable: boolean
  }> {
    const d = await this.load()
    return {
      enabled: d.enabled,
      deviceName: d.deviceName,
      hasPassword: d.password !== null,
      features: d.features,
      confirmLocal: d.confirmLocal,
      preventSleep: d.preventSleep,
      encryptionAvailable: this.box.available
    }
  }

  async getFeatures(): Promise<RemoteFeatures> {
    return (await this.load()).features
  }

  async isEnabled(): Promise<boolean> {
    const d = await this.load()
    return d.enabled && d.password !== null
  }

  // --- Contraseña ------------------------------------------------------------

  async hasPassword(): Promise<boolean> {
    return (await this.load()).password !== null
  }

  /** Define o cambia la contraseña: deriva K, la cifra y reinicia los fallos. No la guarda. */
  async setPassword(password: string): Promise<void> {
    if (password.length < MIN_PASSWORD_LENGTH) throw new PasswordTooShortError()
    const d = await this.load()
    const params = newPasswordParams()
    const key = deriveKey(password, params)
    d.password = { salt: params.salt, iterations: params.iterations, key: this.box.seal(key) }
    Object.assign(d, clearFailures())
    await this.persist()
  }

  async clearPassword(): Promise<void> {
    const d = await this.load()
    d.password = null
    d.enabled = false
    await this.persist()
  }

  /** Parámetros que el equipo envía en `hello` para que el controlador derive la misma K. */
  async getPasswordParams(): Promise<PasswordParams | null> {
    const d = await this.load()
    return d.password ? { salt: d.password.salt, iterations: d.password.iterations } : null
  }

  /** K descifrada, para verificar el desafío de autenticación (4.4). La contraseña no se guarda. */
  async getKey(): Promise<Buffer | null> {
    const d = await this.load()
    return d.password ? this.box.open(d.password.key) : null
  }

  // --- Bloqueo tras intentos fallidos ---------------------------------------

  async isLocked(now = Date.now()): Promise<boolean> {
    return isLocked(await this.lockState(), now)
  }

  async lockRemainingSeconds(now = Date.now()): Promise<number> {
    return lockRemainingSeconds(await this.lockState(), now)
  }

  /** Un intento con la contraseña incorrecta, con el equipo que lo hizo para el registro. */
  async registerFailure(now = Date.now(), controller?: string): Promise<void> {
    const d = await this.load()
    const next = registerFailure(this.toLockState(d), now)
    d.failures = next.failures
    const wasLocked = d.lockedUntil
    d.lockedUntil = next.lockedUntil
    if (next.lockedUntil && next.lockedUntil !== wasLocked) {
      d.log = appendLog(d.log, { at: now, type: 'locked', controller })
    }
    d.log = appendLog(d.log, { at: now, type: 'auth-failed', controller })
    await this.persist()
  }

  async clearFailures(): Promise<void> {
    const d = await this.load()
    Object.assign(d, clearFailures())
    await this.persist()
  }

  private async lockState(): Promise<LockState> {
    return this.toLockState(await this.load())
  }

  private toLockState(d: RemoteAccessFile): LockState {
    return { failures: d.failures, lockedUntil: d.lockedUntil }
  }

  // --- Registro de sesiones --------------------------------------------------

  async addLog(entry: RemoteLogEntry): Promise<void> {
    const d = await this.load()
    d.log = appendLog(d.log, entry)
    await this.persist()
  }

  async getLog(): Promise<RemoteLogEntry[]> {
    return (await this.load()).log
  }

  // --- Opciones --------------------------------------------------------------

  async setEnabled(enabled: boolean): Promise<void> {
    const d = await this.load()
    d.enabled = enabled
    await this.persist()
  }

  async setDeviceName(name: string): Promise<void> {
    const d = await this.load()
    d.deviceName = name
    await this.persist()
  }

  async setFeatures(features: Partial<RemoteFeatures>): Promise<void> {
    const d = await this.load()
    d.features = { ...d.features, ...features }
    await this.persist()
  }

  async setConfirmLocal(value: boolean): Promise<void> {
    const d = await this.load()
    d.confirmLocal = value
    await this.persist()
  }

  async setPreventSleep(value: boolean): Promise<void> {
    const d = await this.load()
    d.preventSleep = value
    await this.persist()
  }

  // --- Vínculo con la cuenta -------------------------------------------------

  /**
   * Asocia la configuración a la cuenta con la sesión iniciada. Si venía de OTRA cuenta, borra la
   * contraseña, el registro y el estado de bloqueo y desactiva el control remoto: la configuración
   * pertenece a la cuenta que la creó (spec "Control remoto ligado a la cuenta").
   */
  async bindToAccount(email: string): Promise<void> {
    const d = await this.load()
    // Ajustes lo comprueba en cada lectura: si ya es de esta cuenta no hay nada que escribir
    if (d.accountEmail === email) return
    if (d.accountEmail !== null) {
      this.data = { ...defaults(this.defaultDeviceName), accountEmail: email }
    } else {
      d.accountEmail = email
    }
    await this.persist()
  }

  async getAccountEmail(): Promise<string | null> {
    return (await this.load()).accountEmail
  }
}
