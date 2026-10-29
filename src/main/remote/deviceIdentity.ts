// Identidad de este equipo en la cuenta (add-remote-desktop D4). Guarda en device.json un
// identificador estable y una clave secreta de 32 bytes; de la clave, el servicio solo guarda su
// SHA-256 (se envía en X-Device-Key). La clave se cifra en disco con la caja inyectada.
import { randomBytes, randomUUID } from 'crypto'
import * as fs from 'fs/promises'
import { flushAtomicWrites, writeAtomic } from './atomicWrite'
import { SecretBox } from './secretBox'
import { isDeviceId } from '../../shared/remote/agentDevice'
import { MigrationSourceError, readPrivateMigrationJson } from './privateMigrationFile'

interface DeviceFile {
  id: string
  key: string // caja.seal(32 bytes)
}

export interface DeviceIdentityValue {
  id: string
  key: string // clave en claro, base64url, para X-Device-Key
}

export class DeviceIdentity {
  private cache: DeviceIdentityValue | null = null

  constructor(
    private readonly path: string,
    private readonly box: SecretBox
  ) {}

  /** Origen de migración: nunca invoca create/reset ni modifica la caché o el disco. */
  async readExisting(): Promise<DeviceIdentityValue> {
    await flushAtomicWrites(this.path)
    const value = await readPrivateMigrationJson(this.path, 16384)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new MigrationSourceError()
    const file = value as Record<string, unknown>
    if (Object.keys(file).length !== 2 || !isDeviceId(file.id) || typeof file.key !== 'string')
      throw new MigrationSourceError()
    let bytes: Buffer
    try {
      bytes = Buffer.from(this.box.open(file.key))
    } catch {
      throw new MigrationSourceError()
    }
    try {
      if (bytes.length !== 32) throw new MigrationSourceError()
      const current = { id: file.id, key: bytes.toString('base64url') }
      if (this.cache && (this.cache.id !== current.id || this.cache.key !== current.key))
        throw new MigrationSourceError()
      return current
    } finally {
      bytes.fill(0)
    }
  }

  /** Identidad de este equipo; la crea la primera vez. */
  async get(): Promise<DeviceIdentityValue> {
    if (this.cache) return this.cache
    try {
      const file = JSON.parse(await fs.readFile(this.path, 'utf-8')) as Partial<DeviceFile>
      if (typeof file.id === 'string' && typeof file.key === 'string') {
        this.cache = { id: file.id, key: this.box.open(file.key).toString('base64url') }
        return this.cache
      }
    } catch {
      // No existe o está ilegible: se genera una identidad nueva
    }
    return this.create()
  }

  /**
   * Identidad nueva: el identificador ya es de otra cuenta (`device_taken`) o esta cuenta lo tiene
   * con otra clave (D4).
   */
  async reset(): Promise<DeviceIdentityValue> {
    return this.create()
  }

  private async create(): Promise<DeviceIdentityValue> {
    const id = randomUUID()
    const keyBytes = randomBytes(32)
    const file: DeviceFile = { id, key: this.box.seal(keyBytes) }
    await writeAtomic(this.path, JSON.stringify(file))
    this.cache = { id, key: keyBytes.toString('base64url') }
    return this.cache
  }
}
