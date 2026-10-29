// Material de importación solo de Main; nunca es un DTO de preload o renderer.
import { inspect } from 'util'
import { isDeviceId } from '../../shared/remote/agentDevice'
import { PBKDF2_ITERATIONS } from './password'
import { MigrationSourceError, readPrivateMigrationJson } from './privateMigrationFile'
import type { SecretBox } from './secretBox'
import type { RemoteFeatures } from './remoteAccessStore'
export class MigrationSecureStorageError extends Error {
  constructor() {
    super('agent_migration_secure_storage_required')
  }
}
interface Options {
  enabled: boolean
  deviceName: string
  features: RemoteFeatures
  confirmLocal: boolean
  preventSleep: boolean
}
interface Lockout {
  failures: number[]
  lockedUntil: number | null
  observedAt: number
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const canonicalBase64 = (value: unknown, length: number): value is string =>
  typeof value === 'string' &&
  Buffer.from(value, 'base64').length === length &&
  Buffer.from(value, 'base64').toString('base64') === value
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export class LegacyMigrationMaterial {
  #key: Buffer | null
  constructor(
    key: Buffer,
    private readonly salt: string,
    private readonly options: Options,
    private readonly lockout: Lockout
  ) {
    this.#key = Buffer.from(key)
  }
  /** Solo el proveedor protegido consume este buffer por stdin; el llamante lo destruye después. */
  provisioningPayload(input: {
    transactionId: string
    deviceId: string
    origin: string
    enrollmentToken: string
    enabled: boolean
    confirmLocal: boolean
  }): Buffer {
    if (
      !this.#key ||
      !isDeviceId(input.transactionId) ||
      !isDeviceId(input.deviceId) ||
      !/^ace_[A-Za-z0-9_-]{43}$/.test(input.enrollmentToken) ||
      typeof input.enabled !== 'boolean' ||
      typeof input.confirmLocal !== 'boolean'
    )
      throw new MigrationSourceError()
    let origin: URL
    try {
      origin = new URL(input.origin)
    } catch {
      throw new MigrationSourceError()
    }
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      (origin.protocol === 'http:' && origin.hostname !== '127.0.0.1')
    )
      throw new MigrationSourceError()
    const raw = Buffer.from(
      JSON.stringify({
        origin: input.origin,
        enrollmentToken: input.enrollmentToken,
        key: this.#key.toString('base64'),
        salt: this.salt,
        iterations: PBKDF2_ITERATIONS,
        migration: {
          schema: 1,
          transactionId: input.transactionId,
          deviceId: input.deviceId,
          enabled: input.enabled,
          options: {
            deviceName: this.options.deviceName,
            features: this.options.features,
            confirmLocal: input.confirmLocal,
            preventSleep: this.options.preventSleep
          },
          lockout: this.lockout
        }
      })
    )
    if (raw.length > 4096) {
      raw.fill(0)
      throw new MigrationSourceError()
    }
    return raw
  }
  wasEnabled(): boolean {
    return this.options.enabled
  }
  destroy(): void {
    this.#key?.fill(0)
    this.#key = null
  }
  toJSON(): never {
    throw new Error('agent_migration_material_not_serializable')
  }
  [inspect.custom](): string {
    return 'LegacyMigrationMaterial([redacted])'
  }
}

/** Solo después de drenar/congelar el host: no repara valores ni deriva una contraseña nueva. */
export async function readLegacyMigrationMaterial(
  path: string,
  box: SecretBox,
  accountEmail: string,
  now = Date.now(),
  expected?: unknown
): Promise<LegacyMigrationMaterial> {
  if (!box.available) throw new MigrationSecureStorageError()
  const value = await readPrivateMigrationJson(path, 262144)
  if (
    !record(value) ||
    value.accountEmail !== accountEmail ||
    typeof value.enabled !== 'boolean' ||
    !record(value.password) ||
    !record(value.features) ||
    !timestamp(now)
  )
    throw new MigrationSourceError()
  if (expected) {
    if (!record(expected)) throw new MigrationSourceError()
    const fields = [
      'accountEmail',
      'enabled',
      'deviceName',
      'password',
      'features',
      'confirmLocal',
      'preventSleep',
      'failures',
      'lockedUntil'
    ]
    const project = (v: Record<string, unknown>): string =>
      JSON.stringify(Object.fromEntries(fields.map((key) => [key, v[key]])))
    if (project(value) !== project(expected)) throw new MigrationSourceError()
  }
  const features = value.features
  if (
    Object.keys(features).length !== 3 ||
    !['clipboard', 'files', 'audio'].every((key) => typeof features[key] === 'boolean') ||
    typeof value.deviceName !== 'string' ||
    !value.deviceName.trim() ||
    value.deviceName.length > 100 ||
    typeof value.confirmLocal !== 'boolean' ||
    typeof value.preventSleep !== 'boolean'
  )
    throw new MigrationSourceError()
  const password = value.password
  if (
    Object.keys(password).length !== 3 ||
    !canonicalBase64(password.salt, 16) ||
    password.iterations !== PBKDF2_ITERATIONS ||
    typeof password.key !== 'string' ||
    password.key.length > 16384
  )
    throw new MigrationSourceError()
  if (
    !Array.isArray(value.failures) ||
    value.failures.length > 64 ||
    !value.failures.every((t) => timestamp(t) && t <= now) ||
    !value.failures.every((t, i, a) => i === 0 || a[i - 1] <= t) ||
    (value.lockedUntil !== null && !timestamp(value.lockedUntil))
  )
    throw new MigrationSourceError()
  let key: Buffer
  try {
    key = Buffer.from(box.open(password.key))
  } catch {
    throw new MigrationSourceError()
  }
  try {
    if (key.length !== 32) throw new MigrationSourceError()
    return new LegacyMigrationMaterial(
      key,
      password.salt,
      {
        enabled: value.enabled as boolean,
        deviceName: value.deviceName,
        features: {
          clipboard: features.clipboard as boolean,
          files: features.files as boolean,
          audio: features.audio as boolean
        },
        confirmLocal: value.confirmLocal,
        preventSleep: value.preventSleep
      },
      {
        failures: [...value.failures],
        lockedUntil: value.lockedUntil as number | null,
        observedAt: now
      }
    )
  } finally {
    key.fill(0)
  }
}
