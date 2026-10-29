import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { MigrationCoordinator, type MigrationDependencies } from '../migrationCoordinator'
import { MigrationJournal } from '../migrationJournal'
import { DeviceIdentity } from '../deviceIdentity'
import { RemoteAccessStore } from '../remoteAccessStore'
import type { MigrationReceipt } from '../migrationProvider'
import type { Session } from '../../cloud/session'
import { createPlaintextBox } from '../secretBox'
let dir: string, d: MigrationDependencies, session: Session | null, receipt: MigrationReceipt | null
let counter: { legacyResume: number; apiCreate: number; nativePrepare: number; commits: number }
let source: Buffer
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'absor-migration-coordinator-'))
  session = { email: 'lab@example.invalid', token: 'account-token-never-in-provider' }
  receipt = null
  counter = { legacyResume: 0, apiCreate: 0, nativePrepare: 0, commits: 0 }
  // Caja falsa solo para aislar el coordinador; la matriz VM usa AES-GCM real.
  const box = { ...createPlaintextBox(), available: true }
  const store = new RemoteAccessStore(join(dir, 'remote.json'), box, 'laboratorio')
  await store.bindToAccount(session.email)
  await store.setPassword('password-de-prueba')
  await store.setEnabled(true)
  await store.setFeatures({ audio: false, clipboard: false, files: false })
  const identity = new DeviceIdentity(join(dir, 'device.json'), box)
  await identity.get()
  source = await fs.readFile(join(dir, 'remote.json'))
  const journal = new MigrationJournal(join(dir, 'intent.json'))
  d = {
    session: () => session,
    origin: () => 'https://example.invalid',
    journal,
    store,
    identity,
    host: {
      quiesceForMigration: async () => {
        expect(await journal.intentPresent()).toBe(true)
      }
    },
    api: {
      create: async () => {
        counter.apiCreate++
        return 'ace_' + 'a'.repeat(43)
      },
      cancel: async () => true,
      consumed: async () => true
    },
    provider: {
      available: async () => true,
      inspect: async () => receipt,
      prepare: async (raw) => {
        counter.nativePrepare++
        expect(raw.toString()).not.toContain('account-token')
        const value = JSON.parse(raw.toString())
        receipt = {
          v: 1,
          deviceId: value.migration.deviceId,
          transactionId: value.migration.transactionId,
          phase: 'prepared',
          canActivate: true,
          optionsImported: true,
          lockoutImported: true
        }
        return receipt
      },
      commit: async () => {
        counter.commits++
        return (receipt = { ...receipt!, phase: 'committed' })
      },
      remove: async () => (receipt ? (receipt = { ...receipt, phase: 'removed' }) : null)
    },
    compensated: async () => {
      counter.legacyResume++
    },
    quiesceTimeoutMs: 5000
  }
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
const choice = { confirmLocal: false, activate: true }
describe.skipIf(process.platform === 'win32')('coordinador durable sin secretos', () => {
  it('prepara sin activar, conserva origen, confirma por separado y compensa ambas autoridades', async () => {
    const c = new MigrationCoordinator(d)
    expect((await c.begin(choice)).ok).toBe(true)
    expect(counter.commits).toBe(0)
    expect(await c.state()).toMatchObject({
      phase: 'prepared',
      canCommit: true,
      readyForUnattended: false
    })
    expect(await fs.readFile(join(dir, 'remote.json'))).toEqual(source)
    const journal = await fs.readFile(join(dir, 'intent.json'), 'utf8')
    expect(journal).not.toContain('account-token')
    expect(journal).not.toContain('ace_')
    expect(journal).not.toContain('key')
    expect((await c.commit()).ok).toBe(true)
    expect(await c.state()).toMatchObject({ phase: 'committed', canCommit: false })
    expect((await c.cancel()).ok).toBe(true)
    expect(await d.journal.read()).toBeNull()
    expect(counter.legacyResume).toBe(1)
    expect(await fs.readFile(join(dir, 'remote.json'))).toEqual(source)
  })
  it.each([
    'drain',
    'snapshot',
    'create',
    'prepare',
    'prepare-reply',
    'commit-reply',
    'api-cancel',
    'local-remove'
  ] as const)('fallo en %s no libera el legado sin doble prueba', async (phase) => {
    const c = new MigrationCoordinator(d),
      fail = async (): Promise<never> => {
        throw Error('private failure details')
      }
    if (phase === 'drain') d.host.quiesceForMigration = fail
    if (phase === 'snapshot') d.store.freezeForMigration = fail
    if (phase === 'create') d.api.create = fail
    if (phase === 'prepare') d.provider.prepare = fail
    if (phase === 'prepare-reply') {
      const prepare = d.provider.prepare
      d.provider.prepare = async (raw) => {
        await prepare(raw)
        return fail()
      }
    }
    const begun = await c.begin(choice)
    if (phase === 'commit-reply') {
      const commit = d.provider.commit
      d.provider.commit = async (target) => {
        await commit(target)
        return fail()
      }
      expect((await c.commit()).ok).toBe(false)
    } else if (phase === 'api-cancel' || phase === 'local-remove') {
      if (phase === 'api-cancel') d.api.cancel = fail
      else d.provider.remove = fail
      expect((await c.cancel()).ok).toBe(false)
    } else expect(begun.ok).toBe(false)
    expect(await d.journal.intentPresent()).toBe(true)
    expect(counter.legacyResume).toBe(0)
    expect(await fs.readFile(join(dir, 'remote.json'))).toEqual(source)
    if (phase === 'drain' || phase === 'snapshot') expect(counter.apiCreate).toBe(0)
  })
  it('un drenaje tardío no continúa después del plazo ni lee el material', async () => {
    d.quiesceTimeoutMs = 30
    let finish!: () => void
    d.host.quiesceForMigration = () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
    const freeze = vi.spyOn(d.store, 'freezeForMigration'),
      c = new MigrationCoordinator(d)
    expect((await c.begin(choice)).ok).toBe(false)
    finish()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(freeze).not.toHaveBeenCalled()
    expect(counter.apiCreate).toBe(0)
    expect((await d.journal.read())?.phase).toBe('reserved')
  })
  it.each(['prepared', 'committed'] as const)(
    'recupera respuesta perdida %s sin recanjear ni duplicar',
    async (phase) => {
      const c = new MigrationCoordinator(d),
        original = d.provider.prepare
      if (phase === 'prepared')
        d.provider.prepare = async (raw) => {
          await original(raw)
          throw Error('lost reply')
        }
      await c.begin(choice)
      if (phase === 'committed') {
        const commit = d.provider.commit
        d.provider.commit = async (target) => {
          await commit(target)
          throw Error('lost reply')
        }
        await c.commit()
      }
      const restart = new MigrationCoordinator(d)
      expect((await restart.recover()).ok).toBe(true)
      expect((await d.journal.read())?.phase).toBe(phase)
      expect(counter.apiCreate).toBe(1)
      expect(counter.nativePrepare).toBe(1)
      expect(counter.commits).toBe(phase === 'committed' ? 1 : 0)
    }
  )
  it.each([
    'account',
    'same-email-new-token',
    'epoch',
    'foreign-receipt',
    'newer-api-agent'
  ] as const)('rechaza recuperación/compensación %s', async (phase) => {
    const c = new MigrationCoordinator(d)
    await c.begin(choice)
    if (phase === 'account') session = { ...session!, email: 'another@example.invalid' }
    if (phase === 'same-email-new-token') session = { ...session!, token: 'another-source' }
    if (phase === 'epoch') {
      c.invalidate()
      session = { ...session! }
    }
    if (phase === 'foreign-receipt') {
      receipt = { ...receipt!, transactionId: '00000000-0000-4000-8000-000000000009' }
      d.provider.remove = async () => receipt
    }
    if (phase === 'newer-api-agent') d.api.cancel = async () => false
    if (phase !== 'epoch') expect((await c.cancel()).ok).toBe(false)
    else {
      const prepare = d.provider.prepare
      d.provider.prepare = async (raw) => {
        c.invalidate()
        return prepare(raw)
      }
      // Una operación ya preparada necesita recuperar explícitamente tras invalidación.
      expect((await c.commit()).ok).toBe(false)
    }
    expect(counter.legacyResume).toBe(0)
    expect(await d.journal.intentPresent()).toBe(true)
  })
  it('cambio de cuenta durante prepare impide activar y reserva la intención para recuperación', async () => {
    const prepare = d.provider.prepare
    d.provider.prepare = async (raw) => {
      const result = await prepare(raw)
      session = null
      return result
    }
    const c = new MigrationCoordinator(d)
    expect((await c.begin(choice)).ok).toBe(false)
    expect(counter.commits).toBe(0)
    expect((await d.journal.read())?.phase).toBe('provisioning')
  })
  it('una salida de cuenta durante commit provoca parada local al llegar su respuesta tardía', async () => {
    const c = new MigrationCoordinator(d)
    await c.begin(choice)
    const stop = vi.fn(async () => ({ ok: true }))
    d.stopAfterSourceChange = stop
    const commit = d.provider.commit
    d.provider.commit = async (target) => {
      const result = await commit(target)
      session = null
      c.invalidate()
      return result
    }
    expect((await c.commit()).ok).toBe(false)
    expect(stop).toHaveBeenCalledExactlyOnceWith({
      deviceId: receipt!.deviceId,
      transactionId: receipt!.transactionId
    })
    expect((await d.journal.read())?.phase).toBe('prepared')
    expect(counter.legacyResume).toBe(0)
  })
  it('también para tras cambiar cuenta y perder la respuesta del commit nativo', async () => {
    const c = new MigrationCoordinator(d)
    await c.begin(choice)
    const stop = vi.fn(async () => ({ ok: true }))
    d.stopAfterSourceChange = stop
    const commit = d.provider.commit
    d.provider.commit = async (target) => {
      await commit(target)
      session = null
      c.invalidate()
      throw Error('lost_reply')
    }
    expect((await c.commit()).ok).toBe(false)
    expect(stop).toHaveBeenCalledExactlyOnceWith({
      deviceId: receipt!.deviceId,
      transactionId: receipt!.transactionId
    })
    expect(counter.legacyResume).toBe(0)
  })
  it('dos begin concurrentes no piden dos grants y el proveedor ausente no toca identidad', async () => {
    const c = new MigrationCoordinator(d)
    const results = await Promise.all([c.begin(choice), c.begin(choice)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(counter.apiCreate).toBe(1)
    d.provider.available = async () => false
    const identity = vi.spyOn(d.identity, 'readExisting')
    expect(await c.begin(choice)).toEqual({ ok: false, code: 'agent_setup_unavailable' })
    expect(identity).not.toHaveBeenCalled()
  })
  it('revalida la cuenta al devolver el legado tras las comprobaciones asíncronas', async () => {
    const c = new MigrationCoordinator(d)
    await c.begin(choice)
    d.compensated = async (revalidate) => {
      session = { ...session!, token: 'replacement' }
      revalidate()
      counter.legacyResume++
    }
    expect((await c.cancel()).ok).toBe(false)
    expect(counter.legacyResume).toBe(0)
    await expect((d.store as RemoteAccessStore).setEnabled(false)).rejects.toThrow('frozen')
  })
  it('las opciones no soportadas se conservan preparadas pero no se pueden activar', async () => {
    const prepare = d.provider.prepare
    d.provider.prepare = async (raw) => ({ ...(await prepare(raw)), canActivate: false })
    const c = new MigrationCoordinator(d)
    expect((await c.begin({ confirmLocal: true, activate: true })).ok).toBe(true)
    expect((await c.state()).canCommit).toBe(false)
    expect((await c.commit()).ok).toBe(false)
    expect(counter.commits).toBe(0)
  })
  it('el recibo de otra fuente de cuenta no da permiso de commit al reiniciar', async () => {
    const c = new MigrationCoordinator(d)
    await c.begin(choice)
    session = { ...session!, token: 'new-token' }
    const restart = new MigrationCoordinator(d)
    expect((await restart.recover()).ok).toBe(false)
    expect(await restart.state()).toMatchObject({
      phase: 'intervention_required',
      canCommit: false
    })
    expect((await d.journal.read())?.accountBinding).not.toBe(
      createHash('sha256').update('new-token').digest('hex')
    )
  })
})
