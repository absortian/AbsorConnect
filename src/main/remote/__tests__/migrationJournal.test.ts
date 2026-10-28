import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as fs from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { MigrationJournal, parseMigrationRecord, migrationStatusSource } from '../migrationJournal'
const filesystemTest = it.skipIf(process.platform === 'win32')
let directory: string
let path: string
const input = {
  transactionId: '12345678-1234-4abc-8def-123456789abc',
  deviceId: '22345678-1234-4abc-8def-123456789abc',
  accountBinding: 'ab'.repeat(32),
  legacyEnabled: true
}
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'absor-migration-'))
  path = join(directory, 'intent.json')
})
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})
filesystemTest(
  'reserva una sola intención, conserva revisión y recupera desde otra instancia',
  async () => {
    const journal = new MigrationJournal(path)
    expect(await journal.read()).toBeNull()
    const first = await journal.reserve(input)
    expect((await fs.stat(path)).mode & 0o777).toBe(0o600)
    expect(await new MigrationJournal(path).read()).toEqual(first)
    await expect(new MigrationJournal(path).reserve(input)).rejects.toThrow(
      'agent_migration_journal_unverified'
    )
    const second = await journal.advance(first, 'grant_requested')
    await expect(journal.advance(first, 'grant_requested')).rejects.toThrow(
      'agent_migration_journal_unverified'
    )
    expect(await journal.read()).toEqual(second)
  }
)
filesystemTest(
  'dos reservas concurrentes no reemplazan la identidad elegida por la primera',
  async () => {
    const a = new MigrationJournal(path),
      b = new MigrationJournal(path)
    const results = await Promise.allSettled([
      a.reserve(input),
      b.reserve({ ...input, deviceId: '32345678-1234-4abc-8def-123456789abc' })
    ])
    expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(1)
    const record = await a.read()
    expect(results.find((v) => v.status === 'fulfilled')).toMatchObject({ value: record })
  }
)
filesystemTest(
  'no salta fases ni borra la reserva sin las dos compensaciones verificadas',
  async () => {
    const journal = new MigrationJournal(path)
    let record = await journal.reserve(input)
    await expect(journal.advance(record, 'committed')).rejects.toThrow()
    await expect(
      journal.clearAfterCompensation(record, { apiRevoked: true, localRemoved: true })
    ).rejects.toThrow()
    record = await journal.advance(record, 'compensating')
    await expect(
      journal.clearAfterCompensation(record, { apiRevoked: true, localRemoved: false } as never)
    ).rejects.toThrow()
    expect(await journal.read()).toEqual(record)
    await journal.clearAfterCompensation(record, { apiRevoked: true, localRemoved: true })
    expect(await journal.read()).toBeNull()
  }
)
filesystemTest(
  'el archivo no contiene autoridad y rechaza secretos, duplicados, tamaños o campos libres',
  async () => {
    const record = await new MigrationJournal(path).reserve(input)
    const raw = JSON.stringify(record)
    for (const edit of [
      { token: 'account-token' },
      { key: 'host-key' },
      { password: 'password' },
      { phase: 'shell' },
      { revision: 0 },
      { accountBinding: 'token' }
    ])
      expect(() => parseMigrationRecord(JSON.stringify({ ...record, ...edit }))).toThrow(
        'agent_migration_journal_unverified'
      )
    expect(() => parseMigrationRecord(raw.replace('{', '{"v":1,'))).toThrow()
    expect(() => parseMigrationRecord(' '.repeat(4097))).toThrow()
    expect(() => parseMigrationRecord(raw.replace('1,', '2,'))).toThrow()
    expect(await fs.readFile(path, 'utf8')).toBe(raw)
  }
)
filesystemTest(
  'corrupción, permisos y enlaces se conservan y bloquean la recuperación automática',
  async () => {
    const journal = new MigrationJournal(path)
    await fs.writeFile(path, 'damaged', { mode: 0o600 })
    await expect(journal.read()).rejects.toThrow('agent_migration_journal_unverified')
    expect(await fs.readFile(path, 'utf8')).toBe('damaged')
    await fs.unlink(path)
    await journal.reserve(input)
    await fs.chmod(path, 0o640)
    await expect(journal.read()).rejects.toThrow()
    await fs.chmod(path, 0o600)
    await fs.link(path, join(directory, 'hardlink'))
    await expect(journal.read()).rejects.toThrow()
    await fs.unlink(join(directory, 'hardlink'))
    await fs.rename(path, join(directory, 'original'))
    await fs.symlink(join(directory, 'original'), path)
    await expect(journal.read()).rejects.toThrow()
    expect(await fs.stat(join(directory, 'original'))).toBeDefined()
  }
)

filesystemTest(
  'una intención pendiente reserva el host antes de ejecutar el cliente instalado, incluso tras reiniciar Main',
  async () => {
    const journal = new MigrationJournal(path)
    const installed = {
      presence: vi.fn(async () => 'absent' as const),
      query: vi.fn(async () => {
        throw Error('no-service')
      })
    }
    expect(await migrationStatusSource(journal, installed).presence()).toBe('absent')
    await journal.reserve(input)
    const source = migrationStatusSource(new MigrationJournal(path), installed)
    expect(await source.presence()).toBe('installed')
    expect(installed.presence).toHaveBeenCalledTimes(1)
    expect(installed.query).not.toHaveBeenCalled()
  }
)
filesystemTest(
  'una reserva corrupta no se convierte en ausencia ni permite consultar la identidad legado',
  async () => {
    await fs.writeFile(path, '{partial', { mode: 0o600 })
    const installed = {
      presence: vi.fn(async () => 'absent' as const),
      query: vi.fn(async () => '')
    }
    const source = migrationStatusSource(new MigrationJournal(path), installed)
    await expect(source.presence()).rejects.toThrow('agent_migration_journal_unverified')
    expect(installed.presence).not.toHaveBeenCalled()
    expect(installed.query).not.toHaveBeenCalled()
    expect(await fs.readFile(path, 'utf8')).toBe('{partial')
  }
)

it('el contrato del journal rechaza autoridad y fases libres en todos los sistemas', () => {
  const record = { v: 1, ...input, phase: 'reserved', revision: 1 }
  expect(parseMigrationRecord(JSON.stringify(record))).toEqual(record)
  for (const edit of [
    { token: 'untrusted' },
    { key: 'untrusted' },
    { phase: 'execute' },
    { revision: -1 },
    { accountBinding: 'untrusted' }
  ])
    expect(() => parseMigrationRecord(JSON.stringify({ ...record, ...edit }))).toThrow(
      'agent_migration_journal_unverified'
    )
})
it.runIf(process.platform === 'win32')(
  'sin adaptador ACL no crea un journal, pero distingue ausencia inicial',
  async () => {
    const journal = new MigrationJournal(path)
    expect(await journal.intentPresent()).toBe(false)
    await expect(journal.reserve(input)).rejects.toThrow('agent_migration_journal_unverified')
    await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  }
)
