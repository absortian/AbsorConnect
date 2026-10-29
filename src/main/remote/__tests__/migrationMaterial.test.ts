import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { inspect } from 'util'
import { DeviceIdentity } from '../deviceIdentity'
import { RemoteAccessStore } from '../remoteAccessStore'
import { readLegacyMigrationMaterial } from '../migrationMaterial'
import { deriveKey } from '../password'
import type { SecretBox } from '../secretBox'
let dir: string
const wrapper = randomBytes(32)
const box: SecretBox = {
  available: true,
  seal: (value) => {
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', wrapper, nonce)
    return Buffer.concat([
      nonce,
      cipher.update(value),
      cipher.final(),
      cipher.getAuthTag()
    ]).toString('base64')
  },
  open: (raw) => {
    const value = Buffer.from(raw, 'base64'),
      cipher = createDecipheriv('aes-256-gcm', wrapper, value.subarray(0, 12))
    cipher.setAuthTag(value.subarray(-16))
    return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()])
  }
}
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'absor-migration-material-'))
})
afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true })
})
const ids = {
  deviceId: '00000000-0000-4000-8000-000000000001',
  transactionId: '00000000-0000-4000-8000-000000000002',
  origin: 'https://example.invalid',
  enrollmentToken: 'ace_' + 'a'.repeat(43),
  enabled: true,
  confirmLocal: false
}
async function source(): Promise<RemoteAccessStore> {
  const store = new RemoteAccessStore(join(dir, 'remote.json'), box, 'laboratorio')
  await store.bindToAccount('lab@example.invalid')
  await store.setPassword('password-de-prueba')
  await store.setEnabled(true)
  await store.setFeatures({ clipboard: false, files: true, audio: false })
  return store
}
describe.skipIf(process.platform === 'win32')('origen privado sin reparación ni reseteo', () => {
  it('conserva identidad/contraseña/opciones/contador y no serializa el material accidentalmente', async () => {
    const store = await source(),
      file = join(dir, 'remote.json')
    await store.registerFailure(1000)
    await store.registerFailure(2000)
    const before = await fs.readFile(file),
      material = await store.freezeForMigration('lab@example.invalid', 3000)
    expect(() => JSON.stringify(material)).toThrow('not_serializable')
    expect(inspect(material)).toBe('LegacyMigrationMaterial([redacted])')
    const payload = material.provisioningPayload(ids),
      decoded = JSON.parse(payload.toString())
    const expected = deriveKey('password-de-prueba', {
      salt: decoded.salt,
      iterations: decoded.iterations
    })
    expect(Buffer.from(decoded.key, 'base64').equals(expected)).toBe(true)
    expect(decoded.migration.lockout).toEqual({
      failures: [1000, 2000],
      lockedUntil: null,
      observedAt: 3000
    })
    expect(decoded.migration.options.features).toEqual({
      clipboard: false,
      files: true,
      audio: false
    })
    expect(decoded).not.toHaveProperty('accountEmail')
    expect(decoded).not.toHaveProperty('deviceKey')
    expect(await fs.readFile(file)).toEqual(before)
    await expect(store.setPassword('otra-password')).rejects.toThrow('frozen')
    await expect(store.registerFailure()).rejects.toThrow('frozen')
    await expect(store.setEnabled(false)).rejects.toThrow('frozen')
    payload.fill(0)
    material.destroy()
    expect(() => material.provisioningPayload(ids)).toThrow('local_state_unverified')
    store.releaseMigrationFreeze()
    await store.setEnabled(false)
  })
  it.each(['missing', 'malformed', 'duplicate', 'mode', 'symlink', 'hardlink', 'cache'] as const)(
    'no regenera identidad ante %s',
    async (fault) => {
      const file = join(dir, 'identity.json'),
        identity = new DeviceIdentity(file, box)
      const original = await identity.get()
      if (fault === 'missing') await fs.unlink(file)
      if (fault === 'malformed') await fs.writeFile(file, '{')
      if (fault === 'duplicate') await fs.writeFile(file, '{"id":"x","id":"y","key":"z"}')
      if (fault === 'mode') await fs.chmod(file, 0o644)
      if (fault === 'symlink') {
        await fs.rename(file, file + '.old')
        await fs.symlink(file + '.old', file)
      }
      if (fault === 'hardlink') await fs.link(file, file + '.link')
      if (fault === 'cache') await new DeviceIdentity(file, box).reset()
      const before = await fs.readFile(file).catch(() => null)
      await expect(identity.readExisting()).rejects.toThrow('local_state_unverified')
      expect(await fs.readFile(file).catch(() => null)).toEqual(before)
      expect(await identity.get()).toEqual(original)
    }
  )
  it('espera escritura inicial y lee una identidad existente sin crear otra', async () => {
    const identity = new DeviceIdentity(join(dir, 'identity.json'), box)
    const value = await identity.get()
    expect(await identity.readExisting()).toEqual(value)
  })
  it.each(['account', 'counter', 'future', 'password', 'cache', 'secure-storage'] as const)(
    'bloquea origen %s y lo conserva',
    async (fault) => {
      const store = await source(),
        file = join(dir, 'remote.json'),
        value = JSON.parse(await fs.readFile(file, 'utf8'))
      if (fault === 'account') value.accountEmail = 'another@example.invalid'
      if (fault === 'counter') value.failures = [2000, 1000]
      if (fault === 'future') value.failures = [4000]
      if (fault === 'password') value.password.key = 'invalid'
      if (fault === 'cache') value.features.files = false
      await fs.writeFile(file, JSON.stringify(value), { mode: 0o600 })
      const before = await fs.readFile(file)
      if (fault === 'secure-storage')
        await expect(
          readLegacyMigrationMaterial(
            file,
            { ...box, available: false },
            'lab@example.invalid',
            3000
          )
        ).rejects.toThrow('secure_storage_required')
      else
        await expect(store.freezeForMigration('lab@example.invalid', 3000)).rejects.toThrow(
          'local_state_unverified'
        )
      expect(await fs.readFile(file)).toEqual(before)
    }
  )
})
