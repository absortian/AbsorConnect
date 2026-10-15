// Identidad de este equipo en la cuenta (add-remote-desktop D4). Guarda en device.json un
// identificador estable y una clave secreta de 32 bytes; de la clave, el servicio solo guarda su
// SHA-256 (se envía en X-Device-Key). La clave se cifra en disco con la caja inyectada.
import { randomBytes, randomUUID } from 'crypto'
import * as fs from 'fs/promises'
import { writeAtomic } from './atomicWrite'
import { SecretBox } from './secretBox'

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

  private async create(): Promise<DeviceIdentityValue> {
    const id = randomUUID()
    const keyBytes = randomBytes(32)
    const file: DeviceFile = { id, key: this.box.seal(keyBytes) }
    await writeAtomic(this.path, JSON.stringify(file))
    this.cache = { id, key: keyBytes.toString('base64url') }
    return this.cache
  }
}
