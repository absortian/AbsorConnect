import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { RemoteAccessStore, PasswordTooShortError } from '../remoteAccessStore'
import { createPlaintextBox } from '../secretBox'
import { deriveKey, keysEqual } from '../password'
import { LOCK_MS } from '../lockout'

let dir: string
let file: string
const PASSWORD = 'contraseña-del-pc-secreta'

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'absor-ra-'))
  file = path.join(dir, 'remote-access.json')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const store = (): RemoteAccessStore =>
  new RemoteAccessStore(file, createPlaintextBox(), 'Sobremesa')

describe('RemoteAccessStore — contraseña', () => {
  it('la contraseña no aparece en el fichero; se guarda K derivada', async () => {
    const s = store()
    await s.setPassword(PASSWORD)

    const raw = await fs.readFile(file, 'utf-8')
    expect(raw).not.toContain(PASSWORD)

    // K recuperada coincide con derivar la contraseña con los parámetros guardados
    const params = await s.getPasswordParams()
    const key = await s.getKey()
    expect(params).not.toBeNull()
    expect(key).not.toBeNull()
    expect(keysEqual(key as Buffer, deriveKey(PASSWORD, params!))).toBe(true)
  })

  it('rechaza contraseñas de menos de 8 caracteres', async () => {
    await expect(store().setPassword('corta')).rejects.toBeInstanceOf(PasswordTooShortError)
    expect(await store().hasPassword()).toBe(false)
  })
})

describe('RemoteAccessStore — bloqueo persistente', () => {
  it('5 fallos bloquean 15 min, y sigue bloqueado tras recargar el almacén', async () => {
    const s = store()
    const now = Date.now()
    for (let i = 0; i < 5; i++) await s.registerFailure(now)
    expect(await s.isLocked(now)).toBe(true)

    // Recargar: una instancia nueva sobre el mismo fichero
    const reloaded = store()
    expect(await reloaded.isLocked(now)).toBe(true)
    expect(await reloaded.isLocked(now + LOCK_MS)).toBe(false)
  })

  it('registra el bloqueo y los fallos en el log', async () => {
    const s = store()
    const now = Date.now()
    for (let i = 0; i < 5; i++) await s.registerFailure(now)
    const types = (await s.getLog()).map((e) => e.type)
    expect(types).toContain('auth-failed')
    expect(types).toContain('locked')
  })
})

describe('RemoteAccessStore — vínculo con la cuenta', () => {
  it('entrar con otra cuenta borra contraseña, registro y estado', async () => {
    const s = store()
    await s.bindToAccount('ana@ejemplo.com')
    await s.setPassword(PASSWORD)
    await s.setEnabled(true)
    await s.addLog({ at: Date.now(), type: 'session-start', controller: 'Oficina' })

    await s.bindToAccount('luis@ejemplo.com')

    expect(await s.getAccountEmail()).toBe('luis@ejemplo.com')
    expect(await s.hasPassword()).toBe(false)
    expect(await s.isEnabled()).toBe(false)
    expect(await s.getLog()).toEqual([])
  })

  it('volver a entrar con la misma cuenta conserva la configuración', async () => {
    const s = store()
    await s.bindToAccount('ana@ejemplo.com')
    await s.setPassword(PASSWORD)
    await s.setEnabled(true)

    await s.bindToAccount('ana@ejemplo.com')

    expect(await s.hasPassword()).toBe(true)
    expect(await s.isEnabled()).toBe(true)
  })
})

describe('RemoteAccessStore — cambios a la vez', () => {
  it('varios cambios simultáneos se guardan todos (Ajustes refresca mientras se cambia algo)', async () => {
    const s = store()
    await s.bindToAccount('ana@example.test')
    await Promise.all([
      s.setDeviceName('Portátil'),
      s.setFeatures({ files: false }),
      s.bindToAccount('ana@example.test'),
      s.setConfirmLocal(true),
      s.setPreventSleep(false),
      s.setEnabled(true)
    ])

    const saved = JSON.parse(await fs.readFile(file, 'utf-8'))
    expect(saved).toMatchObject({
      deviceName: 'Portátil',
      features: { files: false },
      confirmLocal: true,
      preventSleep: false,
      enabled: true
    })
    expect(await fs.readdir(dir)).toEqual(['remote-access.json'])
  })
})
